/**
 * ExternalExamRetake Mapper — Sprint D.3.5
 *
 * Strict entity → DTO mapper. `fee` is optional and serializes to null
 * when undefined.
 */

import type { ExternalExamRetakeEntity } from '../entities/external-exam-retake.entity';
import type { ExternalExamRetakeResponseDto } from '@aibrains/shared-types';

export function externalExamRetakeEntityToDto(
  entity: ExternalExamRetakeEntity,
): ExternalExamRetakeResponseDto {
  return {
    retakeId: entity.retakeId,
    originalResultId: entity.originalResultId,
    studentId: entity.studentId,
    enrollmentId: entity.enrollmentId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    examType: entity.examType,
    courses: entity.courses,
    retakeDate: entity.retakeDate,
    fee: entity.fee ?? null,
    status: entity.status,
    createdAt: entity.createdAt!,
    createdBy: entity.createdBy,
    updatedAt: entity.updatedAt!,
    updatedBy: entity.updatedBy,
  };
}
