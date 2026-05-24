/**
 * ExternalExamAdmitCard Mapper — Sprint D.3.3
 *
 * Strict entity → DTO mapper. `pdfS3Url` is sparse (renderer-populated)
 * so serializes to null when absent.
 */

import type { ExternalExamAdmitCardEntity } from '../entities/external-exam-admit-card.entity';
import type { ExternalExamAdmitCardResponseDto } from '@aibrains/shared-types';

export function externalExamAdmitCardEntityToDto(
  entity: ExternalExamAdmitCardEntity,
): ExternalExamAdmitCardResponseDto {
  return {
    admitCardId: entity.admitCardId,
    registrationId: entity.registrationId,
    studentId: entity.studentId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    externalRollNumber: entity.externalRollNumber,
    examCenterName: entity.examCenterName,
    examCenterAddress: entity.examCenterAddress,
    examDates: entity.examDates,
    pdfS3Url: entity.pdfS3Url ?? null,
    issuedAt: entity.issuedAt,
    createdAt: entity.createdAt!,
    createdBy: entity.createdBy,
    updatedAt: entity.updatedAt!,
    updatedBy: entity.updatedBy,
  };
}
