/**
 * Backfill — CalendarDate GSI1 casing fix (Sprint S3.1).
 *
 * Closes F-V2-CALENDAR-PAGINATION at the data-residency level.
 *
 * Background
 * ==========
 * The CalendarDate entity factory historically wrote uppercase GSI1
 * attribute names (`GSI1PK`, `GSI1SK`) while the DDB GSI1 index is
 * defined on lowercase keys (`gsi1pk`, `gsi1sk` per CDK
 * server/lib/tenant-template/ecs-dynamodb.ts:53). DynamoDB attribute
 * names are case-sensitive, so the GSI was effectively un-populated for
 * every CalendarDate row written before Sprint S3.1.
 *
 * After the S3.1 service deploy:
 *   - NEW CalendarDate writes use lowercase keys → GSI1 populates correctly
 *   - OLD rows still carry only the uppercase keys → still invisible to GSI1
 *
 * This script walks every CalendarDate row in the tenant's identity table
 * and, where lowercase keys are missing, copies the values from uppercase
 * into lowercase. Idempotent — re-running is a no-op.
 *
 * Operational notes
 * =================
 *   - Reads with paginated scan (FilterExpression: entityType='CALENDARDATE')
 *   - Writes via UpdateItem with ConditionExpression so concurrent writes
 *     from live identity service don't get clobbered
 *   - One row per UpdateCall — explicit cost (low: 1 RCU + 1 WCU per row)
 *   - Dry-run mode by default; pass --commit to actually write
 *
 * Run (dry-run, default)
 * ======================
 *   AWS_PROFILE=prod npx ts-node scripts/backfill-calendar-date-gsi-casing.ts \
 *     --table edforge-identity-basic --region ap-south-1
 *
 * Run (commit)
 * ============
 *   AWS_PROFILE=prod npx ts-node scripts/backfill-calendar-date-gsi-casing.ts \
 *     --table edforge-identity-basic --region ap-south-1 --commit
 *
 * Scope guard
 * ===========
 * Scans the entire table (filtered to entityType='CALENDARDATE'). For
 * multi-tenant tables, this affects ALL tenants. Acceptable because:
 *   - The change is additive (writes new lowercase fields, leaves
 *     uppercase intact)
 *   - The condition `attribute_not_exists(gsi1pk)` prevents clobbering
 *     rows that already have lowercase fields (e.g. post-S3.1 writes)
 *   - No semantic change to operator-facing data
 */

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
} from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';

interface Args {
  table: string;
  region: string;
  commit: boolean;
}

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let table = '';
  let region = 'ap-south-1';
  let commit = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--table') table = args[++i] || '';
    else if (args[i] === '--region') region = args[++i] || region;
    else if (args[i] === '--commit') commit = true;
  }
  if (!table) {
    console.error('Required: --table <ddb-table-name>');
    process.exit(2);
  }
  return { table, region, commit };
}

interface CalendarDateRow {
  tenantId: string;
  entityKey: string;
  academicYearId?: string;
  date?: string;
  gsi1pk?: string;
  gsi1sk?: string;
  GSI1PK?: string;
  GSI1SK?: string;
}

(async () => {
  const args = parseArgs();
  console.log(`Backfill CalendarDate GSI1 casing`);
  console.log(`  table:  ${args.table}`);
  console.log(`  region: ${args.region}`);
  console.log(`  mode:   ${args.commit ? '\x1b[31mCOMMIT\x1b[0m' : '\x1b[33mdry-run\x1b[0m'}`);
  console.log('');

  const client = new DynamoDBClient({ region: args.region });

  let exclusiveStartKey: Record<string, any> | undefined = undefined;
  let scanned = 0;
  let alreadyMigrated = 0;
  let migrated = 0;
  let skipped = 0;
  let errors = 0;
  const errorSamples: Array<{ entityKey: string; reason: string }> = [];

  do {
    const scan: any = await client.send(new ScanCommand({
      TableName: args.table,
      FilterExpression: 'entityType = :et',
      ExpressionAttributeValues: { ':et': { S: 'CALENDARDATE' } },
      ExclusiveStartKey: exclusiveStartKey,
    }));

    for (const itemRaw of scan.Items ?? []) {
      scanned++;
      const item = unmarshall(itemRaw) as CalendarDateRow;

      // Already migrated (lowercase keys present) → skip
      if (item.gsi1pk && item.gsi1sk) {
        alreadyMigrated++;
        continue;
      }

      // Derive the lowercase values. Prefer the existing uppercase, fall
      // back to recomputing from academicYearId + date (defensive — in
      // case of corrupted rows that lost the uppercase too).
      const newGsi1pk =
        item.GSI1PK ?? (item.academicYearId ? `ACADYEAR#${item.academicYearId}` : undefined);
      const newGsi1sk =
        item.GSI1SK ?? (item.date ? `CALDATE#${item.date}` : undefined);

      if (!newGsi1pk || !newGsi1sk) {
        skipped++;
        if (errorSamples.length < 5) {
          errorSamples.push({
            entityKey: item.entityKey,
            reason: `cannot derive lowercase keys (academicYearId=${item.academicYearId}, date=${item.date})`,
          });
        }
        continue;
      }

      if (!args.commit) {
        // Dry-run: just count what we WOULD migrate.
        migrated++;
        if (migrated <= 5) {
          console.log(`  [dry-run] would migrate ${item.entityKey}`);
          console.log(`            gsi1pk = ${newGsi1pk}`);
          console.log(`            gsi1sk = ${newGsi1sk}`);
        }
        continue;
      }

      try {
        await client.send(new UpdateItemCommand({
          TableName: args.table,
          Key: {
            tenantId: { S: item.tenantId },
            entityKey: { S: item.entityKey },
          },
          UpdateExpression: 'SET gsi1pk = :pk, gsi1sk = :sk',
          ExpressionAttributeValues: marshall({
            ':pk': newGsi1pk,
            ':sk': newGsi1sk,
          }),
          // Guard against clobbering — if a concurrent write already set
          // gsi1pk via the new entity code path, do not overwrite.
          ConditionExpression: 'attribute_not_exists(gsi1pk)',
        }));
        migrated++;
        if (migrated % 100 === 0) {
          console.log(`  migrated: ${migrated} (scanned ${scanned})`);
        }
      } catch (err: any) {
        if (err?.name === 'ConditionalCheckFailedException') {
          // Race — another writer already set lowercase. Treat as already migrated.
          alreadyMigrated++;
        } else {
          errors++;
          if (errorSamples.length < 5) {
            errorSamples.push({ entityKey: item.entityKey, reason: err?.message ?? String(err) });
          }
        }
      }
    }

    exclusiveStartKey = scan.LastEvaluatedKey;
  } while (exclusiveStartKey);

  console.log('');
  console.log('═══ SUMMARY ═══');
  console.log(`Scanned CALENDARDATE rows: ${scanned}`);
  console.log(`Already migrated (lowercase present): ${alreadyMigrated}`);
  console.log(`${args.commit ? 'Migrated' : 'Would migrate'}: ${migrated}`);
  console.log(`Skipped (no derivable keys): ${skipped}`);
  console.log(`Errors: ${errors}`);

  if (errorSamples.length > 0) {
    console.log('');
    console.log('Error samples:');
    for (const e of errorSamples) {
      console.log(`  - ${e.entityKey}: ${e.reason}`);
    }
  }

  if (!args.commit && migrated > 0) {
    console.log('');
    console.log('Dry-run complete. Re-run with --commit to actually write.');
  }
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
