/**
 * grade-level-fix T5 (F-CONFIG-2) — orphan SchoolConfiguration GC.
 *
 * THROWAWAY ops script (same convention as the Sprint 0.5 scripts in
 * this directory). Scans `edforge-identity-basic` table-wide for rows
 * with `entityType='CONFIG' AND entityKey begins_with 'SCHOOL#'`, parses
 * the schoolId out of the entityKey (`SCHOOL#<uuid>#CONFIG`), and checks
 * whether the corresponding `SCHOOL#<uuid>` METADATA row exists in the
 * SAME (tenantId, entityKey) partition. If the METADATA row is missing,
 * the CONFIG row is orphaned — it has no parent school. List in dry-run,
 * DELETE in --apply.
 *
 * Why orphans exist
 * -----------------
 * Pre-T4 (PR #51), the identity service's `SchoolsService.getConfiguration`
 * and `updateConfiguration` would lazy-create a `DEFAULT_SCHOOL_CONFIG` row
 * (US-shape: en-US, America/New_York, A-F grading, Mon-Fri week) whenever
 * a caller hit those endpoints with a non-existent schoolId. The audit
 * (docs/grade-level-audit/05-school-provisioning-trace.md) found 2 such
 * orphan rows in dev-pabson-primary alone:
 *   - SCHOOL#6f63567b-5ffe-49c2-b527-ecc01e42cb81#CONFIG
 *   - SCHOOL#816c1535-08b7-4d93-a8e9-c97996b979fe#CONFIG
 *
 * T4 stopped the leak (404 on missing config, no silent lazy-create).
 * This script (T5) cleans up the orphans T4's leak already wrote. Prod
 * tenant-wide scan may surface more — especially in long-running tenants.
 *
 * Safety
 * ------
 * 1. Dry-run default — `--apply` required for mutation.
 * 2. The orphan check IS the structural safety: a row is only deleted
 *    if its parent METADATA row is confirmed missing. Re-checked
 *    immediately before each delete (race-window <100ms) to handle the
 *    unlikely case where a school is created concurrently.
 * 3. Audit log line for every deletion: tenantId, schoolId, the orphan
 *    CONFIG row's createdAt + createdBy + lastUpdatedAt, the deletion
 *    timestamp, and the operator's IAM principal.
 * 4. Output cap: dry-run prints first 50 orphans + summary count (so a
 *    bulk discovery doesn't spam the terminal).
 *
 * Usage
 * -----
 *   npx ts-node scripts/cleanup-orphans/orphan-school-configs.ts                 # dry-run, all tenants
 *   npx ts-node scripts/cleanup-orphans/orphan-school-configs.ts --apply         # destructive
 *   npx ts-node scripts/cleanup-orphans/orphan-school-configs.ts --tenant <id>   # scoped to one tenant
 *   npx ts-node scripts/cleanup-orphans/orphan-school-configs.ts --tenant <id> --apply
 *
 * Auth
 * ----
 * Dry-run mode requires only `dynamodb:Scan` + `dynamodb:GetItem` on
 * edforge-identity-basic. ReadOnlyAccess (currently attached to
 * `edforge-prod-deployer`) is sufficient.
 *
 * --apply mode also requires `dynamodb:DeleteItem`, which is NOT in
 * ReadOnlyAccess. Operator must temporarily attach an inline policy
 * granting `dynamodb:DeleteItem` on the target table ARN. See the
 * Sprint 0.5 README in this directory for the IAM-attachment recipe.
 */

import {
  DynamoDBClient,
  ScanCommand,
  GetItemCommand,
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
const TABLE = 'edforge-identity-basic';
const DRY_RUN_PRINT_CAP = 50;
const RATE_LIMIT_MS = 100; // small pause between deletes to be polite to DDB

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

interface OrphanCandidate {
  tenantId: string;
  entityKey: string; // SCHOOL#<schoolId>#CONFIG
  schoolId: string;
  createdAt?: string;
  createdBy?: string;
  updatedAt?: string;
}

// ============================================================================
// Scan for CONFIG rows
// ============================================================================

async function scanConfigRows(): Promise<OrphanCandidate[]> {
  const candidates: OrphanCandidate[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  let pageCount = 0;

  const filterParts = ['entityType = :ct', 'begins_with(entityKey, :pfx)'];
  const eav: Record<string, AttributeValue> = {
    ':ct': { S: 'CONFIG' },
    ':pfx': { S: 'SCHOOL#' },
  };
  if (tenantFilter) {
    filterParts.push('tenantId = :tid');
    eav[':tid'] = { S: tenantFilter };
  }

  do {
    const out = await ddb.send(
      new ScanCommand({
        TableName: TABLE,
        FilterExpression: filterParts.join(' AND '),
        ExpressionAttributeValues: eav,
        ProjectionExpression: 'tenantId, entityKey, createdAt, createdBy, updatedAt',
        ExclusiveStartKey: lastKey,
      }),
    );
    pageCount += 1;

    for (const item of out.Items ?? []) {
      const tenantId = item.tenantId?.S;
      const entityKey = item.entityKey?.S;
      if (!tenantId || !entityKey) continue;
      // Parse SCHOOL#<uuid>#CONFIG
      const m = entityKey.match(/^SCHOOL#([0-9a-fA-F-]{36})#CONFIG$/);
      if (!m) continue;
      candidates.push({
        tenantId,
        entityKey,
        schoolId: m[1],
        createdAt: item.createdAt?.S,
        createdBy: item.createdBy?.S,
        updatedAt: item.updatedAt?.S,
      });
    }
    lastKey = out.LastEvaluatedKey;
  } while (lastKey);

  console.error(`  [scan] paged ${pageCount} times; ${candidates.length} CONFIG rows found total`);
  return candidates;
}

// ============================================================================
// Classify: parent METADATA missing? → orphan
// ============================================================================

async function metadataExists(tenantId: string, schoolId: string): Promise<boolean> {
  const out = await ddb.send(
    new GetItemCommand({
      TableName: TABLE,
      Key: {
        tenantId: { S: tenantId },
        entityKey: { S: `SCHOOL#${schoolId}` },
      },
      ProjectionExpression: 'entityKey',
      ConsistentRead: true,
    }),
  );
  return out.Item !== undefined;
}

async function classifyOrphans(
  candidates: OrphanCandidate[],
): Promise<{ orphans: OrphanCandidate[]; realCount: number }> {
  const orphans: OrphanCandidate[] = [];
  let realCount = 0;
  for (const c of candidates) {
    const exists = await metadataExists(c.tenantId, c.schoolId);
    if (exists) realCount += 1;
    else orphans.push(c);
  }
  return { orphans, realCount };
}

// ============================================================================
// Audit log
// ============================================================================

function openAuditLog(callerArn: string): { logPath: string; append: (line: string) => void } {
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const mode = apply ? 'APPLY' : 'DRYRUN';
  const logPath = path.join(
    __dirname,
    '..',
    '..',
    'docs',
    'deploys',
    `prod-orphan-config-cleanup-T5-${ts}-${mode}.log`,
  );
  const stream = fs.createWriteStream(logPath, { flags: 'a' });
  stream.write(`# T5 / F-CONFIG-2 orphan SchoolConfiguration cleanup\n`);
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
  };
}

// ============================================================================
// Delete (apply mode)
// ============================================================================

async function deleteOrphan(
  c: OrphanCandidate,
  audit: (line: string) => void,
): Promise<'deleted' | 'metadata-appeared' | 'error'> {
  // Race-window mitigation: re-check the METADATA row right before
  // delete. If the school was created concurrently (vanishingly
  // unlikely for a row that's been orphaned for days), skip.
  const stillOrphan = !(await metadataExists(c.tenantId, c.schoolId));
  if (!stillOrphan) {
    audit(
      `SKIP\t${c.tenantId}\t${c.schoolId}\t# METADATA appeared between scan and delete — race with createSchool`,
    );
    return 'metadata-appeared';
  }

  try {
    await ddb.send(
      new DeleteItemCommand({
        TableName: TABLE,
        Key: {
          tenantId: { S: c.tenantId },
          entityKey: { S: c.entityKey },
        },
      }),
    );
    audit(
      `DELETE\t${c.tenantId}\t${c.schoolId}\tcreatedAt=${c.createdAt}\tcreatedBy=${c.createdBy}\tupdatedAt=${c.updatedAt}\tts=${new Date().toISOString()}`,
    );
    return 'deleted';
  } catch (e) {
    const err = e as { name?: string; message?: string };
    audit(`ERROR\t${c.tenantId}\t${c.schoolId}\t${err.name ?? '?'}\t${err.message ?? '?'}`);
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
  console.error(`  T5 / F-CONFIG-2 orphan SchoolConfiguration cleanup`);
  console.error(`  table:  ${TABLE}`);
  console.error(`  region: ${REGION}`);
  console.error(`  caller: ${callerArn}`);
  console.error(`  tenant: ${tenantFilter ?? '(all tenants)'}`);
  console.error(`  mode:   ${apply ? '\x1b[33mAPPLY (destructive)\x1b[0m' : '\x1b[32mDRY-RUN\x1b[0m'}`);
  console.error('============================================================');

  console.error('[1/3] scanning table for SCHOOL#*#CONFIG rows...');
  const candidates = await scanConfigRows();

  console.error('[2/3] classifying: GetItem on each parent METADATA row...');
  const { orphans, realCount } = await classifyOrphans(candidates);

  console.error('');
  console.error(`  ⇒ ${realCount} CONFIG rows have their parent SCHOOL METADATA (legitimate, not touching)`);
  console.error(`  ⇒ ${orphans.length} CONFIG rows are ORPHANED (no parent METADATA)`);
  console.error('');

  if (orphans.length === 0) {
    console.error('No orphans found. Nothing to do.');
    return;
  }

  // Print orphan sample
  const sample = orphans.slice(0, DRY_RUN_PRINT_CAP);
  console.log('# orphan candidates (table-format)');
  console.log('# tenantId\tschoolId\tcreatedAt\tcreatedBy\tupdatedAt');
  for (const o of sample) {
    console.log(
      `${o.tenantId}\t${o.schoolId}\t${o.createdAt ?? '?'}\t${o.createdBy ?? '?'}\t${o.updatedAt ?? '?'}`,
    );
  }
  if (orphans.length > sample.length) {
    console.log(`# ... and ${orphans.length - sample.length} more not shown`);
  }
  console.log('');

  const { logPath, append } = openAuditLog(callerArn);
  console.error(`[3/3] audit log: ${logPath}`);

  if (!apply) {
    append('# DRY-RUN only — no DDB writes performed.');
    append('# orphan candidates listed below:');
    for (const o of orphans) {
      append(
        `CANDIDATE\t${o.tenantId}\t${o.schoolId}\tcreatedAt=${o.createdAt}\tcreatedBy=${o.createdBy}`,
      );
    }
    console.error('');
    console.error('Dry-run complete. To actually delete: re-run with --apply.');
    return;
  }

  // APPLY MODE
  console.error('');
  console.error('\x1b[33m--apply mode: deleting orphans...\x1b[0m');
  let deleted = 0;
  let raced = 0;
  let errored = 0;
  for (const o of orphans) {
    const outcome = await deleteOrphan(o, append);
    if (outcome === 'deleted') deleted += 1;
    else if (outcome === 'metadata-appeared') raced += 1;
    else errored += 1;
    await new Promise((res) => setTimeout(res, RATE_LIMIT_MS));
  }
  append(`# ended:  ${new Date().toISOString()}`);
  append(`# deleted: ${deleted}, raced: ${raced}, errored: ${errored}`);

  console.error('');
  console.error('============================================================');
  console.error(`  Result: deleted=${deleted}, raced=${raced}, errored=${errored}`);
  console.error(`  Audit log: ${logPath}`);
  console.error('============================================================');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
