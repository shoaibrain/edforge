/**
 * ExternalExamRegistration Mapper — Sprint D.3.1
 *
 * Strict entity → DTO mapper. Optional sparse fields (`symbolNumber`,
 * `examCenter`, `municipalityId`) serialize to `null` in the DTO so the
 * `.nullable().optional()` schema accepts them post-DDB-roundtrip.
 */

import type { ExternalExamRegistrationEntity } from '../entities/external-exam-registration.entity';
import type { ExternalExamRegistrationResponseDto } from '@aibrains/shared-types';

export function externalExamRegistrationEntityToDto(
  entity: ExternalExamRegistrationEntity,
): ExternalExamRegistrationResponseDto {
  return {
    registrationId: entity.registrationId,
    studentId: entity.studentId,
    enrollmentId: entity.enrollmentId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    examType: entity.examType,
    examYear: entity.examYear,
    examAuthority: entity.examAuthority,
    municipalityId: entity.municipalityId ?? null,
    symbolNumber: entity.symbolNumber ?? null,
    examCenter: entity.examCenter ?? null,
    courses: entity.courses,
    registrationDate: entity.registrationDate,
    status: entity.status,
    createdAt: entity.createdAt!,
    createdBy: entity.createdBy,
    updatedAt: entity.updatedAt!,
    updatedBy: entity.updatedBy,
  };
}
