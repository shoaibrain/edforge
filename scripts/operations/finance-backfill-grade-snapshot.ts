/**
 * Sprint A.5 — finance-backfill-grade-snapshot (Codex round-1 hardening)
 *
 * Fills the gradeLevel snapshot on pre-A.1 INVOICE# rows and pre-A.2
 * PAYMENT# rows in the finance table. Both entities gain a sparse
 * gsi14pk/gsi14sk pair as a side-effect of the fill so the rows
 * become visible to GSI14 (school + gradeLevel) queries from
 * Sprint B.1 onward.
 *
 * AUTHENTICATION (Codex P1)
 * -------------------------
 * The academics `GET /academics/students/:studentId` endpoint is gated
 * by JwtAuthGuard + PermissionGuard. The script MUST pass a real
 * tenant-scoped admin JWT — without it, every academics call 401/403s
 * and the script silently marks all rows as 'unresolved', destroying
 * correct data on `--apply`.
 *
 * The token is supplied via `--token <jwt>` OR `OPERATOR_JWT` env var.
 * The script refuses to start if neither is set. The token's
 * `custom:tenantId` claim is used as the `x-tenant-id` header on the
 * academics call (the tenant scope of the script's reads MUST match
 * the JWT's claim).
 *
 * LOOKUP OUTCOME — tri-state (Codex P1)
 * -------------------------------------
 * Pre-fix collapsed every academics failure (404, 401, 500, timeout)
 * into a `null` studentInfo, then `resolveInvoiceGradeLevel(null)`
 * returned 'unresolved' and the script wrote that status on --apply.
 * That converted a transient academics outage into permanent data
 * corruption.
 *
 * Post-fix lookup returns one of:
 *   - { kind: 'found', gradeLevel: '4' }    → resolved (if non-empty grade) or unresolved (empty)
 *   - { kind: 'not_found' }                  → unresolved (student really doesn't exist)
 *   - { kind: 'lookup_failed', reason }      → SKIPPED — NO DDB write of any status
 *
 * Skipped rows are re-tried on the next run; nothing gets written
 * until we have authoritative academics data.
 *
 * DRY-RUN CONSISTENCY (Codex P1/P2)
 * ---------------------------------
 * Pre-fix the dry-run was materially misleading for payments. Pass 1
 * computed invoice resolutions WITHOUT writing them; Pass 2 then
 * read parent invoices back from DDB (still pre-A.1 state) and
 * mismarked payments as unresolved/skipped. Operators reviewing the
 * dry-run CSV would see far fewer payment resolutions than --apply
 * would actually produce.
 *
 * Post-fix Pass 1 populates an in-memory invoice resolution map.
 * Pass 2 consults the map FIRST for the parent invoice's resolution;
 * only falls back to DDB if the invoice was outside the backfill
 * scope (e.g. excluded by --limit / --tenant). Dry-run and --apply
 * now produce identical CSVs.
 *
 * Resolution order
 * ----------------
 *   - INVOICE: academics lookup → tri-state outcome → resolved /
 *     unresolved / skipped per above
 *   - PAYMENT: parent invoice from in-memory map → snapshot copy.
 *     Falls back to DDB only when parent isn't in our scan scope.
 *
 * Idempotency
 * -----------
 *   UpdateItem with `attribute_not_exists(gradeLevel)`. Re-runs are
 *   no-ops on already-filled rows. Skipped rows are NOT written so
 *   subsequent runs re-attempt them. Unresolved rows ARE written
 *   (the status flag), but re-runs can promote 'unresolved' →
 *   'resolved' if the academics record gets corrected later (the
 *   condition is on gradeLevel absence, not status absence).
 *
 * Safety
 * ------
 *   - Dry-run default; `--apply` required for mutation
 *   - `--tenant <id>` scopes to one tenant first
 *   - `--limit N` caps total rows processed
 *   - Per-row failure logged + skipped, never fatal
 *   - Findings CSV with `resolution` + `reason` columns so operators
 *     can hand-correct unresolved + investigate skipped causes
 *   - Audit log line per UpdateItem with tenantId, schoolId,
 *     entityType, entityId, old/new gradeLevel, status
 *
 * Usage
 * -----
 *   export OPERATOR_JWT=<admin jwt for the target tenant>
 *   npx ts-node scripts/operations/finance-backfill-grade-snapshot.ts             # dry-run
 *   npx ts-node scripts/operations/finance-backfill-grade-snapshot.ts --apply     # destructive
 *   npx ts-node scripts/operations/finance-backfill-grade-snapshot.ts --tenant <id>
 *   npx ts-node scripts/operations/finance-backfill-grade-snapshot.ts --limit 100
 *
 * Auth requirements
 * -----------------
 * AWS:       `dynamodb:Scan`, `dynamodb:UpdateItem` on `edforge-finance-*`
 * Academics: operator-provided JWT with read access to the target tenant's
 *            student records (TenantAdmin or higher).
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import axios, { AxiosError } from 'axios';

// ─────────────────────────────────────────
// Inline concurrency limiter (round-2 — parallelize academics lookups)
// ─────────────────────────────────────────

/**
 * Process `items` with at most `concurrency` workers running `fn` in
 * flight at once. Mirrors the shape of
 * `server/application/microservices/finance/src/bulk-ops/util/concurrency-limit.ts`
 * (PR #341 — Sprint E worker) but inlined here so the operational
 * script doesn't depend on a Nest microservice's source tree (the
 * script is a standalone `ts-node` entry point under `scripts/` and
 * cannot import from `server/application` without webpack tooling).
 *
 * Added 2026-06-29 after the first dry-run attempt against
 * `dev-pabson-primary` (~700 INVOICE rows missing gradeLevel) timed
 * out at 8 minutes of sequential per-row academics calls. The original
 * `for (item of items) await fn(item)` pattern was the bottleneck —
 * each row waits for the prior row's academics HTTP round-trip
 * (~1-2s in prod due to the CPU saturation finding tracked in #345).
 * At concurrency=8 the same 700 rows finish in ~90-180s.
 *
 * Why no library: the operational script is a single-file entrypoint;
 * adding a dep (p-limit, etc.) forces a `package.json` change at
 * repo root and a lockfile bump, both of which would broaden the PR's
 * blast radius beyond what's needed.
 */
export async function withConcurrencyLimit<T>(
  items: ReadonlyArray<T>,
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return;
  if (concurrency < 1) throw new Error('concurrency must be >= 1');
  const queue = items.map((item, index) => ({ item, index }));
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        if (next === undefined) return;
        await fn(next.item, next.index);
      }
    },
  );
  await Promise.all(workers);
}

const DEFAULT_LOOKUP_CONCURRENCY = 8;
const MAX_LOOKUP_CONCURRENCY = 32;

function readLookupConcurrency(): number {
  const raw = process.env.BACKFILL_LOOKUP_CONCURRENCY;
  if (!raw) return DEFAULT_LOOKUP_CONCURRENCY;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_LOOKUP_CONCURRENCY;
  return Math.min(parsed, MAX_LOOKUP_CONCURRENCY);
}

const PROGRESS_LOG_EVERY = 50;

// ─────────────────────────────────────────
// CLI args
// ─────────────────────────────────────────

interface Args {
  apply: boolean;
  tenantId?: string;
  limit?: number;
  token?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { apply: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.apply = true;
    else if (a === '--tenant') args.tenantId = argv[++i];
    else if (a === '--limit') args.limit = parseInt(argv[++i], 10);
    else if (a === '--token') args.token = argv[++i];
  }
  return args;
}

// ─────────────────────────────────────────
// Types
// ─────────────────────────────────────────

/**
 * Tri-state academics lookup outcome (Codex P1):
 *   - `found`         → student exists; gradeLevel is whatever academics says (may be empty)
 *   - `not_found`     → academics returned 404; student really doesn't exist
 *   - `lookup_failed` → 401/403/500/timeout/network — DO NOT WRITE anything for this row
 */
export type StudentLookupOutcome =
  | { kind: 'found'; gradeLevel: string }
  | { kind: 'not_found' }
  | { kind: 'lookup_failed'; reason: string };

/**
 * Resolution decision for a single row:
 *   - `resolved`   → write gradeLevel + gsi14pk/sk + status='resolved'
 *   - `unresolved` → write ONLY status='unresolved' (sparse on GSI14)
 *   - `skipped`    → write NOTHING (transient failure; re-try next run)
 */
export type ResolutionDecision =
  | { status: 'resolved'; gradeLevel: string }
  | { status: 'unresolved' }
  | { status: 'skipped'; reason: string };

interface BackfillFinding {
  tenantId: string;
  entityType: 'INVOICE' | 'PAYMENT';
  entityKey: string;
  schoolId: string;
  studentId?: string;
  invoiceId?: string;
  resolution: ResolutionDecision['status'];
  resolvedGradeLevel?: string;
  reason?: string;
}

interface BackfillSummary {
  scanned: number;
  invoicesResolved: number;
  invoicesUnresolved: number;
  invoicesSkipped: number;
  paymentsResolved: number;
  paymentsUnresolved: number;
  paymentsSkipped: number;
  alreadyFilled: number;
  errors: number;
  durationSec: number;
}

// ─────────────────────────────────────────
// Pure helpers — unit-testable, no DDB / network
// ─────────────────────────────────────────

/**
 * Decide the resolution outcome for an invoice given the academics
 * lookup result. Pure function — no DDB / network in here so the
 * unit spec can drive it with simple fixtures.
 */
export function resolveInvoiceGradeLevel(
  outcome: StudentLookupOutcome,
): ResolutionDecision {
  switch (outcome.kind) {
    case 'found':
      // Academics returned an answer. Empty string → student exists
      // but has no grade set (e.g. just enrolled, awaiting placement).
      // Mark unresolved so the row stays sparse on GSI14 and the
      // "Unknown" UI bucket surfaces it for operator follow-up.
      return outcome.gradeLevel
        ? { status: 'resolved', gradeLevel: outcome.gradeLevel }
        : { status: 'unresolved' };
    case 'not_found':
      // Academics 404 — the student record itself doesn't exist
      // (graduated, withdrawn, or invoice was created for a
      // pre-deletion student). Mark unresolved.
      return { status: 'unresolved' };
    case 'lookup_failed':
      // Transient failure — auth, network, 5xx. DO NOT write
      // anything. The row stays in pre-backfill state so the next
      // run can re-attempt with authoritative data.
      return { status: 'skipped', reason: outcome.reason };
  }
}

/**
 * Decide the payment's snapshot given the parent invoice's resolution
 * (from the in-memory map). Pure function.
 *
 * Note the explicit "parent invoice resolution unknown" case: when
 * the payment's parent invoice was outside the backfill scan scope
 * (--limit cut off, --tenant excluded), the in-memory map has no
 * entry. The caller must fall back to a DDB GetItem on the invoice
 * BEFORE calling this — passing `null` here always returns 'skipped'
 * so we never overwrite a payment with an inferred-from-nothing value.
 */
export function resolvePaymentGradeLevel(
  parentInvoiceResolution: ResolutionDecision | null,
): ResolutionDecision {
  if (!parentInvoiceResolution) {
    return {
      status: 'skipped',
      reason: 'parent_invoice_outside_backfill_scope',
    };
  }
  switch (parentInvoiceResolution.status) {
    case 'resolved':
      return { status: 'resolved', gradeLevel: parentInvoiceResolution.gradeLevel };
    case 'unresolved':
      return { status: 'unresolved' };
    case 'skipped':
      // Parent invoice was skipped (e.g. academics lookup failed).
      // Don't snapshot what we don't know — re-try with parent on
      // the next run.
      return {
        status: 'skipped',
        reason: `parent_invoice_skipped:${parentInvoiceResolution.reason}`,
      };
  }
}

/**
 * Build the UpdateItem expression for filling the snapshot.
 * Returns `null` when the resolution is `skipped` (no DDB write).
 */
export function buildUpdateExpression(
  tenantId: string,
  schoolId: string,
  entityType: 'INVOICE' | 'PAYMENT',
  resolution: ResolutionDecision,
  issuedOrPaidDate: string,
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

  if (resolution.status === 'resolved') {
    setParts.push('gradeLevel = :gl');
    setParts.push('gsi14pk = :gsi14pk');
    setParts.push('gsi14sk = :gsi14sk');
    values[':gl'] = { S: resolution.gradeLevel };
    values[':gsi14pk'] = {
      S: `TENANT#${tenantId}#SCHOOL#${schoolId}#GRADE#${resolution.gradeLevel}`,
    };
    values[':gsi14sk'] = {
      S: `${entityType}#${issuedOrPaidDate}`,
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

/**
 * Extract `custom:tenantId` from a Cognito JWT (the second
 * dot-separated segment, base64-decoded as JSON). Used to scope the
 * `x-tenant-id` header on academics calls — academics requires it to
 * match the JWT's tenantId claim.
 */
export function extractTenantIdFromJwt(jwt: string): string {
  try {
    const segments = jwt.split('.');
    if (segments.length < 2) return '';
    const payload = JSON.parse(
      Buffer.from(segments[1], 'base64').toString(),
    );
    return payload['custom:tenantId'] || '';
  } catch {
    return '';
  }
}

// ─────────────────────────────────────────
// I/O wrapper — separates the academics call from the resolution logic
// ─────────────────────────────────────────

interface AcademicsClient {
  lookupStudent(studentId: string, schoolId: string): Promise<StudentLookupOutcome>;
}

function makeAcademicsClient(
  academicsUrl: string,
  jwt: string,
  jwtTenantId: string,
): AcademicsClient {
  return {
    async lookupStudent(studentId, schoolId) {
      try {
        const resp = await axios.get(
          `${academicsUrl}/academics/students/${studentId}`,
          {
            params: { schoolId },
            timeout: 8_000,
            headers: {
              Authorization: `Bearer ${jwt}`,
              'x-tenant-id': jwtTenantId,
            },
            // Treat any 2xx/3xx as success; let try/catch handle 4xx/5xx.
          },
        );
        const d = resp.data || {};
        return {
          kind: 'found',
          gradeLevel: d.currentGradeLevel || d.gradeLevel || '',
        };
      } catch (err) {
        const ax = err as AxiosError;
        if (ax.response?.status === 404) {
          return { kind: 'not_found' };
        }
        const reason = ax.response
          ? `http_${ax.response.status}`
          : ax.code
          ? `network_${ax.code}`
          : `unknown_${String(err).slice(0, 60)}`;
        return { kind: 'lookup_failed', reason };
      }
    },
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
  const jwt = args.token || process.env.OPERATOR_JWT || '';

  if (!jwt) {
    console.error(
      '\x1b[31mERROR\x1b[0m: operator JWT required. Pass --token <jwt> or set OPERATOR_JWT.',
    );
    console.error(
      '       The academics student-lookup endpoint is gated by JwtAuthGuard;',
    );
    console.error(
      '       without a real token every lookup fails and the script silently',
    );
    console.error(
      '       marks rows as unresolved on --apply (Codex P1).',
    );
    process.exit(1);
  }

  const jwtTenantId = extractTenantIdFromJwt(jwt);
  if (!jwtTenantId) {
    console.error(
      '\x1b[31mERROR\x1b[0m: could not extract custom:tenantId from the provided JWT.',
    );
    process.exit(1);
  }

  console.log('finance-backfill-grade-snapshot (Sprint A.5 — Codex round-1 hardening)');
  console.log(`  region=${region} table=${tableName}`);
  console.log(`  mode=${args.apply ? '\x1b[31mAPPLY\x1b[0m' : 'DRY-RUN'}`);
  console.log(`  jwtTenantId=${jwtTenantId}`);
  if (args.tenantId) console.log(`  tenant=${args.tenantId}`);
  if (args.limit) console.log(`  limit=${args.limit}`);
  console.log('');

  if (args.tenantId && args.tenantId !== jwtTenantId) {
    console.warn(
      `\x1b[33mWARN\x1b[0m: --tenant=${args.tenantId} but JWT tenantId=${jwtTenantId}. ` +
        `Academics lookups will use the JWT's tenant scope — they may 403 on cross-tenant rows.`,
    );
  }

  const ddb = new DynamoDBClient({ region });
  const academics = makeAcademicsClient(academicsUrl, jwt, jwtTenantId);
  const started = Date.now();
  const findings: BackfillFinding[] = [];
  const summary: BackfillSummary = {
    scanned: 0,
    invoicesResolved: 0,
    invoicesUnresolved: 0,
    invoicesSkipped: 0,
    paymentsResolved: 0,
    paymentsUnresolved: 0,
    paymentsSkipped: 0,
    alreadyFilled: 0,
    errors: 0,
    durationSec: 0,
  };

  // Codex P1/P2 fix — in-memory invoice resolution map. Pass 1
  // populates this so Pass 2 doesn't re-read parent invoices from
  // DDB (which would still be in pre-A.1 state in dry-run, producing
  // a materially misleading CSV). Keyed by invoiceId.
  const invoiceResolutionMap = new Map<string, ResolutionDecision>();

  // ─── Pass 1: INVOICE rows ────────────────────────────────────
  const lookupConcurrency = readLookupConcurrency();
  console.log(`Pass 1 — INVOICE rows (lookup concurrency = ${lookupConcurrency})...`);
  let lastKey: Record<string, any> | undefined;
  do {
    const filterParts = [
      'entityType = :entType',
      'attribute_not_exists(gradeLevel)',
    ];
    const values: Record<string, any> = { ':entType': { S: 'INVOICE' } };
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

    // Round-2 (2026-06-29): the per-row body parallelizes via
    // `withConcurrencyLimit`. Trim the page to the remaining --limit
    // budget BEFORE dispatching so we don't over-run the cap with
    // concurrent workers in flight. The per-page math is:
    //   remaining_budget = args.limit ? max(0, args.limit - summary.scanned) : Infinity
    //   pageItems = page.slice(0, remaining_budget)
    const remainingBudget = args.limit
      ? Math.max(0, args.limit - summary.scanned)
      : Number.POSITIVE_INFINITY;
    const pageItems = (scanResult.Items || []).slice(0, remainingBudget);
    summary.scanned += pageItems.length;

    await withConcurrencyLimit(pageItems, lookupConcurrency, async (item: any) => {
      const tenantId = item.tenantId?.S as string;
      const entityKey = item.entityKey?.S as string;
      const schoolId = item.schoolId?.S as string;
      const studentId = item.studentId?.S as string;
      const invoiceId = item.invoiceId?.S as string;
      const issuedDate = item.issuedDate?.S as string;

      const lookupOutcome = await academics.lookupStudent(studentId, schoolId);
      const resolution = resolveInvoiceGradeLevel(lookupOutcome);
      // Codex P1/P2 — record every invoice's resolution in the map,
      // including skipped ones, so Pass 2 makes the same decision
      // regardless of dry-run vs apply. Map.set is safe under the
      // concurrency limiter because each iteration runs to completion
      // before yielding the worker slot (no map-update interleaving
      // race).
      invoiceResolutionMap.set(invoiceId, resolution);

      findings.push({
        tenantId,
        entityType: 'INVOICE',
        entityKey,
        schoolId,
        studentId,
        invoiceId,
        resolution: resolution.status,
        resolvedGradeLevel: resolution.status === 'resolved' ? resolution.gradeLevel : undefined,
        reason: resolution.status === 'skipped' ? resolution.reason : undefined,
      });

      if (resolution.status === 'resolved') summary.invoicesResolved++;
      else if (resolution.status === 'unresolved') summary.invoicesUnresolved++;
      else summary.invoicesSkipped++;

      // Progress logging every PROGRESS_LOG_EVERY rows. The check is
      // best-effort under concurrency — two workers can both observe
      // the modulo simultaneously and double-log a given milestone,
      // which is fine (operator-visible noise, not data corruption).
      const completed = summary.invoicesResolved + summary.invoicesUnresolved + summary.invoicesSkipped;
      if (completed % PROGRESS_LOG_EVERY === 0) {
        console.log(
          `  progress: invoices completed=${completed} ` +
            `(resolved=${summary.invoicesResolved} unresolved=${summary.invoicesUnresolved} skipped=${summary.invoicesSkipped})`,
        );
      }

      const expr = buildUpdateExpression(
        tenantId,
        schoolId,
        'INVOICE',
        resolution,
        issuedDate,
      );
      if (!args.apply || !expr) return;

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
          summary.alreadyFilled++;
        } else {
          summary.errors++;
          console.warn(
            `  WARN: UpdateItem failed for invoice ${entityKey}: ${err.message}`,
          );
        }
      }
    });

    lastKey = scanResult.LastEvaluatedKey;
  } while (lastKey && (!args.limit || summary.scanned < args.limit));

  // ─── Pass 2: PAYMENT rows ────────────────────────────────────
  console.log(`Pass 2 — PAYMENT rows (parallelism = ${lookupConcurrency})...`);
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

    const remainingBudget = args.limit
      ? Math.max(0, args.limit - summary.scanned)
      : Number.POSITIVE_INFINITY;
    const pageItems = (scanResult.Items || []).slice(0, remainingBudget);
    summary.scanned += pageItems.length;

    await withConcurrencyLimit(pageItems, lookupConcurrency, async (item: any) => {
      const tenantId = item.tenantId?.S as string;
      const entityKey = item.entityKey?.S as string;
      const schoolId = item.schoolId?.S as string;
      const invoiceId = item.invoiceId?.S as string;
      const paidAt = (item.paidAt?.S as string) || (item.createdAt?.S as string);

      // Codex P1/P2 — prefer the in-memory map from Pass 1. Falls
      // back to a DDB read ONLY when the parent invoice was outside
      // the backfill scan scope (--limit cutoff or pre-existing
      // resolved invoice that Pass 1's `attribute_not_exists` filter
      // already excluded).
      let parentResolution: ResolutionDecision | null =
        invoiceResolutionMap.get(invoiceId) ?? null;

      if (!parentResolution) {
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
          if (inv && inv.gradeLevel?.S) {
            // Invoice was already filled (pre-backfill or by an
            // earlier --apply run) — snapshot from its persisted value.
            parentResolution = {
              status: 'resolved',
              gradeLevel: inv.gradeLevel.S,
            };
          } else if (inv && inv.gradeLevelResolutionStatus?.S === 'unresolved') {
            parentResolution = { status: 'unresolved' };
          }
          // Otherwise leave parentResolution null → resolvePaymentGradeLevel
          // returns 'skipped' with reason 'parent_invoice_outside_backfill_scope'
        } catch (err: any) {
          summary.errors++;
          console.warn(
            `  WARN: parent-invoice lookup failed for payment ${entityKey}: ${err.message || err}`,
          );
        }
      }

      const resolution = resolvePaymentGradeLevel(parentResolution);

      findings.push({
        tenantId,
        entityType: 'PAYMENT',
        entityKey,
        schoolId,
        invoiceId,
        resolution: resolution.status,
        resolvedGradeLevel: resolution.status === 'resolved' ? resolution.gradeLevel : undefined,
        reason: resolution.status === 'skipped' ? resolution.reason : undefined,
      });

      if (resolution.status === 'resolved') summary.paymentsResolved++;
      else if (resolution.status === 'unresolved') summary.paymentsUnresolved++;
      else summary.paymentsSkipped++;

      // Progress logging — same best-effort modulo as Pass 1.
      const completed = summary.paymentsResolved + summary.paymentsUnresolved + summary.paymentsSkipped;
      if (completed % PROGRESS_LOG_EVERY === 0) {
        console.log(
          `  progress: payments completed=${completed} ` +
            `(resolved=${summary.paymentsResolved} unresolved=${summary.paymentsUnresolved} skipped=${summary.paymentsSkipped})`,
        );
      }

      const expr = buildUpdateExpression(
        tenantId,
        schoolId,
        'PAYMENT',
        resolution,
        paidAt,
      );
      if (!args.apply || !expr) return;

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
          summary.alreadyFilled++;
        } else {
          summary.errors++;
          console.warn(
            `  WARN: UpdateItem failed for payment ${entityKey}: ${err.message}`,
          );
        }
      }
    });

    lastKey = scanResult.LastEvaluatedKey;
  } while (lastKey && (!args.limit || summary.scanned < args.limit));

  summary.durationSec = (Date.now() - started) / 1000;

  // ─── Findings CSV ────────────────────────────────────────────
  const csvHeader = 'tenantId,entityType,entityKey,schoolId,studentId,invoiceId,resolution,resolvedGradeLevel,reason\n';
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
        f.reason ?? '',
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
  console.log(`  invoicesSkipped=${summary.invoicesSkipped}`);
  console.log(`  paymentsResolved=${summary.paymentsResolved}`);
  console.log(`  paymentsUnresolved=${summary.paymentsUnresolved}`);
  console.log(`  paymentsSkipped=${summary.paymentsSkipped}`);
  console.log(`  alreadyFilled=${summary.alreadyFilled}`);
  console.log(`  errors=${summary.errors}`);
  console.log(`  durationSec=${summary.durationSec.toFixed(1)}`);
  console.log(`  findings=${findingsPath}`);
  if (summary.invoicesSkipped + summary.paymentsSkipped > 0) {
    console.log('');
    console.log(
      `  \x1b[33mNOTE\x1b[0m: ${summary.invoicesSkipped + summary.paymentsSkipped} rows were SKIPPED ` +
        `(no DDB write). Re-run after investigating the 'reason' column in the findings CSV.`,
    );
  }
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
