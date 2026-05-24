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
  | 'CLASSWORK_TOPIC'
  | 'IEMIS_AUDIT_EVENT'
  | 'IEMIS_IMPORT_JOB'
  // Sprint A.3 — Exam Subsystem
  | 'EXAM'
  | 'EXAM_COURSE'
  | 'EXAM_SCORE'
  // Sprint A.4 — Result Subsystem
  | 'RESULT_CARD'
  // Sprint D.2 — PromotionRule + cross-year handoff
  | 'PROMOTION_RULE'
  // Sprint D.2 — Uniqueness lock paired with PROMOTION_RULE to enforce
  // one-active-rule-per-(schoolId, gradeLevel) under concurrent first-GETs.
  | 'PROMOTION_RULE_LOCK'
  // Sprint D.3 — ExternalAssessment family (BLE / SEE / NEB-11 / NEB-12 foundation).
  | 'RUBRIC_CATEGORY'
  | 'EXTERNAL_EXAM_REGISTRATION'
  // Sprint D.3 — Uniqueness lock paired with EXTERNAL_EXAM_REGISTRATION to
  // enforce one-active-row per (schoolId, studentId, examType, examYear).
  // Mirrors PROMOTION_RULE_LOCK pattern (D.2.1). D.4 controllers write the
  // lock + the registration in a single TransactWriteItems with
  // attribute_not_exists(entityKey).
  | 'EXTERNAL_EXAM_REGISTRATION_LOCK'
  | 'INTERNAL_ASSESSMENT'
  | 'EXTERNAL_EXAM_ADMIT_CARD'
  | 'EXTERNAL_EXAM_RESULT'
  | 'EXTERNAL_EXAM_RETAKE';

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

  /** Sprint D.2.1 — PromotionRule entity key. */
  promotionRule: (schoolId: string, ruleId: string): string => {
    warnIfMissing('promotionRule', { schoolId, ruleId });
    return `PROMOTION_RULE#${schoolId}#${ruleId}`;
  },

  /**
   * Sprint D.2.1 — Uniqueness lock key for PromotionRule. Deterministic
   * by (schoolId, gradeLevel) so concurrent first-GETs race exactly one
   * winner via TransactWriteItems + `attribute_not_exists(entityKey)`.
   * Soft-delete of the rule MUST also delete this lock so a fresh active
   * rule can be created later.
   */
  promotionRuleLock: (schoolId: string, gradeLevel: string): string => {
    warnIfMissing('promotionRuleLock', { schoolId, gradeLevel });
    return `PROMOTION_RULE_LOCK#${schoolId}#${gradeLevel}`;
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

  iemisImportJob: (jobId: string): string => {
    warnIfMissing('iemisImportJob', { jobId });
    return `IEMIS_JOB#${jobId}`;
  },

  // Sprint A.3 — Exam Subsystem
  exam: (schoolId: string, examId: string): string => {
    warnIfMissing('exam', { schoolId, examId });
    return `EXAM#${schoolId}#${examId}`;
  },

  examCourse: (examId: string, examCourseId: string): string => {
    warnIfMissing('examCourse', { examId, examCourseId });
    return `EXAM_COURSE#${examId}#${examCourseId}`;
  },

  examScore: (examId: string, examScoreId: string): string => {
    warnIfMissing('examScore', { examId, examScoreId });
    return `EXAM_SCORE#${examId}#${examScoreId}`;
  },

  // Sprint A.4 — Result Subsystem (per-student per-term ResultCard).
  // Keyed by enrollmentId per invariant 3 — preserves cross-AY identity
  // through promotion (D.2.10) enrollment rewrites.
  resultCard: (enrollmentId: string, cardId: string): string => {
    warnIfMissing('resultCard', { enrollmentId, cardId });
    return `RESULT_CARD#${enrollmentId}#${cardId}`;
  },

  // ============================================
  // Sprint D.3 — ExternalAssessment family
  // ============================================

  /** D.3.0 — RubricCategory key. Scoped to (schoolId, categoryId). */
  rubricCategory: (schoolId: string, categoryId: string): string => {
    warnIfMissing('rubricCategory', { schoolId, categoryId });
    return `RUBRIC_CATEGORY#${schoolId}#${categoryId}`;
  },

  /** D.3.1 — ExternalExamRegistration key. Scoped to (schoolId, registrationId). */
  externalExamRegistration: (schoolId: string, registrationId: string): string => {
    warnIfMissing('externalExamRegistration', { schoolId, registrationId });
    return `EXT_EXAM_REG#${schoolId}#${registrationId}`;
  },

  /**
   * D.3.1 — Uniqueness-lock key paired with EXTERNAL_EXAM_REGISTRATION.
   * Deterministic by (schoolId, studentId, examType, examYear) so concurrent
   * registrations race exactly one winner via TransactWriteItems +
   * `attribute_not_exists(entityKey)`. Soft-cancel of the registration MUST
   * also delete this lock so re-registration is allowed.
   */
  externalExamRegistrationLock: (
    schoolId: string,
    studentId: string,
    examType: string,
    examYear: number,
  ): string => {
    warnIfMissing('externalExamRegistrationLock', { schoolId, studentId, examType, examYear });
    return `EXT_EXAM_REG_LOCK#${schoolId}#${studentId}#${examType}#${examYear}`;
  },

  /** D.3.2 — InternalAssessment key. Scoped to (registrationId, assessmentId). */
  internalAssessment: (registrationId: string, assessmentId: string): string => {
    warnIfMissing('internalAssessment', { registrationId, assessmentId });
    return `INTERNAL_ASSESSMENT#${registrationId}#${assessmentId}`;
  },

  /** D.3.3 — ExternalExamAdmitCard key. 1:1 with registrationId. */
  externalExamAdmitCard: (registrationId: string): string => {
    warnIfMissing('externalExamAdmitCard', { registrationId });
    return `EXT_ADMIT_CARD#${registrationId}`;
  },

  /** D.3.4 — ExternalExamResult key. 1:1 with registrationId. */
  externalExamResult: (registrationId: string): string => {
    warnIfMissing('externalExamResult', { registrationId });
    return `EXT_EXAM_RESULT#${registrationId}`;
  },

  /** D.3.5 — ExternalExamRetake key. Scoped to (originalResultId, retakeId). */
  externalExamRetake: (originalResultId: string, retakeId: string): string => {
    warnIfMissing('externalExamRetake', { originalResultId, retakeId });
    return `EXT_EXAM_RETAKE#${originalResultId}#${retakeId}`;
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

  /**
   * GSI7PK (EMIS / government-ID lookup for students):
   *   TENANT#{tid}#EMIS#{emisStudentId}
   *
   * Used by `StudentsService.findByEmisStudentId` to resolve IEMIS Student IDs
   * to internal `studentId`s (Saraswati / PABSON pilot, Project Midnight Lockin P0.2).
   * GSI7 is overloaded (see `ecs-dynamodb.ts`); queries always scope by exact
   * gsi7pk so the overload is safe.
   */
  emisStudent: (tenantId: string, emisStudentId: string): string => {
    warnIfMissingGSI('emisStudent', { tenantId, emisStudentId });
    return `TENANT#${tenantId}#EMIS#${emisStudentId}`;
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
export type StudentStatus = 'active' | 'inactive' | 'pending' | 'graduated' | 'transferred' | 'withdrawn' | 'suspended';

/**
 * Enrollment status
 * Note: 'enrolled' and 'active' are treated as equivalent (enrolled is entity, active is DTO alias)
 */
export type EnrollmentStatus =
  | 'enrolled'
  | 'active'         // Alias for enrolled in DTO
  | 'pending'
  | 'provisional'    // Sprint D.2.8 — created by D.2.6 commit; flipped to 'enrolled' by D.2.10 atomic flip on terminal result.published
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
 * Grade letter — archetype-agnostic string.
 *
 * D.1.2 (2026-05-22) — widened from a hard US-scale enum
 * (`'A+'|'A'|...|'W'`) to `string`. The valid set of letters is now
 * tenant-driven by `GradingPolicyEntity.letterGrades[].letter`. Allows
 * Nepal CEHRD `NG` (Not-Graded) sentinel, future weighted-honors letters,
 * and any archetype-defined scale without an entity-file edit.
 *
 * Runtime validation lives at write time (Zod schema accepts
 * `z.string().max(5)`), not via TS literal-type checks.
 * `scripts/lint/check-no-hardcoded-letter-enums.sh` blocks any future
 * reintroduction of a hardcoded letter union.
 */
export type GradeLetter = string;

