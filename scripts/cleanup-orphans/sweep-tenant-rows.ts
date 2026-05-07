/**
 * Sprint 0.5 T0.9a — DDB row sweep across 5 tenant-data tables.
 *
 * THROWAWAY ops script. Will be productized as Sprint 5 T5.5 with proper library structure + tests.
 *
 * Defensively re-sweeps identity/academics/finance (SBT script has a word-splitting bug —
 * see docs/dev-tenant-system/cleanup-snapshots/T0.8-usbasic-sbt-deprovision-evidence.md)
 * AND covers the analytics tables that SBT doesn't touch at all.
 *
 * Safety:
 *   - Hardcoded refuse-list (Saraswati's tenantId) — script aborts if argv matches
 *   - Hardcoded whitelist (3 test tenant UUIDs) — script aborts if argv NOT in whitelist
 *   - Dry-run default; --apply required for mutations
 *
 * Usage:
 *   npx ts-node scripts/cleanup-orphans/sweep-tenant-rows.ts <tenantId>            # dry-run
 *   npx ts-node scripts/cleanup-orphans/sweep-tenant-rows.ts <tenantId> --apply    # destructive
 *
 * Auth: AWS_PROFILE=prod (read+write DDB on per-service tables + analytics tables)
 */

import {
  DynamoDBClient,
  QueryCommand,
  ScanCommand,
  BatchWriteItemCommand,
} from '@aws-sdk/client-dynamodb';

// ============================================================================
// Safety constants — DO NOT MODIFY without operator review
// ============================================================================

const SARASWATI_TENANT_ID = '34f49822-ae1d-4188-95f0-04e14bc6c662';

const ALLOWED_TENANTS: readonly string[] = [
  '34392ed6-2e51-4fc8-ae2c-242eb5710e40', // usbasicfoundationtenant
  'fc9ea1c1-1cc2-45b3-b8c4-7e953e8e30d7', // rainshoaiborg
  '04ce4a00-c39a-4185-afd4-6e764ef44647', // prodtestadmin
];

const REGION = process.env.AWS_REGION || 'ap-south-1';

// ============================================================================
// Tables in scope
// ============================================================================

interface TableSpec {
  name: string;
  pk: string;
  sk: string | null;
  /** How to identify this tenant's rows */
  pattern: 'pk-tenant' | 'pk-tenant-prefix' | 'scan-rawevent-contains';
  /** Friendly label for logs */
  label: string;
}

const TABLES: readonly TableSpec[] = [
  { name: 'edforge-identity-basic',  pk: 'tenantId', sk: 'entityKey', pattern: 'pk-tenant',                 label: 'identity' },
  { name: 'edforge-academics-basic', pk: 'tenantId', sk: 'entityKey', pattern: 'pk-tenant',                 label: 'academics' },
  { name: 'edforge-finance-basic',   pk: 'tenantId', sk: 'entityKey', pattern: 'pk-tenant',                 label: 'finance' },
  { name: 'edforge-analytics',       pk: 'PK',       sk: 'SK',        pattern: 'pk-tenant-prefix',          label: 'analytics' },
  { name: 'edforge-analytics-landing', pk: 'eventId', sk: null,       pattern: 'scan-rawevent-contains',    label: 'landing' },
];

// ============================================================================
// Args + safety gates
// ============================================================================

const args = process.argv.slice(2);
const tenantId = args[0];
const apply = args.includes('--apply');

if (!tenantId) {
  console.error('Usage: sweep-tenant-rows.ts <tenantId> [--apply]');
  process.exit(2);
}

if (tenantId === SARASWATI_TENANT_ID) {
  console.error(`REFUSED: tenantId ${tenantId} is Saraswati (the production pilot). This script will not run against production tenants.`);
  process.exit(3);
}

if (!ALLOWED_TENANTS.includes(tenantId)) {
  console.error(`REFUSED: tenantId ${tenantId} is not in the explicit whitelist of allowed test tenants.`);
  console.error('  Allowed:');
  for (const t of ALLOWED_TENANTS) console.error(`    ${t}`);
  process.exit(4);
}

const client = new DynamoDBClient({ region: REGION });

// ============================================================================
// Per-table key collectors
// ============================================================================

interface KeyPair {
  pk: { name: string; value: string };
  sk: { name: string; value: string } | null;
}

async function collectKeysPkTenant(t: TableSpec, tid: string): Promise<KeyPair[]> {
  const keys: KeyPair[] = [];
  let exclusiveStartKey: any = undefined;
  do {
    const r = await client.send(new QueryCommand({
      TableName: t.name,
      KeyConditionExpression: `${t.pk} = :t`,
      ExpressionAttributeValues: { ':t': { S: tid } },
      ProjectionExpression: `${t.pk}, ${t.sk}`,
      ExclusiveStartKey: exclusiveStartKey,
    }));
    for (const item of r.Items || []) {
      const skVal = item[t.sk!]?.S;
      if (!skVal) continue; // defensive: skip malformed
      keys.push({
        pk: { name: t.pk, value: item[t.pk]!.S! },
        sk: { name: t.sk!, value: skVal },
      });
    }
    exclusiveStartKey = r.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return keys;
}

async function collectKeysPkTenantPrefix(t: TableSpec, tid: string): Promise<KeyPair[]> {
  const keys: KeyPair[] = [];
  let exclusiveStartKey: any = undefined;
  do {
    const r = await client.send(new QueryCommand({
      TableName: t.name,
      KeyConditionExpression: `${t.pk} = :pk`,
      ExpressionAttributeValues: { ':pk': { S: `TENANT#${tid}` } },
      ProjectionExpression: `${t.pk}, ${t.sk}`,
      ExclusiveStartKey: exclusiveStartKey,
    }));
    for (const item of r.Items || []) {
      const skVal = item[t.sk!]?.S;
      if (!skVal) continue;
      keys.push({
        pk: { name: t.pk, value: item[t.pk]!.S! },
        sk: { name: t.sk!, value: skVal },
      });
    }
    exclusiveStartKey = r.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return keys;
}

async function collectKeysScanRawEvent(t: TableSpec, tid: string): Promise<KeyPair[]> {
  const keys: KeyPair[] = [];
  let exclusiveStartKey: any = undefined;
  do {
    const r = await client.send(new ScanCommand({
      TableName: t.name,
      FilterExpression: 'contains(rawEvent, :t)',
      ExpressionAttributeValues: { ':t': { S: tid } },
      ProjectionExpression: t.pk,
      ExclusiveStartKey: exclusiveStartKey,
    }));
    for (const item of r.Items || []) {
      keys.push({
        pk: { name: t.pk, value: item[t.pk]!.S! },
        sk: null,
      });
    }
    exclusiveStartKey = r.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return keys;
}

// ============================================================================
// Batched delete with retry on UnprocessedItems
// ============================================================================

async function batchDelete(tableName: string, keys: KeyPair[]): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;

  // Chunk into 25
  for (let i = 0; i < keys.length; i += 25) {
    const batch = keys.slice(i, i + 25);
    const requestItems: any = {
      [tableName]: batch.map((k) => {
        const Key: any = { [k.pk.name]: { S: k.pk.value } };
        if (k.sk) Key[k.sk.name] = { S: k.sk.value };
        return { DeleteRequest: { Key } };
      }),
    };

    let attempt = 0;
    let unprocessed = requestItems;
    while (unprocessed[tableName] && unprocessed[tableName].length > 0 && attempt < 5) {
      const r = await client.send(new BatchWriteItemCommand({ RequestItems: unprocessed }));
      const sentCount = unprocessed[tableName].length;
      unprocessed = r.UnprocessedItems || {};
      const remaining = unprocessed[tableName]?.length || 0;
      deleted += sentCount - remaining;
      if (remaining > 0) {
        attempt++;
        const waitMs = Math.min(1000 * Math.pow(2, attempt), 8000);
        console.log(`    [retry ${attempt}] ${remaining} unprocessed; waiting ${waitMs}ms`);
        await new Promise((r) => setTimeout(r, waitMs));
      }
    }
    if (unprocessed[tableName] && unprocessed[tableName].length > 0) {
      failed += unprocessed[tableName].length;
      console.error(`    FAILED: ${unprocessed[tableName].length} items unprocessed after retries`);
    }
  }

  return { deleted, failed };
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n=== Sweep tenant rows: ${tenantId} ===`);
  console.log(`  Mode: ${apply ? 'APPLY (destructive)' : 'DRY-RUN'}`);
  console.log(`  Region: ${REGION}\n`);

  let grandDeleted = 0;
  let grandFailed = 0;

  for (const t of TABLES) {
    process.stdout.write(`  [${t.label}] (${t.name}) `);
    let keys: KeyPair[] = [];
    if (t.pattern === 'pk-tenant') {
      keys = await collectKeysPkTenant(t, tenantId);
    } else if (t.pattern === 'pk-tenant-prefix') {
      keys = await collectKeysPkTenantPrefix(t, tenantId);
    } else if (t.pattern === 'scan-rawevent-contains') {
      keys = await collectKeysScanRawEvent(t, tenantId);
    }
    console.log(`${keys.length} rows`);

    if (apply && keys.length > 0) {
      const { deleted, failed } = await batchDelete(t.name, keys);
      console.log(`    → deleted ${deleted}, failed ${failed}`);
      grandDeleted += deleted;
      grandFailed += failed;
    }
  }

  console.log('\n=== Summary ===');
  if (apply) {
    console.log(`  Total deleted: ${grandDeleted}`);
    console.log(`  Total failed:  ${grandFailed}`);
    if (grandFailed > 0) {
      console.error('\nFAILED — some rows could not be deleted. Investigate.');
      process.exit(1);
    }
  } else {
    console.log('  Dry-run complete. Re-run with --apply to delete.');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
