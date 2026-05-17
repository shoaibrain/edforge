/**
 * C0.b.2 — S3.2 smoke artifact cleanup.
 *
 * THROWAWAY ops script (same convention as `orphan-school-configs.ts`).
 * Removes the residual rows left behind by S3.2 smoke runs prior to
 * C0.b.1 (PR #104): 2 stuck Leave rows that couldn't be cancelled (the
 * cancel path 500'd before C0.b.1) and 2 Calendar `S32-SMOKE-*` rows
 * (the calendar entity has no DELETE endpoint, so the smoke labelled
 * them and left them in place by design).
 *
 * What it identifies
 * ------------------
 *   1. Calendar rows: entityType='CALENDAR' AND calendarCode begins_with
 *      'S32-SMOKE-' — exact marker the smoke writes (line 342:
 *      `const calendarCode = \`S32-SMOKE-${stamp}\`;`).
 *   2. Leave rows: entityType='LEAVE' AND reason contains 'S3.2 smoke'
 *      — the smoke writes `reason: \`S3.2 smoke — ok to ignore. stamp=...\``
 *      (line 284). After C0.b.1's cancel-path fix, future smoke runs
 *      cancel cleanly; this script removes the historical residue only.
 *
 * Safety
 * ------
 *   1. Dry-run default — `--apply` required for mutation.
 *   2. Marker-based identification — only rows the smoke itself wrote
 *      are eligible. Operator-created leave/calendar rows have neither
 *      `S3.2 smoke` in their reason nor `S32-SMOKE-` calendarCodes.
 *   3. Audit log per deletion: tenantId, entityKey, identifying field
 *      (calendarCode or reason), timestamps, caller's IAM principal.
 *   4. Rate-limited deletes (100ms gap) to be polite to DDB.
 *
 * Usage
 * -----
 *   npx ts-node scripts/cleanup-orphans/s3-2-smoke-artifacts.ts                 # dry-run, all tenants
 *   npx ts-node scripts/cleanup-orphans/s3-2-smoke-artifacts.ts --apply         # destructive
 *   npx ts-node scripts/cleanup-orphans/s3-2-smoke-artifacts.ts --tenant <id>   # scoped to one tenant
 *   npx ts-node scripts/cleanup-orphans/s3-2-smoke-artifacts.ts --tenant <id> --apply
 *
 * Auth
 * ----
 * Dry-run mode requires only `dynamodb:Scan` on `edforge-identity-basic`.
 * `--apply` mode requires `dynamodb:DeleteItem` — operator must
 * temporarily attach an inline policy per the Sprint 0.5 README in this
 * directory.
 */

import {
  DynamoDBClient,
  ScanCommand,
  DeleteItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================================
// Config
// ============================================================================

const REGION = process.env.AWS_REGION || 'ap-south-1';
const TABLE = process.env.IDENTITY_TABLE || 'edforge-identity-basic';
const RATE_LIMIT_MS = 100;

const ddb = new DynamoDBClient({ region: REGION });
const sts = new STSClient({ region: REGION });

// ============================================================================
// Args
// ============================================================================

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const tenantIdx = args.findIndex((a) => a === '--tenant');
const tenantFilter = tenantIdx >= 0 ? args[tenantIdx + 1] : undefined;

if (tenantIdx >= 0 && !tenantFilter) {
  console.error('Usage error: --tenant requires a tenantId argument');
  process.exit(2);
}

// ============================================================================
// Types
// ============================================================================

interface Artifact {
  tenantId: string;
  entityKey: string;
  kind: 'CALENDAR' | 'LEAVE';
  /** For CALENDAR: calendarCode. For LEAVE: the reason string. */
  marker: string;
  createdAt?: string;
  createdBy?: string;
}

// ============================================================================
// Scans
// ============================================================================

async function scanCalendarSmokeRows(): Promise<Artifact[]> {
  const out: Artifact[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;

  const filterParts = [
    'entityType = :ct',
    'begins_with(calendarCode, :pfx)',
  ];
  const eav: Record<string, AttributeValue> = {
    ':ct': { S: 'CALENDAR' },
    ':pfx': { S: 'S32-SMOKE-' },
  };
  if (tenantFilter) {
    filterParts.push('tenantId = :tid');
    eav[':tid'] = { S: tenantFilter };
  }

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: filterParts.join(' AND '),
        ExpressionAttributeValues: eav,
        ProjectionExpression: 'tenantId, entityKey, calendarCode, createdAt, createdBy',
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const tenantId = item.tenantId?.S;
      const entityKey = item.entityKey?.S;
      const calendarCode = item.calendarCode?.S;
      if (!tenantId || !entityKey || !calendarCode) continue;
      out.push({
        tenantId,
        entityKey,
        kind: 'CALENDAR',
        marker: calendarCode,
        createdAt: item.createdAt?.S,
        createdBy: item.createdBy?.S,
      });
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return out;
}

async function scanLeaveSmokeRows(): Promise<Artifact[]> {
  const out: Artifact[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;

  // `contains(reason, :marker)` — picks up the smoke's
  // `reason: "S3.2 smoke — ok to ignore. stamp=..."`. The marker is
  // distinctive enough that no operator-created leave will collide.
  const filterParts = [
    'entityType = :ct',
    'contains(#r, :marker)',
  ];
  const ean: Record<string, string> = { '#r': 'reason' };
  const eav: Record<string, AttributeValue> = {
    ':ct': { S: 'LEAVE' },
    ':marker': { S: 'S3.2 smoke' },
  };
  if (tenantFilter) {
    filterParts.push('tenantId = :tid');
    eav[':tid'] = { S: tenantFilter };
  }

  do {
    const res = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: filterParts.join(' AND '),
        ExpressionAttributeNames: ean,
        ExpressionAttributeValues: eav,
        ProjectionExpression: 'tenantId, entityKey, #r, createdAt, createdBy',
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of res.Items ?? []) {
      const tenantId = item.tenantId?.S;
      const entityKey = item.entityKey?.S;
      const reason = item.reason?.S;
      if (!tenantId || !entityKey || !reason) continue;
      out.push({
        tenantId,
        entityKey,
        kind: 'LEAVE',
        marker: reason,
        createdAt: item.createdAt?.S,
        createdBy: item.createdBy?.S,
      });
    }
    lastKey = res.LastEvaluatedKey;
  } while (lastKey);

  return out;
}

// ============================================================================
// Audit log
// ============================================================================

function openAuditLog(callerArn: string): {
  logPath: string;
  append: (line: string) => void;
  close: () => void;
} {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const mode = apply ? 'APPLY' : 'DRYRUN';
  const logPath = path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'deploys',
    `prod-s3-2-smoke-cleanup-${ts}-${mode}.log`,
  );
  const stream = fs.createWriteStream(logPath, { flags: 'a' });
  stream.write(`# C0.b.2 — S3.2 smoke artifact cleanup\n`);
  stream.write(`# mode:    ${mode}\n`);
  stream.write(`# region:  ${REGION}\n`);
  stream.write(`# table:   ${TABLE}\n`);
  stream.write(`# tenant:  ${tenantFilter ?? '(all)'}\n`);
  stream.write(`# caller:  ${callerArn}\n`);
  stream.write(`# started: ${new Date().toISOString()}\n`);
  stream.write(`#\n`);
  return {
    logPath,
    append: (line: string) => stream.write(line + '\n'),
    close: () => stream.end(),
  };
}

// ============================================================================
// Delete
// ============================================================================

async function deleteOne(
  a: Artifact,
  audit: (line: string) => void,
): Promise<'deleted' | 'error'> {
  try {
    await ddb.send(
      new DeleteItemCommand({
        TableName: TABLE,
        Key: {
          tenantId: { S: a.tenantId },
          entityKey: { S: a.entityKey },
        },
      }),
    );
    audit(
      `DELETE\t${a.kind}\t${a.tenantId}\t${a.entityKey}\tmarker="${a.marker}"\tcreatedAt=${a.createdAt ?? '?'}\tts=${new Date().toISOString()}`,
    );
    return 'deleted';
  } catch (e) {
    const err = e as { name?: string; message?: string };
    audit(
      `ERROR\t${a.kind}\t${a.tenantId}\t${a.entityKey}\t${err.name ?? '?'}\t${err.message ?? '?'}`,
    );
    return 'error';
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  const caller = await sts.send(new GetCallerIdentityCommand({}));
  const callerArn = caller.Arn ?? '(unknown)';

  console.error('');
  console.error('============================================================');
  console.error(`  C0.b.2 — S3.2 smoke artifact cleanup`);
  console.error(`  table:  ${TABLE}`);
  console.error(`  region: ${REGION}`);
  console.error(`  caller: ${callerArn}`);
  console.error(`  tenant: ${tenantFilter ?? '(all tenants)'}`);
  console.error(
    `  mode:   ${apply ? '\x1b[33mAPPLY (destructive)\x1b[0m' : '\x1b[32mDRY-RUN\x1b[0m'}`,
  );
  console.error('============================================================');

  console.error('[1/2] scanning for S3.2 smoke artifacts...');
  const [calendarArtifacts, leaveArtifacts] = await Promise.all([
    scanCalendarSmokeRows(),
    scanLeaveSmokeRows(),
  ]);
  const all = [...calendarArtifacts, ...leaveArtifacts];

  console.error('');
  console.error(`  CALENDAR (S32-SMOKE-*) rows: ${calendarArtifacts.length}`);
  console.error(`  LEAVE (reason ~ "S3.2 smoke") rows: ${leaveArtifacts.length}`);
  console.error(`  Total artifacts: ${all.length}`);
  console.error('');

  if (all.length === 0) {
    console.error('No artifacts found. Nothing to do.');
    return;
  }

  // Print sample
  console.log('# artifacts (table-format)');
  console.log('# kind\ttenantId\tentityKey\tmarker\tcreatedAt');
  for (const a of all) {
    console.log(
      `${a.kind}\t${a.tenantId}\t${a.entityKey}\t${a.marker}\t${a.createdAt ?? '?'}`,
    );
  }
  console.log('');

  const { logPath, append, close } = openAuditLog(callerArn);
  console.error(`[2/2] audit log: ${logPath}`);

  if (!apply) {
    append('# DRY-RUN only — no DDB writes performed.');
    for (const a of all) {
      append(
        `CANDIDATE\t${a.kind}\t${a.tenantId}\t${a.entityKey}\tmarker="${a.marker}"`,
      );
    }
    close();
    console.error('');
    console.error('Dry-run complete. To actually delete: re-run with --apply.');
    return;
  }

  // APPLY MODE
  console.error('');
  console.error('\x1b[33m--apply mode: deleting artifacts...\x1b[0m');
  let deleted = 0;
  let errored = 0;
  for (const a of all) {
    const outcome = await deleteOne(a, append);
    if (outcome === 'deleted') deleted += 1;
    else errored += 1;
    await new Promise((res) => setTimeout(res, RATE_LIMIT_MS));
  }
  append(`# ended:  ${new Date().toISOString()}`);
  append(`# deleted: ${deleted}, errored: ${errored}`);
  close();

  console.error('');
  console.error('============================================================');
  console.error(`  Result: deleted=${deleted}, errored=${errored}`);
  console.error(`  Audit log: ${logPath}`);
  console.error('============================================================');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
