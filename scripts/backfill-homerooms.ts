/**
 * Backfill Script: Homeroom rosters (Attendance Domain epic, S3.T5)
 *
 * Reconciles the Sprint 3 homeroom data model so it is internally consistent:
 *
 *     Enrollment.sectionId  (the homeroom pointer, S3.T1)
 *        -> SectionEnrollment roster row  (what the Attendance screen lists, S3.T3)
 *        -> CourseSection.currentEnrollment  (the homeroom counter)
 *
 * For each annual Enrollment whose `sectionId` points at a homeroom Section
 * (sectionType:'homeroom'):
 *   1. stamp Enrollment.homeroomTeacherId from the homeroom's primaryTeacherId
 *      when it is missing, and
 *   2. create the SectionEnrollment roster row when it is missing.
 * Afterwards each homeroom's currentEnrollment is recomputed from its active
 * roster so the counter never drifts.
 *
 * It does NOT fabricate homerooms — a homeroom needs an operator-chosen teacher,
 * so students with no homeroom pointer (and pointers at non-homeroom/missing
 * sections) are REPORTED as operator-driven follow-ups, never guessed.
 *
 * This is also the S3.T1 dev-data probe: the report tells you how populated
 * Enrollment.sectionId actually is.
 *
 * Usage:
 *   DRY_RUN=true  npx ts-node scripts/backfill-homerooms.ts   # default: report only
 *   DRY_RUN=false npx ts-node scripts/backfill-homerooms.ts   # apply writes
 *   (optional) TENANT_ID=... SCHOOL_ID=... to scope a single tenant / school.
 *
 * Safety:
 *   - Idempotent: existing roster rows are skipped; counters are recomputed.
 *   - DRY_RUN defaults to true; the script only writes when DRY_RUN=false.
 *   - Reuses createSectionEnrollmentEntity so roster keys never drift from runtime.
 */

import { DynamoDBClient, ScanCommand, GetItemCommand, PutItemCommand, UpdateItemCommand } from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import {
  createSectionEnrollmentEntity,
  sectionEnrollmentKey,
} from '../server/application/microservices/academics/src/common/entities/section-enrollment.entity';

const TABLE_NAME = process.env.TABLE_NAME || 'EdForge-AcademicsTable';
const REGION = process.env.AWS_REGION || 'ap-south-1';
const DRY_RUN = process.env.DRY_RUN !== 'false'; // safe default: report only
const TENANT_ID = process.env.TENANT_ID;
const SCHOOL_ID = process.env.SCHOOL_ID;

const client = new DynamoDBClient({ region: REGION });

interface HomeroomSection {
  tenantId: string;
  schoolId: string;
  sectionId: string;
  academicYearId: string;
  sectionNumber: string;
  sectionName?: string;
  primaryTeacherId: string;
  courseId?: string;
  courseCode?: string;
  courseName?: string;
  currentEnrollment?: number;
  entityKey: string;
}

async function scanAll(filterExpression: string, values: Record<string, unknown>): Promise<Record<string, any>[]> {
  const out: Record<string, any>[] = [];
  let lastEvaluatedKey: Record<string, any> | undefined;
  do {
    const res = await client.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: marshall(values, { removeUndefinedValues: true }),
      ExclusiveStartKey: lastEvaluatedKey ? marshall(lastEvaluatedKey) : undefined,
    }));
    for (const item of res.Items || []) out.push(unmarshall(item));
    lastEvaluatedKey = res.LastEvaluatedKey ? unmarshall(res.LastEvaluatedKey) : undefined;
  } while (lastEvaluatedKey);
  return out;
}

function inScope(row: { tenantId?: string; schoolId?: string }): boolean {
  if (TENANT_ID && row.tenantId !== TENANT_ID) return false;
  if (SCHOOL_ID && row.schoolId !== SCHOOL_ID) return false;
  return true;
}

async function main() {
  console.log(`\n=== Backfill Homerooms (S3.T5) ===`);
  console.log(`Table: ${TABLE_NAME}  Region: ${REGION}  DryRun: ${DRY_RUN}`);
  console.log(`Scope: tenant=${TENANT_ID || 'ALL'} school=${SCHOOL_ID || 'ALL'}\n`);

  // Pass 1 — index homeroom sections by sectionId.
  const homeroomRows = (await scanAll('entityType = :t AND sectionType = :h', { ':t': 'SECTION', ':h': 'homeroom' }))
    .filter(inScope);
  const homerooms = new Map<string, HomeroomSection>();
  for (const s of homeroomRows) homerooms.set(s.sectionId, s as HomeroomSection);
  console.log(`Homeroom sections in scope: ${homerooms.size}`);

  // Pass 2 — reconcile each enrollment's homeroom pointer into a roster row.
  const enrollments = (await scanAll('entityType = :t', { ':t': 'ENROLLMENT' })).filter(inScope);
  const rosterCounts = new Map<string, number>(); // sectionId -> reconciled active roster count

  let pointedAtHomeroom = 0;
  let rosterCreated = 0;
  let rosterAlready = 0;
  let teacherStamped = 0;
  let unassigned = 0;
  let pointerNotHomeroom = 0;
  let errors = 0;

  for (const e of enrollments) {
    if (e.isActive === false) continue;

    if (!e.sectionId) {
      unassigned++;
      continue;
    }

    const homeroom = homerooms.get(e.sectionId);
    if (!homeroom) {
      pointerNotHomeroom++;
      console.warn(`  WARN: ${e.studentId} -> sectionId ${e.sectionId} is not a homeroom (operator-driven)`);
      continue;
    }
    pointedAtHomeroom++;

    try {
      // 1) Stamp homeroomTeacherId on the enrollment if missing.
      if (!e.homeroomTeacherId) {
        if (DRY_RUN) {
          console.log(`  DRY: would stamp homeroomTeacherId=${homeroom.primaryTeacherId} on enrollment ${e.studentId}`);
        } else {
          await client.send(new UpdateItemCommand({
            TableName: TABLE_NAME,
            Key: marshall({ tenantId: e.tenantId, entityKey: e.entityKey }),
            UpdateExpression: 'SET homeroomTeacherId = :t, updatedAt = :u',
            ExpressionAttributeValues: marshall({ ':t': homeroom.primaryTeacherId, ':u': new Date().toISOString() }),
          }));
        }
        teacherStamped++;
      }

      // 2) Ensure the SectionEnrollment roster row exists (idempotent).
      const rosterKey = sectionEnrollmentKey(e.schoolId, e.sectionId, e.studentId);
      const existing = await client.send(new GetItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ tenantId: e.tenantId, entityKey: rosterKey }),
      }));

      const alreadyActive = existing.Item && unmarshall(existing.Item).isActive !== false;
      if (alreadyActive) {
        rosterAlready++;
      } else {
        const roster = createSectionEnrollmentEntity(
          e.tenantId,
          e.schoolId,
          e.sectionId,
          e.studentId,
          {
            courseId: homeroom.courseId ?? 'HOMEROOM',
            academicYearId: homeroom.academicYearId,
            courseCode: homeroom.courseCode,
            courseName: homeroom.courseName,
            sectionNumber: homeroom.sectionNumber,
            studentName: e.studentName,
            studentNumber: e.studentNumber,
            currentGradeLevel: e.gradeLevel,
            enrolledBy: 'backfill-homerooms',
          },
        );
        if (DRY_RUN) {
          console.log(`  DRY: would create homeroom roster row ${e.studentId} in ${homeroom.sectionName || homeroom.sectionNumber}`);
        } else {
          await client.send(new PutItemCommand({
            TableName: TABLE_NAME,
            Item: marshall(roster, { removeUndefinedValues: true }),
            ConditionExpression: 'attribute_not_exists(entityKey) OR isActive = :false',
            ExpressionAttributeValues: marshall({ ':false': false }),
          }));
        }
        rosterCreated++;
      }

      rosterCounts.set(e.sectionId, (rosterCounts.get(e.sectionId) || 0) + 1);
    } catch (err) {
      console.error(`  ERROR: reconcile ${e.studentId} -> ${e.sectionId}:`, err);
      errors++;
    }
  }

  // Pass 3 — recompute each homeroom's currentEnrollment from the reconciled roster.
  let countersFixed = 0;
  for (const [sectionId, homeroom] of homerooms) {
    const reconciled = rosterCounts.get(sectionId) || 0;
    if ((homeroom.currentEnrollment ?? 0) === reconciled) continue;
    if (DRY_RUN) {
      console.log(`  DRY: would set currentEnrollment ${homeroom.currentEnrollment ?? 0} -> ${reconciled} on homeroom ${homeroom.sectionNumber}`);
    } else {
      await client.send(new UpdateItemCommand({
        TableName: TABLE_NAME,
        Key: marshall({ tenantId: homeroom.tenantId, entityKey: homeroom.entityKey }),
        UpdateExpression: 'SET currentEnrollment = :c, updatedAt = :u',
        ExpressionAttributeValues: marshall({ ':c': reconciled, ':u': new Date().toISOString() }),
      }));
    }
    countersFixed++;
  }

  console.log(`\n=== Summary ===`);
  console.log(`Enrollments scanned (active):        ${enrollments.filter(e => e.isActive !== false).length}`);
  console.log(`  pointed at a homeroom:             ${pointedAtHomeroom}`);
  console.log(`  roster rows created:               ${rosterCreated}`);
  console.log(`  roster rows already present:       ${rosterAlready}`);
  console.log(`  homeroomTeacherId stamped:         ${teacherStamped}`);
  console.log(`  homeroom counters recomputed:      ${countersFixed}`);
  console.log(`Operator-driven follow-ups:`);
  console.log(`  no homeroom pointer (unassigned):  ${unassigned}`);
  console.log(`  pointer not a homeroom:            ${pointerNotHomeroom}`);
  console.log(`Errors:                              ${errors}`);
  console.log(DRY_RUN ? `\n(DRY RUN — nothing written. Re-run with DRY_RUN=false to apply.)\n` : `\nDone.\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
