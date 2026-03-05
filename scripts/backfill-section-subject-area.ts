/**
 * Backfill Script: Add subjectArea to existing sections
 *
 * One-time migration script that:
 * 1. Queries all SECTION entities across all tenants/schools
 * 2. For each section, looks up the parent COURSE entity to get subjectArea
 * 3. Writes subjectArea back to the SECTION entity via UpdateItem
 *
 * Usage:
 *   npx ts-node scripts/backfill-section-subject-area.ts
 *
 * Prerequisites:
 *   - AWS credentials configured (or use local DynamoDB)
 *   - DynamoDB table name set in TABLE_NAME constant
 *
 * Safety:
 *   - Idempotent: sections that already have subjectArea are skipped
 *   - Read-heavy: only writes when subjectArea is missing
 *   - Logged: all updates are logged for audit
 */

import { DynamoDBClient, ScanCommand, GetItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';

// ============================================================================
// Configuration
// ============================================================================

const TABLE_NAME = process.env.TABLE_NAME || 'EdForge-AcademicsTable';
const REGION = process.env.AWS_REGION || 'us-east-2';
const DRY_RUN = process.env.DRY_RUN === 'true';

const client = new DynamoDBClient({ region: REGION });

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`\n=== Backfill Section subjectArea ===`);
  console.log(`Table: ${TABLE_NAME}`);
  console.log(`Region: ${REGION}`);
  console.log(`Dry Run: ${DRY_RUN}\n`);

  let scanned = 0;
  let updated = 0;
  let skipped = 0;
  let errors = 0;
  let lastEvaluatedKey: Record<string, any> | undefined;

  do {
    // Scan for all SECTION entities
    const scanResult = await client.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'entityType = :sectionType',
      ExpressionAttributeValues: marshall({ ':sectionType': 'SECTION' }),
      ExclusiveStartKey: lastEvaluatedKey ? marshall(lastEvaluatedKey) : undefined,
    }));

    const sections = (scanResult.Items || []).map(item => unmarshall(item));
    lastEvaluatedKey = scanResult.LastEvaluatedKey ? unmarshall(scanResult.LastEvaluatedKey) : undefined;

    for (const section of sections) {
      scanned++;

      // Skip if already has subjectArea
      if (section.subjectArea) {
        skipped++;
        continue;
      }

      // Look up parent course
      const courseKey = `COURSE#${section.schoolId}#${section.courseId}`;
      try {
        const courseResult = await client.send(new GetItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({
            tenantId: section.tenantId,
            entityKey: courseKey,
          }),
        }));

        if (!courseResult.Item) {
          console.warn(`  WARN: Course not found for section ${section.sectionId} (courseKey: ${courseKey})`);
          errors++;
          continue;
        }

        const course = unmarshall(courseResult.Item);
        const subjectArea = course.subjectArea || 'other';

        if (DRY_RUN) {
          console.log(`  DRY RUN: Would set subjectArea='${subjectArea}' on section ${section.sectionId} (${section.sectionName || section.sectionNumber})`);
          updated++;
          continue;
        }

        // Update section with subjectArea
        await client.send(new UpdateItemCommand({
          TableName: TABLE_NAME,
          Key: marshall({
            tenantId: section.tenantId,
            entityKey: section.entityKey,
          }),
          UpdateExpression: 'SET subjectArea = :subjectArea',
          ExpressionAttributeValues: marshall({ ':subjectArea': subjectArea }),
        }));

        console.log(`  Updated section ${section.sectionId} (${section.sectionName || section.sectionNumber}) -> subjectArea='${subjectArea}'`);
        updated++;
      } catch (err) {
        console.error(`  ERROR: Failed to process section ${section.sectionId}:`, err);
        errors++;
      }
    }
  } while (lastEvaluatedKey);

  console.log(`\n=== Summary ===`);
  console.log(`Scanned: ${scanned}`);
  console.log(`Updated: ${updated}`);
  console.log(`Skipped (already had subjectArea): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`\nDone.`);
}

main().catch(console.error);
