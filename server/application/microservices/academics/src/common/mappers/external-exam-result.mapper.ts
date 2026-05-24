/**
 * ExternalExamResult Mapper — Sprint D.3.4
 *
 * Strict entity → DTO mapper. `courseResults[]` is pass-through (letter-
 * grade byte-pass-through per §4.1 mapper contract; no normalization).
 * `cumulativeGpa` is NEB-only and serializes to null when undefined.
 */

import type { ExternalExamResultEntity } from '../entities/external-exam-result.entity';
import type { ExternalExamResultResponseDto } from '@aibrains/shared-types';

export function externalExamResultEntityToDto(
  entity: ExternalExamResultEntity,
): ExternalExamResultResponseDto {
  return {
    resultId: entity.resultId,
    registrationId: entity.registrationId,
    studentId: entity.studentId,
    enrollmentId: entity.enrollmentId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    examType: entity.examType,
    courseResults: entity.courseResults,
    cumulativeGpa: entity.cumulativeGpa ?? null,
    overallStatus: entity.overallStatus,
    importedAt: entity.importedAt,
    createdAt: entity.createdAt!,
    createdBy: entity.createdBy,
    updatedAt: entity.updatedAt!,
    updatedBy: entity.updatedBy,
  };
}
