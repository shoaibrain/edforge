/// <reference types="node" />
/**
 * Sprint C2.T3 — backfill BILLING_ACCOUNT_LOOKUP mirror rows for existing accounts.
 *
 * Sprint C2.T3 added a mirror row at SK `ACCOUNT#<accountId>` so that
 * `StudentAccountsService.getByAccountId` can do an O(1) GetItem instead of
 * the prior O(N) GSI1 + filter scan, AND so Sprint C2.T4 can include the
 * lookup as a transactional pre-condition. New BillingAccounts get the
 * mirror automatically (atomic transaction in `getOrCreate`). This script
 * fills in mirrors for accounts that pre-date the deploy.
 *
 * Idempotent: each Put uses `attribute_not_exists(entityKey)`. Running
 * twice is safe — the second pass simply skips already-mirrored accounts.
 *
 * Read-only on `BILLING_ACCOUNT` rows; only writes new `BILLING_ACCOUNT_LOOKUP`
 * rows. Does NOT modify existing accounts.
 *
 * Usage (UAT):
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/operations/finance-backfill-account-lookup.ts \
 *     --table edforge-finance-basic --region ap-south-1
 *
 * Usage (PROD):
 *   AWS_PROFILE=prod npx ts-node --compiler-options '{"module":"commonjs"}' \
 *     scripts/operations/finance-backfill-account-lookup.ts \
 *     --table edforge-finance-basic --region ap-south-1
 *
 * Optional flags:
 *   --dry-run       Scan + report the work, write nothing.
 *   --limit N       Cap the number of mirrors written this run (resume-friendly).
 *
 * Output: progress to stderr, a final summary to stdout. Tee to
 * docs/deploys/<env>-backfill-account-lookup-<ts>-<sha>.log.
 *
 * Exit 0 = success (or dry-run completion); 1 = runtime failure.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  PutCommand,
} from '@aws-sdk/lib-dynamodb';

interface Args {
  table: string;
  region: string;
  dryRun: boolean;
  limit: number;
}

interface BillingAccountRow {
  tenantId: string;
  entityKey: string;
  accountId?: string;
  schoolId?: string;
  studentId?: string;
}

function parseArgs(argv: string[]): Args {
  const get = (flag: string, fallback?: string): string => {
    const i = argv.indexOf(flag);
    if (i === -1) {
      if (fallback === undefined) throw new Error(`Missing required arg: ${flag}`);
      return fallback;
    }
    const v = argv[i + 1];
    if (!v) throw new Error(`Missing value for ${flag}`);
    return v;
  };
  return {
    table: get('--table'),
    region: get('--region'),
    dryRun: argv.includes('--dry-run'),
    limit: parseInt(get('--limit', '0'), 10) || Infinity,
  };
}

async function* scanBillingAccounts(
  doc: DynamoDBDocumentClient,
  table: string,
): AsyncGenerator<BillingAccountRow, void, void> {
  let exclusiveStartKey: Record<string, unknown> | undefined;
  do {
    const r = await doc.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: 'entityType = :type',
        ExpressionAttributeValues: { ':type': 'BILLING_ACCOUNT' },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    if (r.Items) {
      for (const item of r.Items as BillingAccountRow[]) {
        yield item;
      }
    }
    exclusiveStartKey = r.LastEvaluatedKey;
  } while (exclusiveStartKey);
}

async function lookupExists(
  doc: DynamoDBDocumentClient,
  table: string,
  tenantId: string,
  accountId: string,
): Promise<boolean> {
  // Use a conditional Put with attribute_not_exists as the existence check —
  // but only when actually writing. For pre-flight (dry run) and skip-tracking
  // we use a thin GetItem against the mirror SK. Cheaper than the conditional
  // failure path because we're often skipping already-backfilled rows.
  const r = await doc.send(
    new (await import('@aws-sdk/lib-dynamodb')).GetCommand({
      TableName: table,
      Key: { tenantId, entityKey: `ACCOUNT#${accountId}` },
      ProjectionExpression: 'entityKey',
      ConsistentRead: true,
    }),
  );
  return Boolean(r.Item);
}

async function writeLookup(
  doc: DynamoDBDocumentClient,
  table: string,
  row: BillingAccountRow,
): Promise<void> {
  const now = new Date().toISOString();
  const item = {
    tenantId: row.tenantId,
    entityKey: `ACCOUNT#${row.accountId}`,
    entityType: 'BILLING_ACCOUNT_LOOKUP' as const,
    accountId: row.accountId,
    schoolId: row.schoolId,
    studentId: row.studentId,
    billingAccountKey: row.entityKey,
    createdAt: now,
    createdBy: 'backfill-c2-t3',
    updatedAt: now,
    updatedBy: 'backfill-c2-t3',
    version: 1,
  };
  await doc.send(
    new PutCommand({
      TableName: table,
      Item: item,
      ConditionExpression: 'attribute_not_exists(entityKey)',
    }),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ddb = new DynamoDBClient({ region: args.region });
  const doc = DynamoDBDocumentClient.from(ddb, {
    marshallOptions: { removeUndefinedValues: true },
  });

  process.stderr.write(
    `[backfill] table=${args.table} region=${args.region} dryRun=${args.dryRun} limit=${args.limit === Infinity ? 'unlimited' : args.limit}\n`,
  );

  let scanned = 0;
  let skipped = 0;
  let written = 0;
  let invalid = 0;

  for await (const row of scanBillingAccounts(doc, args.table)) {
    scanned += 1;
    if (!row.accountId || !row.schoolId || !row.studentId) {
      invalid += 1;
      process.stderr.write(
        `[backfill] WARN entityKey=${row.entityKey} missing accountId/schoolId/studentId — skipping\n`,
      );
      continue;
    }
    if (written >= args.limit) {
      process.stderr.write(`[backfill] hit --limit ${args.limit}, stopping\n`);
      break;
    }
    const exists = await lookupExists(doc, args.table, row.tenantId, row.accountId);
    if (exists) {
      skipped += 1;
      continue;
    }
    if (args.dryRun) {
      written += 1;
      process.stderr.write(
        `[backfill] DRY would-write ACCOUNT#${row.accountId} -> ${row.entityKey}\n`,
      );
      continue;
    }
    try {
      await writeLookup(doc, args.table, row);
      written += 1;
      if (written % 25 === 0) {
        process.stderr.write(`[backfill] progress: written=${written} scanned=${scanned} skipped=${skipped}\n`);
      }
    } catch (err: any) {
      // ConditionalCheckFailedException — race with `getOrCreate` for a brand-
      // new account that landed mid-backfill. Treat as "already mirrored".
      if (err?.name === 'ConditionalCheckFailedException') {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  console.log(
    JSON.stringify(
      {
        result: 'ok',
        dryRun: args.dryRun,
        scanned,
        written,
        skipped,
        invalid,
      },
      null,
      2,
    ),
  );
  process.exit(0);
}

main().catch((e: unknown) => {
  process.stderr.write(`[backfill] FATAL: ${(e as Error)?.message ?? e}\n`);
  process.exit(1);
});
