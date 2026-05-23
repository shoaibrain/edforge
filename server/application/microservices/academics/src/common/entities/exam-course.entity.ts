/**
 * ExamCourse Entity — Sprint A.3.3
 *
 * Per-exam per-course join entity. One Exam may cover many Courses; each
 * Course gets its own maxMarks / passingMarks / weight.
 *
 * Key Structure (DynamoDB single-table; bare-UUID tenantId):
 *   - PK: tenantId
 *   - SK: EXAM_COURSE#{examId}#{examCourseId}
 *
 * GSI1 (school-scope): GSI1PK=tenant#{tid}#school#{schoolId}, GSI1SK=exam-course#{examId}#{courseCode}
 * GSI2 (exam-scope): GSI2PK=exam#{examId}, GSI2SK=course#{courseCode}
 *
 * **Denormalization:** `courseName`, `courseCode`, `academicSubject` are
 * copied from the referenced Course at write time so A.4 term-aggregation
 * doesn't need extra GetItems per row.
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.3
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';
import type { AcademicSubjectDescriptor } from '@aibrains/shared-types';

export interface ExamCourse extends BaseEntity {
  entityType: 'EXAM_COURSE';

  // Identity
  examCourseId: string;
  examId: string;
  schoolId: string;

  // FK to Course (A.2.1)
  courseId: string;

  // Denormalized at write (per master plan A.3.3 — avoids GetItem on aggregation)
  courseName?: string;
  courseCode?: string;
  academicSubject?: AcademicSubjectDescriptor;

  // Marks
  maxMarks: number;                   // 1-1000, positive integer
  passingMarks: number;               // 0-maxMarks, integer (default 32 / PABSON CDC)
  creditHours?: number;               // optional weighting for term-aggregation

  // GSI Keys (lowercase per S3.2)
  gsi1pk: string;  // 'tenant#{tid}#school#{schoolId}'
  gsi1sk: string;  // 'exam-course#{examId}#{courseCode|courseId}'
  gsi2pk: string;  // 'exam#{examId}'
  gsi2sk: string;  // 'course#{courseCode|courseId}'
}

function examCourseSchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}

function examCourseSchoolGsi1sk(examId: string, courseSort: string): string {
  return `exam-course#${examId}#${courseSort}`;
}

function examCourseExamGsi2pk(examId: string): string {
  return `exam#${examId}`;
}

function examCourseExamGsi2sk(courseSort: string): string {
  return `course#${courseSort}`;
}

/**
 * Create a new ExamCourse entity with proper keys.
 *
 * Uses `courseCode` for GSI sort if provided (operator-readable order);
 * falls back to `courseId` UUID for stable ordering otherwise.
 */
export function createExamCourseEntity(
  tenantId: string,
  examCourseId: string,
  examId: string,
  schoolId: string,
  data: Omit<ExamCourse, 'tenantId' | 'entityKey' | 'entityType' | 'examCourseId' | 'examId' | 'schoolId' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'>,
): ExamCourse {
  const courseSort = data.courseCode ?? data.courseId;
  return {
    tenantId,
    entityKey: EntityKeyBuilder.examCourse(examId, examCourseId),
    entityType: 'EXAM_COURSE',
    examCourseId,
    examId,
    schoolId,
    gsi1pk: examCourseSchoolGsi1pk(tenantId, schoolId),
    gsi1sk: examCourseSchoolGsi1sk(examId, courseSort),
    gsi2pk: examCourseExamGsi2pk(examId),
    gsi2sk: examCourseExamGsi2sk(courseSort),
    ...data,
  };
}
