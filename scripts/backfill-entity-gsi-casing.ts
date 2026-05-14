/**
 * Backfill — multi-entity GSI1 casing fix (Sprint S3.2).
 *
 * Companion to scripts/backfill-calendar-date-gsi-casing.ts (S3.1).
 * Closes the same GSI1-casing bug pattern for four other identity-service
 * entities that were silently writing uppercase `GSI1PK`/`GSI1SK` instead
 * of the lowercase attribute names DDB's GSI1 index is defined on
 * (server/lib/tenant-template/ecs-dynamodb.ts:53-54):
 *
 *   - STAFF_TRAINING — gsi1pk=TRAINTYPE#{type}, gsi1sk=STARTDATE#{date}
 *   - LEAVE          — gsi1pk=SCHOOL#{schoolId}, gsi1sk=LEAVE#{startDate}
 *   - CALENDAR       — gsi1pk=TENANT#{t}#SCHOOL#{s}, gsi1sk=CALENDAR#{code}
 *   - CREDENTIAL     — gsi1pk=CREDTYPE#{descriptor}, gsi1sk=EXPIRY#{date}
 *
 * After the S3.2 service deploy:
 *   - NEW writes use lowercase keys → GSI1 populates correctly
 *   - OLD rows still carry only uppercase → still invisible to GSI1
 *
 * This script walks the affected entityTypes and, where lowercase keys are
 * missing, copies values from uppercase (preferred) or recomputes from
 * source fields (defensive fallback). Idempotent — re-running is a no-op
 * thanks to `attribute_not_exists(gsi1pk)` guard.
 *
 * Run (dry-run, default)
 * ======================
 *   AWS_PROFILE=prod npx ts-node scripts/backfill-entity-gsi-casing.ts \
 *     --table edforge-identity-basic --region ap-south-1
 *
 * Run (commit)
 * ============
 *   AWS_PROFILE=prod npx ts-node scripts/backfill-entity-gsi-casing.ts \
 *     --table edforge-identity-basic --region ap-south-1 --commit
 *
 * Scope guard
 * ===========
 * Scans the entire table (filtered to entityType IN the 4 target types).
 * For multi-tenant tables, affects ALL tenants. Acceptable because:
 *   - Additive — writes new lowercase fields, leaves uppercase intact
 *   - `attribute_not_exists(gsi1pk)` prevents clobbering rows already
 *     migrated by post-S3.2 entity factory code
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
  entityType?: string; // optional filter to a single entityType for staged rollout
}

const TARGET_ENTITY_TYPES = ['STAFF_TRAINING', 'LEAVE', 'CALENDAR', 'CREDENTIAL'] as const;
type TargetEntityType = (typeof TARGET_ENTITY_TYPES)[number];

function parseArgs(): Args {
  const args = process.argv.slice(2);
  let table = '';
  let region = 'ap-south-1';
  let commit = false;
  let entityType: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--table') table = args[++i] || '';
    else if (args[i] === '--region') region = args[++i] || region;
    else if (args[i] === '--commit') commit = true;
    else if (args[i] === '--entity-type') entityType = args[++i];
  }
  if (!table) {
    console.error('Required: --table <ddb-table-name>');
    process.exit(2);
  }
  if (entityType && !TARGET_ENTITY_TYPES.includes(entityType as TargetEntityType)) {
    console.error(`--entity-type must be one of: ${TARGET_ENTITY_TYPES.join(', ')}`);
    process.exit(2);
  }
  return { table, region, commit, entityType };
}

/**
 * For each entity type, return the lowercase (gsi1pk, gsi1sk) values to
 * write. Prefer existing uppercase variant; fall back to deriving from
 * source fields (defensive — handles rare rows missing uppercase too).
 * Returns undefined if not derivable, in which case the row is skipped.
 */
function deriveKeys(
  item: Record<string, any>,
): { gsi1pk: string; gsi1sk: string } | undefined {
  // Preferred: copy from existing uppercase
  if (item.GSI1PK && item.GSI1SK) {
    return { gsi1pk: item.GSI1PK, gsi1sk: item.GSI1SK };
  }

  // Defensive fallbacks per entity type
  switch (item.entityType as TargetEntityType) {
    case 'STAFF_TRAINING':
      if (item.trainingType && item.startDate) {
        return {
          gsi1pk: `TRAINTYPE#${item.trainingType}`,
          gsi1sk: `STARTDATE#${item.startDate}`,
        };
      }
      return undefined;

    case 'LEAVE':
      if (item.schoolId && item.startDate) {
        return {
          gsi1pk: `SCHOOL#${item.schoolId}`,
          gsi1sk: `LEAVE#${item.startDate}`,
        };
      }
      return undefined;

    case 'CALENDAR':
      if (item.tenantId && item.schoolId && item.calendarCode) {
        return {
          gsi1pk: `TENANT#${item.tenantId}#SCHOOL#${item.schoolId}`,
          gsi1sk: `CALENDAR#${item.calendarCode}`,
        };
      }
      return undefined;

    case 'CREDENTIAL':
      if (item.credentialTypeDescriptor) {
        return {
          gsi1pk: `CREDTYPE#${item.credentialTypeDescriptor}`,
          gsi1sk: `EXPIRY#${item.expirationDate || '9999-12-31'}`,
        };
      }
      return undefined;

    default:
      return undefined;
  }
}

(async () => {
  const args = parseArgs();
  const targetTypes = args.entityType
    ? [args.entityType]
    : [...TARGET_ENTITY_TYPES];

  console.log(`Backfill multi-entity GSI1 casing (S3.2)`);
  console.log(`  table:    ${args.table}`);
  console.log(`  region:   ${args.region}`);
  console.log(`  types:    ${targetTypes.join(', ')}`);
  console.log(`  mode:     ${args.commit ? '\x1b[31mCOMMIT\x1b[0m' : '\x1b[33mdry-run\x1b[0m'}`);
  console.log('');

  const client = new DynamoDBClient({ region: args.region });

  // Per-entity-type counters for readable summary
  const counts: Record<string, { scanned: number; already: number; migrated: number; skipped: number; errors: number }> = {};
  for (const t of targetTypes) {
    counts[t] = { scanned: 0, already: 0, migrated: 0, skipped: 0, errors: 0 };
  }
  const errorSamples: Array<{ entityType: string; entityKey: string; reason: string }> = [];

  // Build a FilterExpression listing only the target types (cheaper than
  // multiple scans; one full-table scan covers all four).
  const typeValues: Record<string, any> = {};
  const typePlaceholders: string[] = [];
  targetTypes.forEach((t, i) => {
    const k = `:et${i}`;
    typeValues[k] = { S: t };
    typePlaceholders.push(k);
  });

  let exclusiveStartKey: Record<string, any> | undefined = undefined;
  do {
    const scan: any = await client.send(new ScanCommand({
      TableName: args.table,
      FilterExpression: `entityType IN (${typePlaceholders.join(', ')})`,
      ExpressionAttributeValues: typeValues,
      ExclusiveStartKey: exclusiveStartKey,
    }));

    for (const itemRaw of scan.Items ?? []) {
      const item = unmarshall(itemRaw);
      const et = item.entityType as string;
      const c = counts[et];
      if (!c) continue; // shouldn't happen, but guard
      c.scanned++;

      // Already migrated → skip
      if (item.gsi1pk && item.gsi1sk) {
        c.already++;
        continue;
      }

      const derived = deriveKeys(item);
      if (!derived) {
        c.skipped++;
        if (errorSamples.length < 10) {
          errorSamples.push({
            entityType: et,
            entityKey: String(item.entityKey),
            reason: 'cannot derive lowercase keys (missing source fields)',
          });
        }
        continue;
      }

      if (!args.commit) {
        c.migrated++;
        if (c.migrated <= 3) {
          console.log(`  [dry-run] would migrate ${et} ${item.entityKey}`);
          console.log(`            gsi1pk = ${derived.gsi1pk}`);
          console.log(`            gsi1sk = ${derived.gsi1sk}`);
        }
        continue;
      }

      try {
        await client.send(new UpdateItemCommand({
          TableName: args.table,
          Key: {
            tenantId: { S: item.tenantId as string },
            entityKey: { S: item.entityKey as string },
          },
          UpdateExpression: 'SET gsi1pk = :pk, gsi1sk = :sk',
          ExpressionAttributeValues: marshall({
            ':pk': derived.gsi1pk,
            ':sk': derived.gsi1sk,
          }),
          // Guard against clobbering — if a concurrent write already set
          // gsi1pk via the new entity code path, do not overwrite.
          ConditionExpression: 'attribute_not_exists(gsi1pk)',
        }));
        c.migrated++;
        if (c.migrated % 100 === 0) {
          console.log(`  ${et}: migrated ${c.migrated} (scanned ${c.scanned})`);
        }
      } catch (err: any) {
        if (err?.name === 'ConditionalCheckFailedException') {
          // Race — another writer already set lowercase. Treat as already migrated.
          c.already++;
        } else {
          c.errors++;
          if (errorSamples.length < 10) {
            errorSamples.push({
              entityType: et,
              entityKey: String(item.entityKey),
              reason: err?.message ?? String(err),
            });
          }
        }
      }
    }

    exclusiveStartKey = scan.LastEvaluatedKey;
  } while (exclusiveStartKey);

  console.log('');
  console.log('═══ SUMMARY ═══');
  let totalScanned = 0;
  let totalMigrated = 0;
  let totalAlready = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  for (const t of targetTypes) {
    const c = counts[t];
    console.log(
      `  ${t.padEnd(16)} scanned=${c.scanned}  already=${c.already}  ` +
      `${args.commit ? 'migrated' : 'would_migrate'}=${c.migrated}  ` +
      `skipped=${c.skipped}  errors=${c.errors}`,
    );
    totalScanned += c.scanned;
    totalMigrated += c.migrated;
    totalAlready += c.already;
    totalSkipped += c.skipped;
    totalErrors += c.errors;
  }
  console.log('  ' + '─'.repeat(70));
  console.log(
    `  ${'TOTAL'.padEnd(16)} scanned=${totalScanned}  already=${totalAlready}  ` +
    `${args.commit ? 'migrated' : 'would_migrate'}=${totalMigrated}  ` +
    `skipped=${totalSkipped}  errors=${totalErrors}`,
  );

  if (errorSamples.length > 0) {
    console.log('');
    console.log('Error / skip samples:');
    for (const e of errorSamples) {
      console.log(`  - [${e.entityType}] ${e.entityKey}: ${e.reason}`);
    }
  }

  if (!args.commit && totalMigrated > 0) {
    console.log('');
    console.log('Dry-run complete. Re-run with --commit to actually write.');
  }

  if (totalErrors > 0) {
    process.exit(1);
  }
})().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
