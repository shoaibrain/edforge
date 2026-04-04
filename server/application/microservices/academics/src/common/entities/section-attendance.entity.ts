/**
 * Section Attendance Entity (Ed-Fi: StudentSectionAttendanceEvent)
 *
 * Records whether a student attended a specific class section on a given date.
 * Each student can have one record per section per date.
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SEC_ATTEND#{date}#{sectionId}#{studentId}
 *
 * GSI3 (Date-based, school-scoped):
 * - GSI3PK: TENANT#{tid}#SCHOOL#{sid}#DATE#{date}
 * - GSI3SK: SEC_ATTEND#{sectionId}#{studentId}
 *
 * GSI2 (Student-centric):
 * - GSI2PK: TENANT#{tid}#STUDENT#{studentId}
 * - GSI2SK: SEC_ATTEND#{date}#{sectionId}
 */

import {
  BaseEntity,
  EntityKeyBuilder,
  GSIKeyBuilder,
  AttendanceStatus,
} from './base.entity';

export interface SectionAttendance extends BaseEntity {
  entityType: 'SECTION_ATTENDANCE';

  // Identity
  sectionAttendanceId: string;

  // References
  studentId: string;
  studentName?: string;
  schoolId: string;
  sectionId: string;
  courseName?: string;
  courseCode?: string;
  academicYearId: string;

  // Date
  date: string;  // ISO date (YYYY-MM-DD)
  dayOfWeek: number;  // 0-6 (Sunday-Saturday)

  // Status
  status: AttendanceStatus;

  // Ed-Fi descriptors (populated in Sprint 4)
  attendanceEventCategory?: string;
  attendanceEventReason?: string;
  educationalEnvironment?: string;

  // Times
  checkInTime?: string;
  checkOutTime?: string;
  sectionAttendanceDuration?: number; // minutes

  // Notes
  note?: string;
  reason?: string;  // For absences/excuses

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
 * Create a new SectionAttendance entity with proper keys
 */
export function createSectionAttendanceEntity(
  tenantId: string,
  sectionAttendanceId: string,
  studentId: string,
  schoolId: string,
  sectionId: string,
  date: string,
  data: Omit<SectionAttendance,
    | 'tenantId' | 'entityKey' | 'entityType'
    | 'sectionAttendanceId' | 'studentId' | 'schoolId' | 'sectionId'
    | 'date' | 'dayOfWeek'
    | 'gsi3pk' | 'gsi3sk' | 'gsi2pk' | 'gsi2sk'
  >,
): SectionAttendance {
  const d = new Date(date);

  return {
    tenantId,
    entityKey: EntityKeyBuilder.sectionAttendance(date, sectionId, studentId),
    entityType: 'SECTION_ATTENDANCE',
    sectionAttendanceId,
    studentId,
    schoolId,
    sectionId,
    date,
    dayOfWeek: d.getDay(),
    gsi3pk: GSIKeyBuilder.attendanceDate(tenantId, schoolId, date),
    gsi3sk: `SEC_ATTEND#${sectionId}#${studentId}`,
    gsi2pk: GSIKeyBuilder.attendanceStudent(tenantId, studentId),
    gsi2sk: `SEC_ATTEND#${date}#${sectionId}`,
    ...data,
  };
}
