/**
 * ExternalExamRetake Entity — Sprint D.3.5
 *
 * Grade-Increment retake row. BLE supplementary (D.4.7) + NEB Grade-12
 * (D.6.5) both write to this entity. Eligibility rule (BLE: NG ≤3
 * subjects per D.4.0 §7.2) is service-layer; entity accepts any number
 * of courses.
 *
 * Ed-Fi V6 alignment: `edforge:ExternalAssessmentRetake` (no clean
 * Ed-Fi analogue).
 *
 * Keys:
 *   - PK: tenantId
 *   - SK: EXT_EXAM_RETAKE#{originalResultId}#{retakeId}
 *
 * GSI1: `gsi1pk = tenant#{tid}#school#{schoolId}`,
 *   `gsi1sk = ext-retake#{retakeId}`
 *
 * GSI2 (cross-AY): `gsi2pk = tenant#{tid}#enrollment#{enrollmentId}`,
 *   `gsi2sk = ext-retake#{examType}`
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.5
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';
import type { ExamType, ExternalExamRetakeStatus } from '@aibrains/shared-types';

export interface ExternalExamRetakeEntity extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_RETAKE';
  retakeId: string;
  originalResultId: string;
  studentId: string;
  enrollmentId: string;
  schoolId: string;
  examType: ExamType;
  courses: string[];
  retakeDate: string;
  fee?: number;
  status: ExternalExamRetakeStatus;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

export function retakeSchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}
export function retakeSchoolGsi1sk(retakeId: string): string {
  return `ext-retake#${retakeId}`;
}
export function retakeEnrollmentGsi2pk(tenantId: string, enrollmentId: string): string {
  return `tenant#${tenantId}#enrollment#${enrollmentId}`;
}
export function retakeEnrollmentGsi2sk(examType: ExamType): string {
  return `ext-retake#${examType}`;
}

export function createExternalExamRetakeEntity(
  tenantId: string,
  retakeId: string,
  data: {
    originalResultId: string;
    studentId: string;
    enrollmentId: string;
    schoolId: string;
    examType: ExamType;
    courses: string[];
    retakeDate: string;
    fee?: number;
    createdBy: string;
  },
): ExternalExamRetakeEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.externalExamRetake(data.originalResultId, retakeId),
    entityType: 'EXTERNAL_EXAM_RETAKE',
    retakeId,
    originalResultId: data.originalResultId,
    studentId: data.studentId,
    enrollmentId: data.enrollmentId,
    schoolId: data.schoolId,
    examType: data.examType,
    courses: data.courses,
    retakeDate: data.retakeDate,
    fee: data.fee,
    status: 'REGISTERED',
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: retakeSchoolGsi1pk(tenantId, data.schoolId),
    gsi1sk: retakeSchoolGsi1sk(retakeId),
    gsi2pk: retakeEnrollmentGsi2pk(tenantId, data.enrollmentId),
    gsi2sk: retakeEnrollmentGsi2sk(data.examType),
  };
}
