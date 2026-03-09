/**
 * Attendance Entity for Academics Service
 * 
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: ATTENDANCE#{date}#{studentId}
 * 
 * GSI3 (Date-based for bulk queries):
 * - GSI3PK: TENANT#{tid}#SCHOOL#{schoolId}#DATE#{date}
 * - GSI3SK: ATTENDANCE#{studentId}
 */

import { 
  BaseEntity, 
  EntityKeyBuilder,
  GSIKeyBuilder,
  AttendanceStatus,
} from './base.entity';

/**
 * Attendance entity - represents daily attendance record for a student
 */
export interface Attendance extends BaseEntity {
  entityType: 'ATTENDANCE';
  
  // References
  attendanceId: string;
  studentId: string;
  studentName?: string;
  schoolId: string;
  academicYearId: string;
  
  // Date
  date: string;  // ISO date (YYYY-MM-DD)
  dayOfWeek: number;  // 0-6 (Sunday-Saturday)
  
  // Status
  status: AttendanceStatus;
  
  // Times (for detailed tracking)
  checkInTime?: string;  // ISO time
  checkOutTime?: string;
  
  // Section/Course context (denormalized at write time from CourseSection)
  sectionId?: string;
  courseName?: string;

  // Period-level attendance (optional)
  periodAttendance?: PeriodAttendance[];

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
  gsi3pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}#DATE#{date}
  gsi3sk: string;  // ATTENDANCE#{studentId}
}

/**
 * Period-level attendance (for secondary schools)
 */
export interface PeriodAttendance {
  periodNumber: number;
  periodName?: string;
  courseId?: string;
  teacherId?: string;
  status: AttendanceStatus;
  note?: string;
}

/**
 * Create a new Attendance entity with proper keys
 * Note: dayOfWeek is computed from date, so it's not required in data param
 */
export function createAttendanceEntity(
  tenantId: string,
  attendanceId: string,
  studentId: string,
  schoolId: string,
  date: string,
  data: Omit<Attendance, 'tenantId' | 'entityKey' | 'entityType' | 'attendanceId' | 'studentId' | 'schoolId' | 'date' | 'dayOfWeek' | 'gsi3pk' | 'gsi3sk'>
): Attendance {
  const d = new Date(date);
  
  return {
    tenantId,
    entityKey: EntityKeyBuilder.attendance(date, studentId),
    entityType: 'ATTENDANCE',
    attendanceId,
    studentId,
    schoolId,
    date,
    dayOfWeek: d.getDay(),
    gsi3pk: GSIKeyBuilder.attendanceDate(tenantId, schoolId, date),
    gsi3sk: `ATTENDANCE#${studentId}`,
    ...data,
  };
}

/**
 * Bulk attendance record for batch operations
 */
export interface BulkAttendanceRecord {
  studentId: string;
  studentName?: string;
  status: AttendanceStatus;
  checkInTime?: string;
  note?: string;
}
