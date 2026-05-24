/**
 * InternalAssessment Entity — Sprint D.3.2
 *
 * Per-(student × course × rubricCategory) score row capturing the
 * internal-50% portion of an external exam. Aggregation engine
 * (D.4.6 / D.5.x / D.6.x) reads these to compute the internal-score
 * portion at result-import time.
 *
 * Ed-Fi V6 alignment: `edforge:InternalAssessmentScore`.
 *
 * Keys:
 *   - PK: tenantId
 *   - SK: INTERNAL_ASSESSMENT#{registrationId}#{assessmentId}
 *
 * GSI1: `gsi1pk = tenant#{tid}#school#{schoolId}`,
 *   `gsi1sk = int-assess#{registrationId}#{assessmentId}`
 *
 * GSI2 (cross-AY): `gsi2pk = tenant#{tid}#enrollment#{enrollmentId}`,
 *   `gsi2sk = int-assess#{examType}#{courseId}`
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.2
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';
import type { ExamType, InternalAssessmentStatus } from '@aibrains/shared-types';

export interface InternalAssessmentEntity extends BaseEntity {
  entityType: 'INTERNAL_ASSESSMENT';
  assessmentId: string;
  registrationId: string;
  studentId: string;
  enrollmentId: string;
  schoolId: string;
  examType: ExamType;
  courseId: string;
  rubricCategoryId: string;
  score: number;
  maxScore: number;
  status: InternalAssessmentStatus;
  enteredBy: string;
  enteredAt: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

export function internalAssessmentSchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}
export function internalAssessmentSchoolGsi1sk(registrationId: string, assessmentId: string): string {
  return `int-assess#${registrationId}#${assessmentId}`;
}
export function internalAssessmentEnrollmentGsi2pk(tenantId: string, enrollmentId: string): string {
  return `tenant#${tenantId}#enrollment#${enrollmentId}`;
}
export function internalAssessmentEnrollmentGsi2sk(examType: ExamType, courseId: string): string {
  return `int-assess#${examType}#${courseId}`;
}

export function createInternalAssessmentEntity(
  tenantId: string,
  assessmentId: string,
  data: {
    registrationId: string;
    studentId: string;
    enrollmentId: string;
    schoolId: string;
    examType: ExamType;
    courseId: string;
    rubricCategoryId: string;
    score: number;
    maxScore: number;
    enteredBy: string;
    enteredAt: string;
    createdBy: string;
  },
): InternalAssessmentEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.internalAssessment(data.registrationId, assessmentId),
    entityType: 'INTERNAL_ASSESSMENT',
    assessmentId,
    registrationId: data.registrationId,
    studentId: data.studentId,
    enrollmentId: data.enrollmentId,
    schoolId: data.schoolId,
    examType: data.examType,
    courseId: data.courseId,
    rubricCategoryId: data.rubricCategoryId,
    score: data.score,
    maxScore: data.maxScore,
    status: 'DRAFT',
    enteredBy: data.enteredBy,
    enteredAt: data.enteredAt,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: internalAssessmentSchoolGsi1pk(tenantId, data.schoolId),
    gsi1sk: internalAssessmentSchoolGsi1sk(data.registrationId, assessmentId),
    gsi2pk: internalAssessmentEnrollmentGsi2pk(tenantId, data.enrollmentId),
    gsi2sk: internalAssessmentEnrollmentGsi2sk(data.examType, data.courseId),
  };
}
