/**
 * ExternalExamResult Entity — Sprint D.3.4
 *
 * One row per (registrationId) carrying per-course breakdown of an
 * external-exam outcome. `overallStatus` is denormalized at write
 * (D.4.6 / D.5.x / D.6.x) — not computed at read time.
 *
 * Ed-Fi V6 alignment: `edforge:StudentExternalAssessment` (analogous to
 * `StudentAssessment` + `StudentAssessmentScoreResult[]`).
 *
 * Keys:
 *   - PK: tenantId
 *   - SK: EXT_EXAM_RESULT#{registrationId}
 *
 * GSI1: `gsi1pk = tenant#{tid}#school#{schoolId}`,
 *   `gsi1sk = ext-result#{examType}#{resultId}`
 *
 * GSI2 (cross-AY): `gsi2pk = tenant#{tid}#enrollment#{enrollmentId}`,
 *   `gsi2sk = ext-result#{examType}`
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.4
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';
import type {
  AcademicSubjectDescriptor,
  ExamType,
  ExternalExamOverallStatus,
} from '@aibrains/shared-types';

export interface ExternalExamCourseResult {
  courseId: string;
  academicSubject: AcademicSubjectDescriptor;
  letterGrade: string;
  gpaPoints: number;
  internalScore?: number;
  externalScore?: number;
  isSupplementary: boolean;
}

export interface ExternalExamResultEntity extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_RESULT';
  resultId: string;
  registrationId: string;
  studentId: string;
  enrollmentId: string;
  schoolId: string;
  examType: ExamType;
  courseResults: ExternalExamCourseResult[];
  cumulativeGpa?: number;
  overallStatus: ExternalExamOverallStatus;
  importedAt: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

export function externalExamResultSchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}
export function externalExamResultSchoolGsi1sk(examType: ExamType, resultId: string): string {
  return `ext-result#${examType}#${resultId}`;
}
export function externalExamResultEnrollmentGsi2pk(tenantId: string, enrollmentId: string): string {
  return `tenant#${tenantId}#enrollment#${enrollmentId}`;
}
export function externalExamResultEnrollmentGsi2sk(examType: ExamType): string {
  return `ext-result#${examType}`;
}

export function createExternalExamResultEntity(
  tenantId: string,
  resultId: string,
  data: {
    registrationId: string;
    studentId: string;
    enrollmentId: string;
    schoolId: string;
    examType: ExamType;
    courseResults: ExternalExamCourseResult[];
    cumulativeGpa?: number;
    overallStatus: ExternalExamOverallStatus;
    importedAt: string;
    createdBy: string;
  },
): ExternalExamResultEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.externalExamResult(data.registrationId),
    entityType: 'EXTERNAL_EXAM_RESULT',
    resultId,
    registrationId: data.registrationId,
    studentId: data.studentId,
    enrollmentId: data.enrollmentId,
    schoolId: data.schoolId,
    examType: data.examType,
    courseResults: data.courseResults,
    cumulativeGpa: data.cumulativeGpa,
    overallStatus: data.overallStatus,
    importedAt: data.importedAt,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: externalExamResultSchoolGsi1pk(tenantId, data.schoolId),
    gsi1sk: externalExamResultSchoolGsi1sk(data.examType, resultId),
    gsi2pk: externalExamResultEnrollmentGsi2pk(tenantId, data.enrollmentId),
    gsi2sk: externalExamResultEnrollmentGsi2sk(data.examType),
  };
}
