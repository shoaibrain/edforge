/**
 * Backfill Script: Stamp derivedFrom='direct' on legacy SchoolAttendance rows
 *
 * Context (Attendance Domain epic, Sprint 1 / S1.T1):
 * Directly-recorded school-day attendance (recordAttendance / bulk) historically
 * did NOT set the `derivedFrom` provenance tag, while the derivation service
 * always sets `derivedFrom='section_attendance'`. The new derivation precedence
 * rule (S1.T2) protects any row whose derivedFrom !== 'section_attendance', so it
 * already guards untagged rows — but reporting and the upcoming daily/section
 * policy work want an explicit tag. This one-time migration stamps every
 * SCHOOL_ATTENDANCE row that has no `derivedFrom` as `'direct'`.
 *
 * Usage:
 *   DRY_RUN=true npx ts-node scripts/backfill-school-attendance-provenance.ts
 *   TABLE_NAME=edforge-academics-basic npx ts-node scripts/backfill-school-attendance-provenance.ts
 *
 * Safety:
 *   - Idempotent: rows that already have `derivedFrom` (either 'direct' or
 *     'section_attendance') are skipped; the UpdateItem is guarded by
 *     `attribute_not_exists(derivedFrom)` so a concurrent writer can't be clobbered.
 *   - Read-heavy: only writes when `derivedFrom` is absent.
 *   - Logged: a summary is printed for audit.
 */

import { DynamoDBClient, ScanCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';

// ============================================================================
// Configuration
// ============================================================================

const TABLE_NAME = process.env.TABLE_NAME || 'EdForge-AcademicsTable';
const REGION = process.env.AWS_REGION || 'ap-south-1';
const DRY_RUN = process.env.DRY_RUN === 'true';

const client = new DynamoDBClient({ region: REGION });

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n=== Backfill SchoolAttendance provenance (derivedFrom='direct') ===`);
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Region: ${REGION}`);
  console.log(`Dry Run: ${DRY_RUN}\n`);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    const scanResult = await client.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'entityType = :t',
      ExpressionAttributeValues: marshall({ ':t': 'SCHOOL_ATTENDANCE' }),
      ExclusiveStartKey: lastEvaluatedKey ? marshall(lastEvaluatedKey) : undefined,
    }));

    const rows = (scanResult.Items || []).map(item => unmarshall(item));
    lastEvaluatedKey = scanResult.LastEvaluatedKey ? unmarshall(scanResult.LastEvaluatedKey) : undefined;

    for (const row of rows) {
      scanned++;

      // Idempotent: already tagged (direct OR section_attendance) → skip
      if (row.derivedFrom) {
        skipped++;
        continue;
      }

      if (DRY_RUN) {
        console.log(`  DRY RUN: Would set derivedFrom='direct' on ${row.entityKey} (student ${row.studentId}, ${row.date})`);
        updated++;
        continue;
      }

      try {
        await client.send(new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({ tenantId: row.tenantId, entityKey: row.entityKey }),
          UpdateExpression: 'SET derivedFrom = :direct',
          // Guard: never overwrite a value written by a concurrent process.
          ConditionExpression: 'attribute_not_exists(derivedFrom)',
          ExpressionAttributeValues: marshall({ ':direct': 'direct' }),
        }));
        console.log(`  Updated ${row.entityKey} -> derivedFrom='direct'`);
        updated++;
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
          // A concurrent writer set derivedFrom between scan and update — that's fine.
          skipped++;
          continue;
        }
        console.error(`  ERROR: Failed to update ${row.entityKey}:`, err);
        errors++;
      }
    }
  } while (lastEvaluatedKey);

  console.log(`\n=== Summary ===`);
  console.log(`Scanned: ${scanned}`);
  console.log(`Updated (set derivedFrom='direct'): ${updated}`);
  console.log(`Skipped (already tagged): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`\nDone.`);
}

main().catch(console.error);
