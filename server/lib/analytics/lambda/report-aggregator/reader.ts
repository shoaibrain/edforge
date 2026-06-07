/**
 * Cross-service DDB reader — Sprint E.1.3
 *
 * The report-aggregator Lambda assembles a CSV row population by joining
 * Student + Enrollment + AcademicYear + School + (Flash II: Attendance).
 *
 * Identity table (edforge-identity-basic) — School, AcademicYear.
 * Academics table (edforge-academics-basic) — Student, Enrollment, Attendance.
 *
 * All reads are partition-scoped by tenant via the bare-UUID `tenantId`
 * column on each row — never cross-tenant. GSI2's `gsi2pk` column is the
 * one place that legitimately carries the `TENANT#<tid>#SCHOOL#<sid>`
 * prefix (used by resolveAcademicYearId).
 */

import {
  DynamoDBClient,
  QueryCommand,
  GetItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import type {
  ReportRowAttendance,
  ReportRowEnrollment,
  ReportRowSchool,
  ReportRowSession,
  ReportRowStudent,
} from './types';
import type { ReportRowResultCard } from './result-card-select';
import { deriveReportingEndStatus } from './academic-status-source';

// Identity + academics single-table designs store the tenant partition key
// as the bare UUID (see school.entity.ts factory + tenant-settings-resolver).
// The "TENANT#{tid}" form referenced in some entity-file comments is the
// *logical* notation, not the *stored* value. Using the prefixed form here
// caused `SCHOOL_NOT_FOUND` on every prod read until 2026-05-22.
const tenantPk = (tenantId: string): AttributeValue => ({ S: tenantId });

// --------------------------------------------------------------------------
// School lookup (identity table)
// --------------------------------------------------------------------------

export async function readSchool(
  ddb: DynamoDBClient,
  identityTable: string,
  tenantId: string,
  schoolId: string,
): Promise<ReportRowSchool> {
  const result = await ddb.send(
    new GetItemCommand({
      TableName: identityTable,
      Key: {
        tenantId: tenantPk(tenantId),
        entityKey: { S: `SCHOOL#${schoolId}` },
      },
    }),
  );
  if (!result.Item) {
    throw new Error(`SCHOOL_NOT_FOUND tenant=${tenantId} school=${schoolId}`);
  }
  const raw = unmarshall(result.Item);
  return {
    schoolId,
    emisCode: (raw.emisSchoolCode as string | undefined) ?? (raw.emisCode as string | undefined),
  };
}

// --------------------------------------------------------------------------
// AcademicYear resolver — given BS year string, find matching yearId
// --------------------------------------------------------------------------

export async function resolveAcademicYearId(
  ddb: DynamoDBClient,
  identityTable: string,
  tenantId: string,
  schoolId: string,
  academicYearBs: string,
): Promise<{ yearId: string; name: string; startDate?: string; endDate?: string }> {
  // Query all AcademicYear rows for the school via GSI2.
  const result = await ddb.send(
    new QueryCommand({
      TableName: identityTable,
      IndexName: 'GSI2',
      KeyConditionExpression: 'gsi2pk = :pk AND begins_with(gsi2sk, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `TENANT#${tenantId}#SCHOOL#${schoolId}` },
        ':prefix': { S: 'YEAR#' },
      },
    }),
  );
  const rows = (result.Items ?? []).map((i) => unmarshall(i));
  // Match by name containing the BS year string (Saraswati names are e.g. "2083"
  // or "2083-2084"). For tenants whose `name` field is Gregorian we fall back
  // to startDateBS / endDateBS substring match.
  const match = rows.find(
    (r) =>
      (typeof r.name === 'string' && r.name.includes(academicYearBs)) ||
      (typeof r.startDateBS === 'string' && r.startDateBS.startsWith(academicYearBs)),
  );
  if (!match) {
    throw new Error(
      `ACADEMIC_YEAR_NOT_FOUND tenant=${tenantId} school=${schoolId} bs=${academicYearBs}`,
    );
  }
  return {
    yearId: match.yearId as string,
    name: match.name as string,
    startDate: typeof match.startDate === 'string' ? match.startDate : undefined,
    endDate: typeof match.endDate === 'string' ? match.endDate : undefined,
  };
}

// --------------------------------------------------------------------------
// Enrollments — query by school + yearId, return all matching rows.
// --------------------------------------------------------------------------

export async function listEnrollmentsForSchoolYear(
  ddb: DynamoDBClient,
  academicsTable: string,
  tenantId: string,
  schoolId: string,
  yearId: string,
): Promise<(ReportRowEnrollment & { studentId: string })[]> {
  // Enrollment SK: ENROLLMENT#{schoolId}#{yearId}#{studentId}
  const items: (ReportRowEnrollment & { studentId: string })[] = [];
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: academicsTable,
        KeyConditionExpression: 'tenantId = :tid AND begins_with(entityKey, :prefix)',
        ExpressionAttributeValues: {
          ':tid': tenantPk(tenantId),
          ':prefix': { S: `ENROLLMENT#${schoolId}#${yearId}#` },
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const i of page.Items ?? []) {
      const raw = unmarshall(i);
      items.push({
        enrollmentId: raw.enrollmentId as string,
        gradeLevel: (raw.gradeLevel as string) ?? '',
        type: ((raw.enrollmentType as string) ?? '') as string,
        track: raw.track as string | undefined,
        // Flash II academic_status comes from the per-student promotion outcome,
        // not the uniform close-year exitWithdrawType — see academic-status-source.
        endStatus: deriveReportingEndStatus(
          raw.promotionDecision as string | undefined,
          raw.exitWithdrawTypeDescriptor as string | undefined,
          raw.status as string | undefined,
        ),
        exitWithdrawDate: raw.exitWithdrawDate as string | undefined,
        studentId: raw.studentId as string,
      });
    }
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

// --------------------------------------------------------------------------
// Students — BatchGetItem in chunks of 100 keyed by studentId.
// --------------------------------------------------------------------------

export async function readStudents(
  ddb: DynamoDBClient,
  academicsTable: string,
  tenantId: string,
  studentIds: string[],
): Promise<Map<string, ReportRowStudent>> {
  const out = new Map<string, ReportRowStudent>();
  // Student SK = STUDENT#{studentId}.
  for (const studentId of studentIds) {
    const r = await ddb.send(
      new GetItemCommand({
        TableName: academicsTable,
        Key: {
          tenantId: tenantPk(tenantId),
          entityKey: { S: `STUDENT#${studentId}` },
        },
      }),
    );
    if (!r.Item) continue;
    const raw = unmarshall(r.Item);
    out.set(studentId, {
      studentId,
      emisStudentId: raw.emisStudentId as string | undefined,
      firstName: raw.firstName as string | undefined,
      lastName: raw.lastName as string | undefined,
      dateOfBirth: (raw.dateOfBirth as string | undefined) ?? (raw.dob as string | undefined),
      sexDescriptor: raw.sexDescriptor as string | undefined,
      ethnicityDescriptor: raw.ethnicityDescriptor as string | undefined,
      motherTongueDescriptor: raw.motherTongueDescriptor as string | undefined,
      disabilities: raw.disabilities as string[] | undefined,
      hasEcedExperience: raw.hasEcedExperience as boolean | undefined,
      scholarshipCategory: raw.scholarshipCategory as string | undefined,
      scholarshipAmountNpr: raw.scholarshipAmountNpr as number | undefined,
    });
  }
  return out;
}

// --------------------------------------------------------------------------
// Result cards — Flash II exam columns (exam_total_marks / exam_gpa).
//
// ResultCards live in the academics table and are queryable by school+year via
// GSI1 (gsi1pk = `tenant#{tid}#school#{schoolId}`,
// gsi1sk = `result-card#{academicYearId}#{termId}#{examId}#{enrollmentId}`).
// We return all of an enrollment's cards (one per exam/term); the year-end
// "reporting card" is chosen later by selectReportingCard. The aggregator role
// already holds dynamodb:Query on the academics table + its indexes — no new
// IAM grant needed.
// --------------------------------------------------------------------------

export async function listResultCardsForSchoolYear(
  ddb: DynamoDBClient,
  academicsTable: string,
  tenantId: string,
  schoolId: string,
  yearId: string,
): Promise<Map<string, ReportRowResultCard[]>> {
  const byEnrollment = new Map<string, ReportRowResultCard[]>();
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: academicsTable,
        IndexName: 'GSI1',
        KeyConditionExpression: 'gsi1pk = :pk AND begins_with(gsi1sk, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `tenant#${tenantId}#school#${schoolId}` },
          ':prefix': { S: `result-card#${yearId}#` },
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const i of page.Items ?? []) {
      const raw = unmarshall(i);
      if (raw.entityType !== 'RESULT_CARD' || raw.isActive === false) continue;
      const enrollmentId = raw.enrollmentId as string | undefined;
      if (!enrollmentId) continue;
      const card: ReportRowResultCard = {
        enrollmentId,
        examId: (raw.examId as string) ?? '',
        termId: (raw.termId as string) ?? '',
        isTerminalExam: raw.isTerminalExam === true,
        totalScore: Number(raw.totalScore) || 0,
        totalMaxMarks: Number(raw.totalMaxMarks) || 0,
        termGpa: Number(raw.termGpa) || 0,
        percentage: typeof raw.percentage === 'number' ? raw.percentage : undefined,
        generatedAt: (raw.updatedAt as string) ?? (raw.createdAt as string) ?? undefined,
      };
      const arr = byEnrollment.get(enrollmentId);
      if (arr) arr.push(card);
      else byEnrollment.set(enrollmentId, [card]);
    }
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return byEnrollment;
}

// --------------------------------------------------------------------------
// Attendance aggregation — Flash II.
//
// Sums per-day attendance per student over the academic year date range.
// V1 implementation queries the Attendance partition for each student; a
// future optimization could fan out via parallel queries or pre-compute a
// daily rollup. For Saraswati (~800 students × ~200 days = 160k items) this
// runs in ~30s on a single Lambda — acceptable for a quarterly batch.
// --------------------------------------------------------------------------

// Statuses where the student was physically at school (count as a present day).
// `half_day` counts as 0.5; `absent`/`excused`/unknown count as absent. The set
// is a single point of change if CEHRD's `total_attendance_days` definition
// firms up differently once a school runs Flash II.
const PRESENT_FULL_STATUSES = new Set([
  'present',
  'late',
  'tardy',
  'early_departure',
  'remote',
]);

export async function aggregateAttendance(
  ddb: DynamoDBClient,
  academicsTable: string,
  tenantId: string,
  studentId: string,
  startDate: string,
  endDate: string,
): Promise<ReportRowAttendance> {
  // SchoolAttendance is one row per student per date, queryable student-centric
  // via GSI2 (gsi2pk=`TENANT#{tid}#STUDENT#{sid}`, gsi2sk=`SCH_ATTEND#{date}`).
  // Range-bound by the academic year's Gregorian dates when available so a
  // multi-year student isn't over-counted; otherwise sum all the student's days.
  const values: Record<string, AttributeValue> = {
    ':pk': { S: `TENANT#${tenantId}#STUDENT#${studentId}` },
  };
  let keyCond = 'gsi2pk = :pk AND ';
  if (startDate && endDate) {
    keyCond += 'gsi2sk BETWEEN :lo AND :hi';
    values[':lo'] = { S: `SCH_ATTEND#${startDate}` };
    values[':hi'] = { S: `SCH_ATTEND#${endDate}` };
  } else {
    keyCond += 'begins_with(gsi2sk, :prefix)';
    values[':prefix'] = { S: 'SCH_ATTEND#' };
  }

  let present = 0;
  let absent = 0;
  let total = 0;
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: academicsTable,
        IndexName: 'GSI2',
        KeyConditionExpression: keyCond,
        ExpressionAttributeValues: values,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const i of page.Items ?? []) {
      const raw = unmarshall(i);
      if (raw.entityType !== 'SCHOOL_ATTENDANCE') continue;
      total += 1;
      const status = typeof raw.status === 'string' ? raw.status.toLowerCase() : '';
      if (PRESENT_FULL_STATUSES.has(status)) present += 1;
      else if (status === 'half_day') {
        present += 0.5;
        absent += 0.5;
      } else absent += 1;
    }
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);

  return {
    presentDays: Math.round(present),
    absentDays: Math.round(absent),
    totalInstructionalDays: total,
  };
}

// --------------------------------------------------------------------------
// AcademicSession lookup — passes through the BS year label for templates.
// --------------------------------------------------------------------------

export function buildSessionShape(academicYearBs: string): ReportRowSession {
  return { yearBs: academicYearBs };
}
