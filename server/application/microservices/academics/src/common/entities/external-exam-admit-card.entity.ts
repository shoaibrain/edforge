/**
 * ExternalExamAdmitCard Entity — Sprint D.3.3
 *
 * Per-registration admit-card row (1:1 with ExternalExamRegistration).
 * `pdfS3Url` is populated by the C.4.3 renderer (invoked from D.4.5 /
 * D.5.3 / D.6.x; D.3 ships shape only).
 *
 * Ed-Fi V6 alignment: `edforge:ExternalAssessmentAdmitCard` (no Ed-Fi
 * analogue — Nepal-specific authority artifact).
 *
 * Keys:
 *   - PK: tenantId
 *   - SK: EXT_ADMIT_CARD#{registrationId}
 *
 * GSI1: `gsi1pk = tenant#{tid}#school#{schoolId}`,
 *   `gsi1sk = admit-card#{registrationId}`
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.3
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';

export interface ExternalExamAdmitCardEntity extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_ADMIT_CARD';
  admitCardId: string;
  registrationId: string;
  studentId: string;
  schoolId: string;
  externalRollNumber: string;
  examCenterName: string;
  examCenterAddress: string;
  examDates: string[];
  pdfS3Url?: string;
  issuedAt: string;
  gsi1pk: string;
  gsi1sk: string;
}

export function admitCardSchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}
export function admitCardSchoolGsi1sk(registrationId: string): string {
  return `admit-card#${registrationId}`;
}

export function createExternalExamAdmitCardEntity(
  tenantId: string,
  admitCardId: string,
  data: {
    registrationId: string;
    studentId: string;
    schoolId: string;
    externalRollNumber: string;
    examCenterName: string;
    examCenterAddress: string;
    examDates: string[];
    pdfS3Url?: string;
    issuedAt: string;
    createdBy: string;
  },
): ExternalExamAdmitCardEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.externalExamAdmitCard(data.registrationId),
    entityType: 'EXTERNAL_EXAM_ADMIT_CARD',
    admitCardId,
    registrationId: data.registrationId,
    studentId: data.studentId,
    schoolId: data.schoolId,
    externalRollNumber: data.externalRollNumber,
    examCenterName: data.examCenterName,
    examCenterAddress: data.examCenterAddress,
    examDates: data.examDates,
    pdfS3Url: data.pdfS3Url,
    issuedAt: data.issuedAt,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: admitCardSchoolGsi1pk(tenantId, data.schoolId),
    gsi1sk: admitCardSchoolGsi1sk(data.registrationId),
  };
}
