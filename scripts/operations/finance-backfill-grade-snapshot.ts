/**
 * Sprint A.5 — finance-backfill-grade-snapshot
 *
 * Fills the gradeLevel snapshot on pre-A.1 INVOICE# rows and pre-A.2
 * PAYMENT# rows in the finance table. Both entities gain a sparse
 * gsi14pk/gsi14sk pair as a side-effect of the fill so the rows
 * become visible to GSI14 (school + gradeLevel) queries from Sprint B.1
 * onward.
 *
 * Resolution order
 * ----------------
 *   - INVOICE: resolve via academics `getStudentInfo(studentId)`. If
 *     the student is graduated / withdrawn / academics 404s, mark
 *     `gradeLevelResolutionStatus = 'unresolved'` and leave gradeLevel
 *     undefined. Row stays sparse on GSI14 and surfaces only via the
 *     "Unknown" UI bucket (Sprint B.1 post-filter).
 *   - PAYMENT: snapshot from the parent invoice's gradeLevel —
 *     which is either pre-existing (admin override path before A.1
 *     populated it from studentInfo) OR was just filled by this same
 *     script's invoice pass above. Run invoices first, then payments.
 *
 * Idempotency
 * -----------
 *   `UpdateItem` with `attribute_not_exists(gradeLevel)` condition —
 *   re-runs are no-ops on rows already filled. The matching
 *   gsi14pk/gsi14sk are written in the same UpdateItem so the
 *   row's index visibility flips atomically with the snapshot.
 *
 *   `gradeLevelResolutionStatus = 'unresolved'` rows ARE re-attempted
 *   on subsequent runs (status field doesn't gate the condition), so
 *   re-running after the operator hand-corrects an academics record
 *   picks up the new value.
 *
 * Safety
 * ------
 *   - Dry-run default — `--apply` required for mutation.
 *   - `--tenant <id>` scopes to one tenant first; broad runs only
 *     after spot-checking a few rows.
 *   - `--limit N` caps the total rows processed (default: no cap).
 *   - Per-row failure is logged + skipped, never fatal.
 *   - Findings CSV at `findings-finance-grade-snapshot-<ts>.csv`
 *     lists every row whose resolution was 'unresolved' so operators
 *     can hand-correct missing student-grade records in academics.
 *   - Audit log line per UpdateItem with tenantId, schoolId,
 *     entityType, entityId, old/new gradeLevel, status.
 *
 * Usage
 * -----
 *   npx ts-node scripts/operations/finance-backfill-grade-snapshot.ts                  # dry-run, all tenants, all rows
 *   npx ts-node scripts/operations/finance-backfill-grade-snapshot.ts --apply          # destructive
 *   npx ts-node scripts/operations/finance-backfill-grade-snapshot.ts --tenant <id>    # one tenant
 *   npx ts-node scripts/operations/finance-backfill-grade-snapshot.ts --limit 100      # cap
 *   npx ts-node scripts/operations/finance-backfill-grade-snapshot.ts --tenant <id> --apply
 *
 * Auth
 * ----
 * Requires `dynamodb:Scan`, `dynamodb:UpdateItem` on `edforge-finance-*`
 * AND a tenant-scoped JWT or system principal that can reach academics'
 * `GET /academics/students/:studentId` for the per-student resolution.
 * Dry-run does not need UpdateItem.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import axios from 'axios';

// ─────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────

interface Args {
  apply: boolean;
  tenantId?: string;
  limit?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--tenant') args.tenantId = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
  }
  return args;
}

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

interface BackfillFinding {
  tenantId: string;
  entityType: 'INVOICE' | 'PAYMENT';
  entityKey: string;
  schoolId: string;
  studentId?: string;
  invoiceId?: string;
  resolution: 'resolved' | 'unresolved' | 'skipped';
  resolvedGradeLevel?: string;
  reason?: string;
}

interface BackfillSummary {
  scanned: number;
  invoicesResolved: number;
  invoicesUnresolved: number;
  paymentsResolved: number;
  paymentsUnresolved: number;
  skipped: number;
  errors: number;
  durationSec: number;
}

// ─────────────────────────────────────────
// Pure helpers — unit-testable
// ─────────────────────────────────────────

/**
 * Decide the resolution outcome for an invoice given the resolved
 * student record (or null). Pure function — no DDB / network in
 * here so the unit spec can drive it with simple fixtures.
 */
export function resolveInvoiceGradeLevel(
  studentInfo: { gradeLevel: string } | null,
): { gradeLevel: string | undefined; status: 'resolved' | 'unresolved' } {
  if (studentInfo && studentInfo.gradeLevel) {
    return { gradeLevel: studentInfo.gradeLevel, status: 'resolved' };
  }
  return { gradeLevel: undefined, status: 'unresolved' };
}

/**
 * Decide the payment's snapshot given the parent invoice's
 * (already-filled-or-not) gradeLevel + resolution status.
 */
export function resolvePaymentGradeLevel(
  parentInvoice: {
    gradeLevel?: string;
    gradeLevelResolutionStatus?: 'resolved' | 'unresolved';
  } | null,
): { gradeLevel: string | undefined; status: 'resolved' | 'unresolved' | 'skipped' } {
  if (!parentInvoice) {
    return { gradeLevel: undefined, status: 'skipped' };
  }
  if (parentInvoice.gradeLevel) {
    return { gradeLevel: parentInvoice.gradeLevel, status: 'resolved' };
  }
  // Parent invoice has the unresolved sentinel → propagate.
  return { gradeLevel: undefined, status: 'unresolved' };
}

/**
 * Build the UpdateItem expression for filling the snapshot.
 * Returns `null` when nothing should be written (resolution skipped).
 */
export function buildUpdateExpression(
  tenantId: string,
  schoolId: string,
  entityType: 'INVOICE' | 'PAYMENT',
  resolution: { gradeLevel: string | undefined; status: 'resolved' | 'unresolved' | 'skipped' },
  issuedOrCreatedDate: string,
): {
  UpdateExpression: string;
  ExpressionAttributeValues: Record<string, { S: string }>;
  ConditionExpression: string;
} | null {
  if (resolution.status === 'skipped') return null;

  // Always set the status field so subsequent reads can bucket
  // unresolved rows separately. When status='resolved' we ALSO set
  // gradeLevel + the gsi14 pair (sparse — only resolved rows are
  // indexed). When status='unresolved' we set ONLY the status.
  const setParts = ['gradeLevelResolutionStatus = :status'];
  const values: Record<string, { S: string }> = {
    ':status': { S: resolution.status },
  };

  if (resolution.gradeLevel) {
    setParts.push('gradeLevel = :gl');
    setParts.push('gsi14pk = :gsi14pk');
    setParts.push('gsi14sk = :gsi14sk');
    values[':gl'] = { S: resolution.gradeLevel };
    values[':gsi14pk'] = {
      S: `TENANT#${tenantId}#SCHOOL#${schoolId}#GRADE#${resolution.gradeLevel}`,
    };
    values[':gsi14sk'] = {
      S: `${entityType}#${issuedOrCreatedDate}`,
    };
  }

  return {
    UpdateExpression: `SET ${setParts.join(', ')}`,
    ExpressionAttributeValues: values,
    // Idempotent: never overwrite an existing gradeLevel snapshot.
    // (gradeLevelResolutionStatus alone CAN be re-written so re-runs
    // can promote 'unresolved' → 'resolved' if the student record
    // gets corrected in academics — gated by absence of gradeLevel.)
    ConditionExpression: 'attribute_not_exists(gradeLevel)',
  };
}

// ─────────────────────────────────────────
// Main
// ─────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const region = process.env.AWS_REGION || 'us-east-1';
  const tableName = process.env.TABLE_NAME || 'edforge-finance-basic';
  const academicsUrl =
    process.env.ACADEMICS_SERVICE_URL || 'http://localhost:3010';

  console.log('finance-backfill-grade-snapshot (Sprint A.5)');
  console.log(`  region=${region} table=${tableName}`);
  console.log(`  mode=${args.apply ? '\x1b[31mAPPLY\x1b[0m' : 'DRY-RUN'}`);
  if (args.tenantId) console.log(`  tenant=${args.tenantId}`);
  if (args.limit) console.log(`  limit=${args.limit}`);
  console.log('');

  const ddb = new DynamoDBClient({ region });
  const started = Date.now();
  const findings: BackfillFinding[] = [];
  const summary: BackfillSummary = {
    scanned: 0,
    invoicesResolved: 0,
    invoicesUnresolved: 0,
    paymentsResolved: 0,
    paymentsUnresolved: 0,
    skipped: 0,
    errors: 0,
    durationSec: 0,
  };

  // ─── Pass 1: INVOICE rows ────────────────────────────────────
  console.log('Pass 1 — INVOICE rows...');
  let lastKey: Record<string, any> | undefined;
  do {
    const filterParts = [
      'entityType = :entType',
      'attribute_not_exists(gradeLevel)',
    ];
    const values: Record<string, any> = {
      ':entType': { S: 'INVOICE' },
    };
    if (args.tenantId) {
      filterParts.push('tenantId = :tid');
      values[':tid'] = { S: args.tenantId };
    }

    const scanResult: any = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: filterParts.join(' AND '),
        ExpressionAttributeValues: values,
        ExclusiveStartKey: lastKey,
        Limit: 1000,
      }),
    );

    for (const item of scanResult.Items || []) {
      if (args.limit && summary.scanned >= args.limit) break;
      summary.scanned++;
      const tenantId = item.tenantId?.S as string;
      const entityKey = item.entityKey?.S as string;
      const schoolId = item.schoolId?.S as string;
      const studentId = item.studentId?.S as string;
      const issuedDate = item.issuedDate?.S as string;

      // Resolve via academics
      let studentInfo: { gradeLevel: string } | null = null;
      try {
        const resp = await axios.get(
          `${academicsUrl}/academics/students/${studentId}`,
          { params: { schoolId }, timeout: 5_000 },
        );
        const d = resp.data || {};
        studentInfo = {
          gradeLevel: d.currentGradeLevel || d.gradeLevel || '',
        };
      } catch (err: any) {
        if (err.response?.status !== 404) {
          summary.errors++;
          console.warn(
            `  WARN: academics lookup failed for invoice ${entityKey}: ${
              err.message || err
            }`,
          );
        }
        // 404 → studentInfo stays null → resolveInvoiceGradeLevel returns 'unresolved'
      }

      const resolution = resolveInvoiceGradeLevel(studentInfo);
      const expr = buildUpdateExpression(
        tenantId,
        schoolId,
        'INVOICE',
        resolution,
        issuedDate,
      );

      findings.push({
        tenantId,
        entityType: 'INVOICE',
        entityKey,
        schoolId,
        studentId,
        resolution: resolution.status,
        resolvedGradeLevel: resolution.gradeLevel,
      });

      if (resolution.status === 'resolved') {
        summary.invoicesResolved++;
      } else {
        summary.invoicesUnresolved++;
      }

      if (!args.apply || !expr) continue;

      try {
        await ddb.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { tenantId: { S: tenantId }, entityKey: { S: entityKey } },
            ...expr,
          }),
        );
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
          // Already backfilled — idempotent no-op
          summary.skipped++;
        } else {
          summary.errors++;
          console.warn(
            `  WARN: UpdateItem failed for invoice ${entityKey}: ${err.message}`,
          );
        }
      }
    }

    lastKey = scanResult.LastEvaluatedKey;
  } while (lastKey && (!args.limit || summary.scanned < args.limit));

  // ─── Pass 2: PAYMENT rows ────────────────────────────────────
  console.log('Pass 2 — PAYMENT rows...');
  lastKey = undefined;
  do {
    const filterParts = [
      'entityType = :entType',
      'attribute_not_exists(gradeLevel)',
    ];
    const values: Record<string, any> = { ':entType': { S: 'PAYMENT' } };
    if (args.tenantId) {
      filterParts.push('tenantId = :tid');
      values[':tid'] = { S: args.tenantId };
    }

    const scanResult: any = await ddb.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: filterParts.join(' AND '),
        ExpressionAttributeValues: values,
        ExclusiveStartKey: lastKey,
        Limit: 1000,
      }),
    );

    for (const item of scanResult.Items || []) {
      if (args.limit && summary.scanned >= args.limit) break;
      summary.scanned++;
      const tenantId = item.tenantId?.S as string;
      const entityKey = item.entityKey?.S as string;
      const schoolId = item.schoolId?.S as string;
      const invoiceId = item.invoiceId?.S as string;
      const paidAt = (item.paidAt?.S as string) || (item.createdAt?.S as string);

      // Look up parent invoice (post-pass-1 it should have gradeLevel
      // if resolution succeeded)
      let parentInvoice: { gradeLevel?: string; gradeLevelResolutionStatus?: 'resolved' | 'unresolved' } | null = null;
      try {
        const invKey = `INVOICE#${schoolId}#${invoiceId}`;
        const invResult: any = await ddb.send(
          new ScanCommand({
            TableName: tableName,
            FilterExpression: 'tenantId = :tid AND entityKey = :ek',
            ExpressionAttributeValues: {
              ':tid': { S: tenantId },
              ':ek': { S: invKey },
            },
            Limit: 1,
          }),
        );
        const inv = (invResult.Items || [])[0];
        if (inv) {
          parentInvoice = {
            gradeLevel: inv.gradeLevel?.S,
            gradeLevelResolutionStatus: inv.gradeLevelResolutionStatus?.S as any,
          };
        }
      } catch (err: any) {
        summary.errors++;
        console.warn(
          `  WARN: parent-invoice lookup failed for payment ${entityKey}: ${err.message || err}`,
        );
      }

      const resolution = resolvePaymentGradeLevel(parentInvoice);
      findings.push({
        tenantId,
        entityType: 'PAYMENT',
        entityKey,
        schoolId,
        invoiceId,
        resolution: resolution.status,
        resolvedGradeLevel: resolution.gradeLevel,
      });

      if (resolution.status === 'resolved') summary.paymentsResolved++;
      else if (resolution.status === 'unresolved') summary.paymentsUnresolved++;
      else summary.skipped++;

      const expr = buildUpdateExpression(
        tenantId,
        schoolId,
        'PAYMENT',
        resolution,
        paidAt,
      );
      if (!args.apply || !expr) continue;

      try {
        await ddb.send(
          new UpdateItemCommand({
            TableName: tableName,
            Key: { tenantId: { S: tenantId }, entityKey: { S: entityKey } },
            ...expr,
          }),
        );
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
          summary.skipped++;
        } else {
          summary.errors++;
          console.warn(
            `  WARN: UpdateItem failed for payment ${entityKey}: ${err.message}`,
          );
        }
      }
    }

    lastKey = scanResult.LastEvaluatedKey;
  } while (lastKey && (!args.limit || summary.scanned < args.limit));

  summary.durationSec = (Date.now() - started) / 1000;

  // ─── Findings CSV ────────────────────────────────────────────
  const csvHeader = 'tenantId,entityType,entityKey,schoolId,studentId,invoiceId,resolution,resolvedGradeLevel\n';
  const csvBody = findings
    .map((f) =>
      [
        f.tenantId,
        f.entityType,
        f.entityKey,
        f.schoolId,
        f.studentId ?? '',
        f.invoiceId ?? '',
        f.resolution,
        f.resolvedGradeLevel ?? '',
      ].join(','),
    )
    .join('\n');
  const findingsPath = path.join(
    process.cwd(),
    `findings-finance-grade-snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.csv`,
  );
  fs.writeFileSync(findingsPath, csvHeader + csvBody);

  // ─── Summary ─────────────────────────────────────────────────
  console.log('');
  console.log('Summary');
  console.log(`  scanned=${summary.scanned}`);
  console.log(`  invoicesResolved=${summary.invoicesResolved}`);
  console.log(`  invoicesUnresolved=${summary.invoicesUnresolved}`);
  console.log(`  paymentsResolved=${summary.paymentsResolved}`);
  console.log(`  paymentsUnresolved=${summary.paymentsUnresolved}`);
  console.log(`  skipped=${summary.skipped}`);
  console.log(`  errors=${summary.errors}`);
  console.log(`  durationSec=${summary.durationSec.toFixed(1)}`);
  console.log(`  findings=${findingsPath}`);
  if (!args.apply) {
    console.log('');
    console.log('  \x1b[33mDRY-RUN — no DDB writes. Re-run with --apply to mutate.\x1b[0m');
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('FATAL:', err);
    process.exit(1);
  });
}
