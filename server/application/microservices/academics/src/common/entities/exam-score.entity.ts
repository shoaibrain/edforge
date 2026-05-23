/**
 * ExamScore Entity — Sprint A.3.4
 *
 * Per-student per-ExamCourse score row.
 *
 * **Keyed by `enrollmentId` (invariant 3):** the student-binding field is
 * `enrollmentId`, NOT `(studentId, examId)`. This preserves cross-year
 * integrity: when grade-promotion (D.2.10) rewrites `Enrollment.gradeLevel`,
 * the ExamScore stays bound to the prior-AY enrollment. The PRIMARY KEY uses
 * `examScoreId` UUID; `enrollmentId` is the binding field for cross-year
 * queries via GSI3.
 *
 * Key Structure (DynamoDB single-table; bare-UUID tenantId):
 *   - PK: tenantId
 *   - SK: EXAM_SCORE#{examId}#{examScoreId}
 *
 * GSI1 (school-scope): GSI1PK=tenant#{tid}#school#{schoolId}, GSI1SK=exam-score#{examId}#{examCourseId}#{enrollmentId}
 * GSI2 (student-centric cross-AY): GSI2PK=student#{studentId}, GSI2SK=exam-score#{academicYearId}#{termId}#{examId}
 * GSI3 (per-enrollment): GSI3PK=enrollment#{enrollmentId}, GSI3SK=exam-score#{examId}
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.4
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';

export type ExamScoreStatus = 'entered' | 'locked';

export interface ExamScore extends BaseEntity {
  entityType: 'EXAM_SCORE';

  // Identity
  examScoreId: string;
  examId: string;
  examCourseId: string;

  // BINDING FIELD (invariant 3) — student anchor
  enrollmentId: string;

  // Denormalized for query + audit convenience
  schoolId: string;
  studentId: string;
  academicYearId: string;
  termId: string;

  // Marks
  rawScore: number;                   // 0 ≤ rawScore ≤ ExamCourse.maxMarks (max enforced server-side, not in entity)

  // Lifecycle
  status: ExamScoreStatus;            // 'entered' allows update; 'locked' rejects
  enteredBy: string;                  // userId
  enteredAt: string;                  // ISO timestamp

  // Bulk-write idempotency marker (A.3.9)
  correlationId?: string;

  // GSI Keys (lowercase per S3.2)
  gsi1pk: string;  // 'tenant#{tid}#school#{schoolId}'
  gsi1sk: string;  // 'exam-score#{examId}#{examCourseId}#{enrollmentId}'
  gsi2pk: string;  // 'student#{studentId}'
  gsi2sk: string;  // 'exam-score#{academicYearId}#{termId}#{examId}'
  gsi3pk: string;  // 'enrollment#{enrollmentId}'
  gsi3sk: string;  // 'exam-score#{examId}'
}

function examScoreSchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}

function examScoreSchoolGsi1sk(examId: string, examCourseId: string, enrollmentId: string): string {
  return `exam-score#${examId}#${examCourseId}#${enrollmentId}`;
}

function examScoreStudentGsi2pk(studentId: string): string {
  return `student#${studentId}`;
}

function examScoreStudentGsi2sk(academicYearId: string, termId: string, examId: string): string {
  return `exam-score#${academicYearId}#${termId}#${examId}`;
}

function examScoreEnrollmentGsi3pk(enrollmentId: string): string {
  return `enrollment#${enrollmentId}`;
}

function examScoreEnrollmentGsi3sk(examId: string): string {
  return `exam-score#${examId}`;
}

/**
 * Create a new ExamScore entity with proper keys.
 */
export function createExamScoreEntity(
  tenantId: string,
  examScoreId: string,
  examId: string,
  examCourseId: string,
  enrollmentId: string,
  schoolId: string,
  data: Omit<ExamScore, 'tenantId' | 'entityKey' | 'entityType' | 'examScoreId' | 'examId' | 'examCourseId' | 'enrollmentId' | 'schoolId' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk' | 'gsi3pk' | 'gsi3sk'>,
): ExamScore {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.examScore(examId, examScoreId),
    entityType: 'EXAM_SCORE',
    examScoreId,
    examId,
    examCourseId,
    enrollmentId,
    schoolId,
    gsi1pk: examScoreSchoolGsi1pk(tenantId, schoolId),
    gsi1sk: examScoreSchoolGsi1sk(examId, examCourseId, enrollmentId),
    gsi2pk: examScoreStudentGsi2pk(data.studentId),
    gsi2sk: examScoreStudentGsi2sk(data.academicYearId, data.termId, examId),
    gsi3pk: examScoreEnrollmentGsi3pk(enrollmentId),
    gsi3sk: examScoreEnrollmentGsi3sk(examId),
    ...data,
  };
}
