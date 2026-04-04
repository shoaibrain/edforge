/**
 * Section Attendance Taken Entity (Ed-Fi: SectionAttendanceTakenEvent)
 *
 * Records that attendance has been taken for a given section on a given date.
 * This is a section-level marker, not per-student. Used to track completion
 * and drive dashboard indicators.
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SEC_ATTEND_TAKEN#{date}#{sectionId}
 *
 * GSI3 (Date-based, school-scoped):
 * - GSI3PK: TENANT#{tid}#SCHOOL#{sid}#DATE#{date}
 * - GSI3SK: SEC_ATTEND_TAKEN#{sectionId}
 */

import {
  BaseEntity,
  EntityKeyBuilder,
  GSIKeyBuilder,
} from './base.entity';

export interface SectionAttendanceTaken extends BaseEntity {
  entityType: 'SECTION_ATTENDANCE_TAKEN';

  // References
  sectionId: string;
  schoolId: string;
  date: string;

  // Section context
  courseName?: string;
  courseCode?: string;
  sectionNumber?: string;

  // Completion
  totalStudents: number;
  studentsRecorded: number;

  // Who took attendance
  takenBy: string;
  takenByName?: string;
  takenAt: string;

  // GSI Keys
  gsi3pk: string;
  gsi3sk: string;
}

/**
 * Create a new SectionAttendanceTaken entity with proper keys
 */
export function createSectionAttendanceTakenEntity(
  tenantId: string,
  sectionId: string,
  schoolId: string,
  date: string,
  data: Omit<SectionAttendanceTaken,
    | 'tenantId' | 'entityKey' | 'entityType'
    | 'sectionId' | 'schoolId' | 'date'
    | 'gsi3pk' | 'gsi3sk'
  >,
): SectionAttendanceTaken {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.sectionAttendanceTaken(date, sectionId),
    entityType: 'SECTION_ATTENDANCE_TAKEN',
    sectionId,
    schoolId,
    date,
    gsi3pk: GSIKeyBuilder.attendanceDate(tenantId, schoolId, date),
    gsi3sk: `SEC_ATTEND_TAKEN#${sectionId}`,
    ...data,
  };
}
