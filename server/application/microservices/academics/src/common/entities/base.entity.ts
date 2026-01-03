/**
 * Base Entity Types for Academics Service
 * 
 * DynamoDB Single-Table Design:
 * - Table: edforge-academics-{tier}
 * - PK: tenantId (TENANT#{tid})
 * - SK: entityKey (varies by entity type)
 * 
 * GSI1 (School-scoped): GSI1PK=TENANT#{tid}#SCHOOL#{schoolId}, GSI1SK={entityType}#{sortValue}
 * GSI2 (Student-centric): GSI2PK={studentId}, GSI2SK={entityType}#{date/year}
 * GSI3 (Date-based attendance): GSI3PK=TENANT#{tid}#SCHOOL#{schoolId}#DATE#{date}, GSI3SK=ATTENDANCE#{studentId}
 */

/**
 * Base entity interface for all academics entities
 */
export interface BaseEntity {
  tenantId: string;
  entityKey: string;
  entityType: EntityType;
  
  // Audit fields
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

/**
 * Entity types in the academics service
 */
export type EntityType = 
  | 'STUDENT' 
  | 'ENROLLMENT' 
  | 'ATTENDANCE' 
  | 'GRADE' 
  | 'COURSE' 
  | 'SCHEDULE' 
  | 'CLASSROOM' 
  | 'STANDARD';

/**
 * Entity key builder for consistent key generation
 */
export const EntityKeyBuilder = {
  /**
   * Student: STUDENT#{studentId}
   */
  student: (studentId: string): string => `STUDENT#${studentId}`,

  /**
   * Enrollment: ENROLLMENT#{schoolId}#{yearId}#{studentId}
   */
  enrollment: (schoolId: string, yearId: string, studentId: string): string => 
    `ENROLLMENT#${schoolId}#${yearId}#${studentId}`,

  /**
   * Attendance: ATTENDANCE#{date}#{studentId}
   */
  attendance: (date: string, studentId: string): string => 
    `ATTENDANCE#${date}#${studentId}`,

  /**
   * Grade: GRADE#{studentId}#{courseId}#{termId}
   */
  grade: (studentId: string, courseId: string, termId: string): string => 
    `GRADE#${studentId}#${courseId}#${termId}`,

  /**
   * Course: COURSE#{schoolId}#{courseId}
   */
  course: (schoolId: string, courseId: string): string => 
    `COURSE#${schoolId}#${courseId}`,

  /**
   * Schedule: SCHEDULE#{schoolId}#{scheduleId}
   */
  schedule: (schoolId: string, scheduleId: string): string => 
    `SCHEDULE#${schoolId}#${scheduleId}`,

  /**
   * Classroom: CLASSROOM#{schoolId}#{roomId}
   */
  classroom: (schoolId: string, roomId: string): string => 
    `CLASSROOM#${schoolId}#${roomId}`,
};

/**
 * GSI key builders for academics service
 */
export const GSIKeyBuilder = {
  /**
   * GSI1PK (School scope): TENANT#{tid}#SCHOOL#{schoolId}
   */
  schoolScope: (tenantId: string, schoolId: string): string => 
    `TENANT#${tenantId}#SCHOOL#${schoolId}`,

  /**
   * GSI1SK (Entity + sort): {entityType}#{sortValue}
   */
  entitySort: (entityType: EntityType, sortValue: string): string => 
    `${entityType}#${sortValue}`,

  /**
   * GSI3PK (Date-based attendance): TENANT#{tid}#SCHOOL#{schoolId}#DATE#{date}
   */
  attendanceDate: (tenantId: string, schoolId: string, date: string): string => 
    `TENANT#${tenantId}#SCHOOL#${schoolId}#DATE#${date}`,
};

/**
 * Request context for academics operations
 */
export interface RequestContext {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
  schoolId?: string;
  jwtToken: string;
}

/**
 * Pagination result
 */
export interface PaginatedResult<T> {
  items: T[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Gender type
 */
export type Gender = 'male' | 'female' | 'other' | 'prefer_not_to_say';

/**
 * Student status
 */
export type StudentStatus = 'active' | 'inactive' | 'graduated' | 'transferred' | 'withdrawn';

/**
 * Enrollment status
 */
export type EnrollmentStatus = 'enrolled' | 'pending' | 'withdrawn' | 'graduated' | 'transferred';

/**
 * Attendance status
 */
export type AttendanceStatus = 'present' | 'absent' | 'late' | 'excused' | 'half_day';

/**
 * Grade letter
 */
export type GradeLetter = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F' | 'I' | 'W';

