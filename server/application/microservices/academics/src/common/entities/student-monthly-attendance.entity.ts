/**
 * Student Monthly Attendance Aggregate (Layer 2 -> 4).
 *
 * Per-student, per-month rollup of the daily SCH_ATTEND aggregate — the shape
 * IEMiS Flash II consumes (present/absent/excused day counts per student/month).
 * Recomputed idempotently (deterministic entityKey) from the daily aggregate and
 * written through as a persisted audit / future-scheduled-reader artifact; the
 * IEMiS export returns the freshly-recomputed aggregate it just wrote (it does
 * not read these rows back, so stale rows for a student who left the month are
 * harmless until a future reader consumes them).
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: MONTHLY_ATTEND#{yearMonth}#{studentId}   (yearMonth = YYYY-MM)
 *
 * GSI1 (school scope) — list every student's row for a school+month:
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: MONTHLY_ATTEND#{yearMonth}#{studentId}
 */

import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';

export interface StudentMonthlyAttendance extends BaseEntity {
  entityType: 'STUDENT_MONTHLY_ATTENDANCE';

  studentMonthlyAttendanceId: string;

  studentId: string;
  studentName?: string;
  schoolId: string;
  academicYearId?: string;

  /** Calendar month this aggregate covers, ISO YYYY-MM. */
  yearMonth: string;

  // Day counts derived from the daily SCH_ATTEND aggregate (present|excused|absent).
  presentDays: number;
  absentDays: number;
  excusedDays: number;
  /**
   * Days with any recorded daily aggregate (present + absent + excused). A V1
   * proxy for the IEMiS denominator; a calendar-instructional-day count is a
   * future refinement.
   */
  totalSchoolDays: number;

  /** When this aggregate was last recomputed. */
  computedAt: string;

  // GSI keys
  gsi1pk: string;
  gsi1sk: string;
}

/**
 * Create (overwrite) a StudentMonthlyAttendance entity with proper keys. The
 * recompute pass owns these rows wholesale, so an upsert via putItem is the
 * idempotent write path (no version CAS).
 */
export function createStudentMonthlyAttendanceEntity(
  tenantId: string,
  studentMonthlyAttendanceId: string,
  studentId: string,
  schoolId: string,
  yearMonth: string,
  data: Omit<StudentMonthlyAttendance,
    | 'tenantId' | 'entityKey' | 'entityType'
    | 'studentMonthlyAttendanceId' | 'studentId' | 'schoolId' | 'yearMonth'
    | 'gsi1pk' | 'gsi1sk'
  >,
): StudentMonthlyAttendance {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.studentMonthlyAttendance(yearMonth, studentId),
    entityType: 'STUDENT_MONTHLY_ATTENDANCE',
    studentMonthlyAttendanceId,
    studentId,
    schoolId,
    yearMonth,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `MONTHLY_ATTEND#${yearMonth}#${studentId}`,
    ...data,
  };
}
