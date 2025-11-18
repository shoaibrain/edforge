/*
 * Attendance Entity - Represents student attendance records
 * 
 * SINGLE-TABLE DESIGN:
 * PK: tenantId
 * SK: SCHOOL#{schoolId}#YEAR#{academicYearId}#CLASSROOM#{classroomId}#DATE#{date}#STUDENT#{studentId}
 * 
 * GSI1: classroomId#academicYearId#date -> List all attendance for a classroom on a date
 * GSI2: teacherId#academicYearId#date -> List attendance recorded by a teacher on a date
 * GSI3: studentId#academicYearId -> List all attendance for a student
 */

import type { 
  BaseEntity,
  AttendanceSystem,
  AttendancePeriod,
  AttendanceRecord,
  AttendanceSummary,
  AttendanceAnalytics,
  TeacherAttendanceAnalytics,
  RequestContext
} from '@edforge/shared-types';

// Re-export types from shared-types
export type { 
  BaseEntity,
  AttendanceSystem,
  AttendancePeriod,
  AttendanceRecord,
  AttendanceSummary,
  AttendanceAnalytics,
  TeacherAttendanceAnalytics,
  RequestContext
} from '@edforge/shared-types';

export class EntityKeyBuilder {
  static attendance(
    schoolId: string,
    academicYearId: string,
    studentId: string,
    date: string
  ): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#STUDENT#${studentId}#DATE#${date}#ATTENDANCE`;
  }

  static attendanceSystem(schoolId: string, academicYearId: string, systemId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#ATTENDANCE_SYSTEM#${systemId}`;
  }

  static attendanceAnalytics(schoolId: string, academicYearId: string, analyticsId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#ATTENDANCE_ANALYTICS#${analyticsId}`;
  }

  static teacherAttendanceAnalytics(schoolId: string, academicYearId: string, analyticsId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#TEACHER_ATTENDANCE_ANALYTICS#${analyticsId}`;
  }
}

