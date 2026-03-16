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
 * GSI3 (Date-based attendance): GSI3PK=TENANT#{tid}#SCHOOL#{schoolId}#DATE#{date}, GSI3SK=SCH_ATTEND#{studentId} or SEC_ATTEND#{sectionId}#{studentId}
 */

import { Logger } from '@nestjs/common';

const keyLogger = new Logger('KeyBuilder');

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
  | 'SCHOOL_ATTENDANCE'
  | 'SECTION_ATTENDANCE'
  | 'SECTION_ATTENDANCE_TAKEN'
  | 'GRADE'
  | 'GRADEPOLICY'
  | 'COURSE'
  | 'SECTION'
  | 'SEC_ENROLL'
  | 'SCHEDULE'
  | 'CLASSROOM'
  | 'STANDARD'
  | 'COURSE_OFFERING'
  | 'CLASSWORK'
  | 'CLASSWORK_TOPIC';

/**
 * Entity key builder for consistent key generation
 */
/**
 * Warn-first guard: logs a warning when key builder receives undefined/null/empty params.
 * Phase 1: warn only (no throw). Phase 2 (Sprint 5): promote to throw BadRequestException.
 */
function warnIfMissing(method: string, params: Record<string, unknown>): void {
  const missing = Object.entries(params).filter(([, v]) => v === undefined || v === null || v === '');
  if (missing.length > 0) {
    const detail = missing.map(([k, v]) => `${k}=${v}`).join(', ');
    keyLogger.warn(`EntityKeyBuilder.${method}: missing params: ${detail} — caller should validate before querying`);
  }
}

export const EntityKeyBuilder = {
  student: (studentId: string): string => {
    warnIfMissing('student', { studentId });
    return `STUDENT#${studentId}`;
  },

  enrollment: (schoolId: string, yearId: string, studentId: string): string => {
    warnIfMissing('enrollment', { schoolId, yearId, studentId });
    return `ENROLLMENT#${schoolId}#${yearId}#${studentId}`;
  },

  /** @deprecated Use schoolAttendance or sectionAttendance instead */
  attendance: (date: string, studentId: string): string => {
    warnIfMissing('attendance', { date, studentId });
    return `ATTENDANCE#${date}#${studentId}`;
  },

  schoolAttendance: (date: string, studentId: string): string => {
    warnIfMissing('schoolAttendance', { date, studentId });
    return `SCH_ATTEND#${date}#${studentId}`;
  },

  sectionAttendance: (date: string, sectionId: string, studentId: string): string => {
    warnIfMissing('sectionAttendance', { date, sectionId, studentId });
    return `SEC_ATTEND#${date}#${sectionId}#${studentId}`;
  },

  sectionAttendanceTaken: (date: string, sectionId: string): string => {
    warnIfMissing('sectionAttendanceTaken', { date, sectionId });
    return `SEC_ATTEND_TAKEN#${date}#${sectionId}`;
  },

  grade: (studentId: string, courseId: string, termId: string): string => {
    warnIfMissing('grade', { studentId, courseId, termId });
    return `GRADE#${studentId}#${courseId}#${termId}`;
  },

  course: (schoolId: string, courseId: string): string => {
    warnIfMissing('course', { schoolId, courseId });
    return `COURSE#${schoolId}#${courseId}`;
  },

  section: (schoolId: string, sectionId: string): string => {
    warnIfMissing('section', { schoolId, sectionId });
    return `SECTION#${schoolId}#${sectionId}`;
  },

  schedule: (schoolId: string, scheduleId: string): string => {
    warnIfMissing('schedule', { schoolId, scheduleId });
    return `SCHEDULE#${schoolId}#${scheduleId}`;
  },

  classroom: (schoolId: string, roomId: string): string => {
    warnIfMissing('classroom', { schoolId, roomId });
    return `CLASSROOM#${schoolId}#${roomId}`;
  },

  gradingPolicy: (schoolId: string, policyId: string): string => {
    warnIfMissing('gradingPolicy', { schoolId, policyId });
    return `GRADEPOLICY#${schoolId}#${policyId}`;
  },

  courseOffering: (schoolId: string, courseOfferingId: string): string => {
    warnIfMissing('courseOffering', { schoolId, courseOfferingId });
    return `SCHOOL#${schoolId}#OFFERING#${courseOfferingId}`;
  },

  classwork: (schoolId: string, sectionId: string, itemId: string): string => {
    warnIfMissing('classwork', { schoolId, sectionId, itemId });
    return `CLASSWORK#${schoolId}#${sectionId}#${itemId}`;
  },

  classworkTopic: (schoolId: string, sectionId: string, topicId: string): string => {
    warnIfMissing('classworkTopic', { schoolId, sectionId, topicId });
    return `CLASSWORK_TOPIC#${schoolId}#${sectionId}#${topicId}`;
  },
};

/**
 * GSI key builders for academics service
 */
/**
 * Warn-first guard for GSI key builders.
 */
function warnIfMissingGSI(method: string, params: Record<string, unknown>): void {
  const missing = Object.entries(params).filter(([, v]) => v === undefined || v === null || v === '');
  if (missing.length > 0) {
    const detail = missing.map(([k, v]) => `${k}=${v}`).join(', ');
    keyLogger.warn(`GSIKeyBuilder.${method}: missing params: ${detail} — caller should validate before querying`);
  }
}

export const GSIKeyBuilder = {
  /** GSI1PK (School scope): TENANT#{tid}#SCHOOL#{schoolId} */
  schoolScope: (tenantId: string, schoolId: string): string => {
    warnIfMissingGSI('schoolScope', { tenantId, schoolId });
    return `TENANT#${tenantId}#SCHOOL#${schoolId}`;
  },

  /** GSI1SK (Entity + sort): {entityType}#{sortValue} */
  entitySort: (entityType: EntityType, sortValue: string): string =>
    `${entityType}#${sortValue}`,

  /** GSI3PK (Date-based attendance): TENANT#{tid}#SCHOOL#{schoolId}#DATE#{date} */
  attendanceDate: (tenantId: string, schoolId: string, date: string): string => {
    warnIfMissingGSI('attendanceDate', { tenantId, schoolId, date });
    return `TENANT#${tenantId}#SCHOOL#${schoolId}#DATE#${date}`;
  },

  /** GSI2PK (Student-centric attendance): TENANT#{tid}#STUDENT#{studentId} */
  attendanceStudent: (tenantId: string, studentId: string): string => {
    warnIfMissingGSI('attendanceStudent', { tenantId, studentId });
    return `TENANT#${tenantId}#STUDENT#${studentId}`;
  },
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
  username?: string; // Cognito username for Cognito-first lookups
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
 * Note: 'enrolled' and 'active' are treated as equivalent (enrolled is entity, active is DTO alias)
 */
export type EnrollmentStatus = 
  | 'enrolled' 
  | 'active'     // Alias for enrolled in DTO
  | 'pending' 
  | 'withdrawn' 
  | 'graduated' 
  | 'transferred'
  | 'suspended'  // Added for completeness
  | 'expelled'   // Added for completeness
  | 'completed'; // Added for completeness

/**
 * Attendance status
 * Extended to include additional statuses from the Zod schema
 */
export type AttendanceStatus = 
  | 'present' 
  | 'absent' 
  | 'late' 
  | 'tardy'           // Alias for late
  | 'excused' 
  | 'half_day'
  | 'early_departure' // Added for schema compatibility
  | 'remote';         // Added for schema compatibility

/**
 * Grade letter
 */
export type GradeLetter = 'A+' | 'A' | 'A-' | 'B+' | 'B' | 'B-' | 'C+' | 'C' | 'C-' | 'D+' | 'D' | 'D-' | 'F' | 'I' | 'W';

