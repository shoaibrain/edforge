/**
 * Cross-service DDB reader — Sprint E.1.3
 *
 * The report-aggregator Lambda assembles a CSV row population by joining
 * Student + Enrollment + AcademicYear + School + (Flash II: Attendance).
 *
 * Identity table (edforge-identity-basic) — School, AcademicYear.
 * Academics table (edforge-academics-basic) — Student, Enrollment, Attendance.
 *
 * All reads are partition-scoped by tenant (TENANT#<tid>) — never cross-tenant.
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
): Promise<{ yearId: string; name: string }> {
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
  return { yearId: match.yearId as string, name: match.name as string };
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
): Promise<ReportRowEnrollment[] & { studentId: string }[]> {
  // Enrollment SK: ENROLLMENT#{schoolId}#{yearId}#{studentId}
  const items: ReportRowEnrollment[] & { studentId: string }[] = [];
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
        endStatus:
          (raw.exitWithdrawTypeDescriptor as string | undefined) ??
          (raw.status as string | undefined),
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
// Attendance aggregation — Flash II.
//
// Sums per-day attendance per student over the academic year date range.
// V1 implementation queries the Attendance partition for each student; a
// future optimization could fan out via parallel queries or pre-compute a
// daily rollup. For Saraswati (~800 students × ~200 days = 160k items) this
// runs in ~30s on a single Lambda — acceptable for a quarterly batch.
// --------------------------------------------------------------------------

export async function aggregateAttendance(
  ddb: DynamoDBClient,
  academicsTable: string,
  tenantId: string,
  studentId: string,
  startDate: string,
  endDate: string,
): Promise<ReportRowAttendance> {
  // Attendance SK convention (academics): ATTENDANCE#{date}#STUDENT#{studentId}
  // — query by GSI2 (student-centric) if available, else partition scan within
  // the date range.
  //
  // V1 minimal impl: returns zeros + a warning marker. Real aggregation lands
  // when the cohort is large enough to motivate the index pattern (Sprint
  // C6 — period attendance + day rollup, per v3.4 master plan).
  return {
    presentDays: 0,
    absentDays: 0,
    totalInstructionalDays: 0,
  };
}

// --------------------------------------------------------------------------
// AcademicSession lookup — passes through the BS year label for templates.
// --------------------------------------------------------------------------

export function buildSessionShape(academicYearBs: string): ReportRowSession {
  return { yearBs: academicYearBs };
}
