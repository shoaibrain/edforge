/**
 * PR #361 cleanup script — orphan IdempotencyKey row vacuum.
 *
 * Sprint 0.2 shipped IdempotencyKey rows with the wrong TTL attribute name
 * (`expiresAt` instead of `ttl` — see ecs-dynamodb.ts:40). PR #361 renames
 * the entity field. NEW rows written after the deploy auto-expire via the
 * 24h DDB TTL. But EXISTING prod rows still carry `expiresAt` and will
 * never be swept by DDB — they'd accumulate forever on disk, paying RCU
 * on every cap-enforcement Query.
 *
 * This script does a one-shot scan + DeleteItem of every IDEMPOTENCY_KEY
 * row that has NO `ttl` attribute (i.e., was written by the pre-PR #361
 * code). It must be run AFTER PR #361 deploys (so no new orphan rows
 * are being written concurrently).
 *
 * Scope:
 *   - Filter scoped strictly to entityType=IDEMPOTENCY_KEY so it cannot
 *     accidentally vacuum sentinel rows (FINANCE_ACTIVE_EXPORT, payment
 *     sessions, etc.) — those have their own TTL contracts already.
 *   - Dry-run is the DEFAULT mode. `--apply` is required to actually
 *     DeleteItem; otherwise the script prints what it would delete and
 *     exits.
 *   - `--limit N` caps the per-run delete count (default 10000) so a
 *     pathologically large backlog doesn't surprise the operator.
 *
 * Usage:
 *   AWS_PROFILE=prod TABLE_NAME=edforge-finance-basic \
 *     npx ts-node scripts/operations/finance-cleanup-orphan-idempotency-rows.ts
 *   AWS_PROFILE=prod TABLE_NAME=edforge-finance-basic \
 *     npx ts-node scripts/operations/finance-cleanup-orphan-idempotency-rows.ts --apply
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  DeleteCommand,
} from '@aws-sdk/lib-dynamodb';

interface Args {
  apply: boolean;
  limit: number;
  tableName: string;
  region: string;
}

function parseArgs(): Args {
  const apply = process.argv.includes('--apply');
  const limitIdx = process.argv.indexOf('--limit');
  const limit = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1] ?? '', 10) : 10000;
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error('Invalid --limit value (must be a positive integer).');
  }
  const tableName = process.env.TABLE_NAME;
  if (!tableName) {
    throw new Error(
      'TABLE_NAME env var is required (e.g., TABLE_NAME=edforge-finance-basic).',
    );
  }
  const region = process.env.AWS_REGION ?? 'ap-south-1';
  return { apply, limit, tableName, region };
}

interface OrphanRow {
  tenantId: string;
  entityKey: string;
  idempotencyKey?: string;
  routeKey?: string;
  claimedAt?: string;
}

async function main() {
  const args = parseArgs();
  const client = DynamoDBDocumentClient.from(
    new DynamoDBClient({ region: args.region }),
  );

  console.log(`PR #361 orphan-IdempotencyKey cleanup`);
  console.log(`  mode: ${args.apply ? 'APPLY (will delete)' : 'DRY-RUN (read-only)'}`);
  console.log(`  table: ${args.tableName}`);
  console.log(`  region: ${args.region}`);
  console.log(`  limit: ${args.limit}`);
  console.log('');

  const orphans: OrphanRow[] = [];
  let lastKey: Record<string, any> | undefined;
  let scanned = 0;
  let pages = 0;

  do {
    const result = await client.send(
      new ScanCommand({
        TableName: args.tableName,
        // Strictly scoped — must NOT vacuum FINANCE_ACTIVE_EXPORT, PAYMENT_SESSION, etc.
        FilterExpression:
          'entityType = :type AND attribute_not_exists(#ttl)',
        ExpressionAttributeNames: { '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':type': 'IDEMPOTENCY_KEY' },
        ProjectionExpression: 'tenantId, entityKey, idempotencyKey, routeKey, claimedAt',
        ExclusiveStartKey: lastKey,
        Limit: 500,
      }),
    );
    pages++;
    scanned += (result.ScannedCount as number | undefined) ?? 0;
    for (const item of (result.Items ?? []) as OrphanRow[]) {
      orphans.push(item);
      if (orphans.length >= args.limit) break;
    }
    lastKey = result.LastEvaluatedKey;
    if (orphans.length >= args.limit) break;
  } while (lastKey);

  console.log(
    `Scan complete: ${pages} page(s), ${scanned} items scanned, ${orphans.length} orphan(s) found.`,
  );
  console.log('');

  if (orphans.length === 0) {
    console.log('No orphan rows to clean up. Done.');
    return;
  }

  // Log a sample (max 5) so the operator can sanity-check before --apply.
  console.log('Sample orphan rows:');
  for (const r of orphans.slice(0, 5)) {
    console.log(
      `  tenantId=${r.tenantId} entityKey=${r.entityKey} ` +
        `idempotencyKey=${r.idempotencyKey ?? '?'} ` +
        `routeKey=${r.routeKey ?? '?'} ` +
        `claimedAt=${r.claimedAt ?? '?'}`,
    );
  }
  if (orphans.length > 5) console.log(`  ... and ${orphans.length - 5} more.`);
  console.log('');

  if (!args.apply) {
    console.log('DRY-RUN — no DeleteItem calls issued. Re-run with --apply to delete.');
    return;
  }

  console.log(`APPLY mode — deleting ${orphans.length} orphan row(s)...`);
  let deleted = 0;
  let failed = 0;
  for (const r of orphans) {
    try {
      await client.send(
        new DeleteCommand({
          TableName: args.tableName,
          Key: { tenantId: r.tenantId, entityKey: r.entityKey },
        }),
      );
      deleted++;
    } catch (err) {
      failed++;
      console.error(
        `  DELETE failed: tenantId=${r.tenantId} entityKey=${r.entityKey}: ${(err as Error).message}`,
      );
    }
  }
  console.log(`Done. deleted=${deleted} failed=${failed}`);
}

main().catch((err) => {
  console.error('Cleanup script crashed:', err);
  process.exit(1);
});
