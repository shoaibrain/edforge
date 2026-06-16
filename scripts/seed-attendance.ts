/**
 * Dev/Perf Seed Script: generate school-day attendance (SCH_ATTEND) rows
 *
 * Context (Attendance Domain epic, Sprint 1 / S1.T6):
 * The dev tenant has near-zero attendance traffic, which makes both the UX and
 * the perf harness (S1.T4) impossible to exercise. This script seeds realistic,
 * full-roster daily school attendance for a school over a date range so the
 * dashboard, alerts/overview, and load tests have data to chew on.
 *
 * It writes the same shape `createSchoolAttendanceEntity` produces, including
 * derivedFrom='direct' (these are seeded "direct" records, not section-derived).
 *
 * Usage:
 *   TABLE_NAME=edforge-academics-basic \
 *   TENANT_ID=<tid> SCHOOL_ID=<sid> ACADEMIC_YEAR_ID=<ayid> \
 *   START_DATE=2026-05-01 END_DATE=2026-06-16 \
 *   DRY_RUN=true npx ts-node scripts/seed-attendance.ts
 *
 * Safety:
 *   - Idempotent: each row is written with `attribute_not_exists(entityKey)`, so
 *     re-running never overwrites existing attendance (already-seeded dates skip).
 *   - Deterministic: the status for a (studentId, date) pair is a stable hash, so
 *     dry-run and real runs agree and reruns are stable.
 *   - Bounded: only seeds the enrolled students of one school/year.
 */

import { DynamoDBClient, ScanCommand, PutItemCommand } from '@aws-sdk/client-dynamodb';
import { unmarshall, marshall } from '@aws-sdk/util-dynamodb';
import { randomUUID } from 'crypto';

// ============================================================================
// Configuration
// ============================================================================

const TABLE_NAME = process.env.TABLE_NAME || 'EdForge-AcademicsTable';
const REGION = process.env.AWS_REGION || 'ap-south-1';
const DRY_RUN = process.env.DRY_RUN === 'true';
const TENANT_ID = process.env.TENANT_ID || '';
const SCHOOL_ID = process.env.SCHOOL_ID || '';
const ACADEMIC_YEAR_ID = process.env.ACADEMIC_YEAR_ID || '';
const START_DATE = process.env.START_DATE || '';
const END_DATE = process.env.END_DATE || '';
// Nepal week is Sun–Fri; skip Saturday (getUTCDay() === 6) by default.
const SKIP_WEEKEND = process.env.SKIP_WEEKEND !== 'false';

const client = new DynamoDBClient({ region: REGION });

// Status mix (cumulative thresholds out of 100). Present-heavy, realistic.
const STATUS_BANDS: Array<[max: number, status: string]> = [
  [88, 'present'],
  [94, 'absent'],
  [97, 'late'],
  [99, 'excused'],
  [100, 'half_day'],
];

/** Stable, fast non-cryptographic hash → 0..99 for a (studentId, date) pair. */
function pick(studentId: string, date: string): string {
  const s = `${studentId}#${date}`;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const bucket = Math.abs(h) % 100;
  return STATUS_BANDS.find(([max]) => bucket < max)![1];
}

function enumerateDates(start: string, end: string): string[] {
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  while (d <= last) {
    if (!(SKIP_WEEKEND && d.getUTCDay() === 6)) {
      out.push(d.toISOString().slice(0, 10));
    }
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  for (const [k, v] of Object.entries({ TENANT_ID, SCHOOL_ID, ACADEMIC_YEAR_ID, START_DATE, END_DATE })) {
    if (!v) {
      console.error(`Missing required env var: ${k}`);
      process.exit(1);
    }
  }

  console.log(`\n=== Seed SchoolAttendance (SCH_ATTEND) ===`);
  console.log(`Table: ${TABLE_NAME}  Region: ${REGION}  Dry Run: ${DRY_RUN}`);
  console.log(`Tenant: ${TENANT_ID}  School: ${SCHOOL_ID}  Year: ${ACADEMIC_YEAR_ID}`);
  console.log(`Dates: ${START_DATE}..${END_DATE} (skipWeekend=${SKIP_WEEKEND})\n`);

  // 1. Collect enrolled students for the school/year.
  const students: Array<{ studentId: string; studentName?: string }> = [];
  let lastKey: Record<string, any> | undefined;
  do {
    const res = await client.send(new ScanCommand({
      TableName: TABLE_NAME,
      FilterExpression: 'entityType = :t AND tenantId = :tid AND schoolId = :s AND academicYearId = :y',
      ExpressionAttributeValues: marshall({ ':t': 'ENROLLMENT', ':tid': TENANT_ID, ':s': SCHOOL_ID, ':y': ACADEMIC_YEAR_ID }),
      ExclusiveStartKey: lastKey ? marshall(lastKey) : undefined,
    }));
    for (const item of res.Items || []) {
      const e = unmarshall(item);
      if (e.status === 'enrolled' || e.status === 'active') {
        students.push({ studentId: e.studentId, studentName: e.studentName });
      }
    }
    lastKey = res.LastEvaluatedKey ? unmarshall(res.LastEvaluatedKey) : undefined;
  } while (lastKey);

  const dates = enumerateDates(START_DATE, END_DATE);
  console.log(`Enrolled students: ${students.length}  Instructional dates: ${dates.length}`);
  console.log(`Rows to consider: ${students.length * dates.length}\n`);

  let written = 0;
  let skipped = 0;
  let errors = 0;

  for (const date of dates) {
    const dayOfWeek = new Date(`${date}T00:00:00Z`).getUTCDay();
    for (const { studentId, studentName } of students) {
      const status = pick(studentId, date);
      const now = new Date().toISOString();
      const entityKey = `SCH_ATTEND#${date}#${studentId}`;
      const item = {
        tenantId: TENANT_ID,
        entityKey,
        entityType: 'SCHOOL_ATTENDANCE',
        schoolAttendanceId: randomUUID(),
        studentId,
        studentName,
        schoolId: SCHOOL_ID,
        academicYearId: ACADEMIC_YEAR_ID,
        date,
        dayOfWeek,
        status,
        derivedFrom: 'direct',
        recordedBy: 'seed-script',
        gsi3pk: `TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}#DATE#${date}`,
        gsi3sk: `SCH_ATTEND#${studentId}`,
        gsi2pk: `TENANT#${TENANT_ID}#STUDENT#${studentId}`,
        gsi2sk: `SCH_ATTEND#${date}`,
        createdAt: now,
        createdBy: 'seed-script',
        updatedAt: now,
        updatedBy: 'seed-script',
        version: 1,
      };

      if (DRY_RUN) {
        written++;
        continue;
      }

      try {
        await client.send(new PutItemCommand({
          TableName: TABLE_NAME,
          Item: marshall(item, { removeUndefinedValues: true }),
          ConditionExpression: 'attribute_not_exists(entityKey)',
        }));
        written++;
      } catch (err: any) {
        if (err.name === 'ConditionalCheckFailedException') {
          skipped++;
        } else {
          console.error(`  ERROR ${entityKey}:`, err.message);
          errors++;
        }
      }
    }
    console.log(`  ${date}: processed ${students.length} students`);
  }

  console.log(`\n=== Summary ===`);
  console.log(`Written: ${written}`);
  console.log(`Skipped (already existed): ${skipped}`);
  console.log(`Errors: ${errors}`);
  console.log(`\nDone.`);
  if (errors > 0) {
    console.error(`\n⚠  Seed completed with ${errors} write error(s) — automated callers should treat this as a failure.`);
    process.exit(1);
  }
}

main().catch(console.error);
