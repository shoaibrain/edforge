/**
 * School Attendance Entity (Ed-Fi: StudentSchoolAttendanceEvent)
 *
 * Records whether a student attended school on a given date.
 * One record per student per date. Typically derived from section attendance.
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SCH_ATTEND#{date}#{studentId}
 *
 * GSI3 (Date-based, school-scoped):
 * - GSI3PK: TENANT#{tid}#SCHOOL#{sid}#DATE#{date}
 * - GSI3SK: SCH_ATTEND#{studentId}
 *
 * GSI2 (Student-centric):
 * - GSI2PK: TENANT#{tid}#STUDENT#{studentId}
 * - GSI2SK: SCH_ATTEND#{date}
 */

import {
  BaseEntity,
  EntityKeyBuilder,
  GSIKeyBuilder,
  AttendanceStatus,
} from './base.entity';

export interface SchoolAttendance extends BaseEntity {
  entityType: 'SCHOOL_ATTENDANCE';

  // Identity
  schoolAttendanceId: string;

  // References
  studentId: string;
  studentName?: string;
  schoolId: string;
  academicYearId: string;

  // Date
  date: string;  // ISO date (YYYY-MM-DD)
  dayOfWeek: number;  // 0-6 (Sunday-Saturday)

  // Status
  status: AttendanceStatus;

  // Ed-Fi descriptors (populated in Sprint 4)
  attendanceEventCategory?: string;
  attendanceEventReason?: string;

  // Derivation metadata
  derivedFrom?: 'section_attendance' | 'direct';
  derivedAt?: string;  // ISO timestamp

  // Times
  checkInTime?: string;
  checkOutTime?: string;

  // Notes
  note?: string;
  reason?: string;

  // Verification
  recordedBy: string;
  verifiedBy?: string;
  verifiedAt?: string;

  // Parent notification
  parentNotified?: boolean;
  parentNotifiedAt?: string;

  // GSI Keys
  gsi3pk: string;
  gsi3sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

/**
 * Attendance summary for reporting (shared between school/section contexts)
 */
export interface AttendanceSummary {
  studentId: string;
  schoolId: string;
  academicYearId: string;
  termId?: string;
  dateRange: {
    start: string;
    end: string;
  };
  totalDays: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  halfDay: number;
  attendanceRate: number;
}

/**
 * Create a new SchoolAttendance entity with proper keys
 */
export function createSchoolAttendanceEntity(
  tenantId: string,
  schoolAttendanceId: string,
  studentId: string,
  schoolId: string,
  date: string,
  data: Omit<SchoolAttendance,
    | 'tenantId' | 'entityKey' | 'entityType'
    | 'schoolAttendanceId' | 'studentId' | 'schoolId'
    | 'date' | 'dayOfWeek'
    | 'gsi3pk' | 'gsi3sk' | 'gsi2pk' | 'gsi2sk'
  >,
): SchoolAttendance {
  const d = new Date(date);

  return {
    tenantId,
    entityKey: EntityKeyBuilder.schoolAttendance(date, studentId),
    entityType: 'SCHOOL_ATTENDANCE',
    schoolAttendanceId,
    studentId,
    schoolId,
    date,
    dayOfWeek: d.getDay(),
    gsi3pk: GSIKeyBuilder.attendanceDate(tenantId, schoolId, date),
    gsi3sk: `SCH_ATTEND#${studentId}`,
    gsi2pk: GSIKeyBuilder.attendanceStudent(tenantId, studentId),
    gsi2sk: `SCH_ATTEND#${date}`,
    ...data,
  };
}
