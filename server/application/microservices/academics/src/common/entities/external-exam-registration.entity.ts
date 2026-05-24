/**
 * ExternalExamRegistration Entity — Sprint D.3.1
 *
 * Per-student registration row against an external authority (CEHRD
 * municipality for BLE; NEB for SEE/NEB-11/NEB-12). Lifecycle is the
 * 4-state machine in
 * `../external-exams/external-exam-registration.state-machine.ts`.
 *
 * Ed-Fi V6 alignment: `edforge:StudentExternalAssessmentRegistration`.
 *
 * Uniqueness: `(schoolId, studentId, examType, examYear)` is enforced
 * via the `ExternalExamRegistrationLock` entity (mirror of
 * `PROMOTION_RULE_LOCK` from D.2.1).
 *
 * Keys:
 *   - PK: tenantId
 *   - SK: EXT_EXAM_REG#{schoolId}#{registrationId}
 *
 * GSI1 (cohort query): `gsi1pk = tenant#{tid}#school#{schoolId}`,
 *   `gsi1sk = ext-exam-reg#{examType}#{examYear}#{registrationId}`
 *
 * GSI2 (cross-AY student view): `gsi2pk = tenant#{tid}#enrollment#{enrollmentId}`,
 *   `gsi2sk = ext-exam-reg#{examType}`
 *
 * GSI13 (sparse symbolNumber reverse-lookup — READ-SIDE ONLY):
 *   `gsi13pk = symbol#{symbolNumber}`, `gsi13sk = ext-exam-reg#{registrationId}`.
 *   POPULATED ONLY when `symbolNumber` is set (i.e. after `SYMBOL_ASSIGNED`
 *   transition). **GSI13 does NOT enforce uniqueness** — DDB GSIs do not
 *   reject duplicate partition keys, and `attribute_not_exists(gsi13pk)` in
 *   a single-item UpdateItem only protects the row being updated, not
 *   sibling rows. The GSI is purely the read-side reverse-lookup that
 *   D.4 ledger-import uses to match authority CSV rows back to
 *   registrations.
 *
 * Symbol-number uniqueness within `(examType, examYear)` is enforced via
 * a dedicated `ExternalExamSymbolLockEntity` (same pattern as
 * `ExternalExamRegistrationLockEntity` above + `PROMOTION_RULE_LOCK` from
 * D.2.1). D.4 writes the lock + the registration row in a single
 * `TransactWriteItems` with `attribute_not_exists(entityKey)` on the
 * lock. Collision → 409 `SYMBOL_NUMBER_CONFLICT`. Same approach as
 * GSI8 emisSchoolCode uniqueness (note: GSI8 also relies on a paired
 * lock-row pattern at the service layer, not GSI-level uniqueness).
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.1
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';
import type { ExamType, ExternalExamRegistrationStatus } from '@aibrains/shared-types';

export interface ExternalExamRegistrationEntity extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_REGISTRATION';
  registrationId: string;
  studentId: string;
  enrollmentId: string;
  schoolId: string;
  examType: ExamType;
  examYear: number;
  examAuthority: string;
  municipalityId?: string;
  symbolNumber?: string;
  examCenter?: string;
  courses: string[];
  registrationDate: string;
  status: ExternalExamRegistrationStatus;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  /** Sparse — populated only when `symbolNumber` is set. */
  gsi13pk?: string;
  /** Sparse — populated only when `symbolNumber` is set. */
  gsi13sk?: string;
}

export function externalExamRegSchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}
export function externalExamRegSchoolGsi1sk(
  examType: ExamType,
  examYear: number,
  registrationId: string,
): string {
  return `ext-exam-reg#${examType}#${examYear}#${registrationId}`;
}
export function externalExamRegEnrollmentGsi2pk(tenantId: string, enrollmentId: string): string {
  return `tenant#${tenantId}#enrollment#${enrollmentId}`;
}
export function externalExamRegEnrollmentGsi2sk(examType: ExamType): string {
  return `ext-exam-reg#${examType}`;
}
/**
 * GSI13 partition-key builder. **Read-side reverse-lookup ONLY** — does
 * not enforce uniqueness. Symbol-number uniqueness is enforced via the
 * `ExternalExamSymbolLockEntity` factory below.
 */
export function externalExamRegSymbolGsi13pk(symbolNumber: string): string {
  return `symbol#${symbolNumber}`;
}
export function externalExamRegSymbolGsi13sk(registrationId: string): string {
  return `ext-exam-reg#${registrationId}`;
}

export function createExternalExamRegistrationEntity(
  tenantId: string,
  registrationId: string,
  data: {
    studentId: string;
    enrollmentId: string;
    schoolId: string;
    examType: ExamType;
    examYear: number;
    examAuthority: string;
    municipalityId?: string;
    courses: string[];
    registrationDate: string;
    createdBy: string;
  },
): ExternalExamRegistrationEntity {
  const now = new Date().toISOString();
  const entity: ExternalExamRegistrationEntity = {
    tenantId,
    entityKey: EntityKeyBuilder.externalExamRegistration(data.schoolId, registrationId),
    entityType: 'EXTERNAL_EXAM_REGISTRATION',
    registrationId,
    studentId: data.studentId,
    enrollmentId: data.enrollmentId,
    schoolId: data.schoolId,
    examType: data.examType,
    examYear: data.examYear,
    examAuthority: data.examAuthority,
    municipalityId: data.municipalityId,
    courses: data.courses,
    registrationDate: data.registrationDate,
    status: 'DRAFT',
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: externalExamRegSchoolGsi1pk(tenantId, data.schoolId),
    gsi1sk: externalExamRegSchoolGsi1sk(data.examType, data.examYear, registrationId),
    gsi2pk: externalExamRegEnrollmentGsi2pk(tenantId, data.enrollmentId),
    gsi2sk: externalExamRegEnrollmentGsi2sk(data.examType),
  };
  // GSI13 sparse keys remain undefined at creation (DRAFT state, no
  // symbolNumber yet). D.4 fillSymbolNumber() handler populates them on
  // SYMBOL_ASSIGNED transition.
  return entity;
}

/**
 * Companion uniqueness-lock entity. D.4 writes the lock + the
 * registration in a single TransactWriteItems with
 * `attribute_not_exists(entityKey)` on the lock to enforce
 * `(schoolId, studentId, examType, examYear)` uniqueness.
 *
 * Ed-Fi V6 alignment: `edforge:ExternalAssessmentRegistrationLock`
 * (storage-engine primitive; no Ed-Fi analogue).
 */
export interface ExternalExamRegistrationLockEntity extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_REGISTRATION_LOCK';
  schoolId: string;
  studentId: string;
  examType: ExamType;
  examYear: number;
  /** FK to ExternalExamRegistration that claimed the lock. */
  registrationId: string;
}

export function createExternalExamRegistrationLockEntity(
  tenantId: string,
  data: {
    schoolId: string;
    studentId: string;
    examType: ExamType;
    examYear: number;
    registrationId: string;
    createdBy: string;
  },
): ExternalExamRegistrationLockEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.externalExamRegistrationLock(
      data.schoolId,
      data.studentId,
      data.examType,
      data.examYear,
    ),
    entityType: 'EXTERNAL_EXAM_REGISTRATION_LOCK',
    schoolId: data.schoolId,
    studentId: data.studentId,
    examType: data.examType,
    examYear: data.examYear,
    registrationId: data.registrationId,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
  };
}

/**
 * Symbol-number uniqueness lock. Deterministic by `(examType, examYear,
 * symbolNumber)` so two concurrent assignments of the same symbol race
 * exactly one winner via TransactWriteItems + `attribute_not_exists(entityKey)`
 * on the lock. The losing transaction returns 409 `SYMBOL_NUMBER_CONFLICT`.
 *
 * **Why a separate lock instead of `attribute_not_exists(gsi13pk)`:** DDB
 * does not enforce uniqueness across GSI partition keys. An UpdateItem's
 * `attribute_not_exists(gsi13pk)` only checks whether the SAME row already
 * has a gsi13pk value — it cannot reject a sibling row trying to set the
 * same value. A primary-key-based lock is the only deterministic way to
 * enforce cross-row uniqueness in DDB.
 *
 * Lock lifecycle:
 *   - Created at the same moment `symbolNumber` is set on the
 *     ExternalExamRegistration row (SYMBOL_ASSIGNED transition).
 *   - Carries the FK back to the registration that claimed it.
 *   - On CANCELLED transition, D.4 service-layer DELETEs the lock so
 *     the symbol becomes re-issuable. (Symbol re-issuance after a
 *     legitimate cancel is rare but allowed per authority practice.)
 *   - NEVER deleted on any other transition.
 *
 * Ed-Fi V6 alignment: `edforge:ExternalAssessmentSymbolNumberLock`
 * (storage-engine primitive; no Ed-Fi analogue).
 */
export interface ExternalExamSymbolLockEntity extends BaseEntity {
  entityType: 'EXTERNAL_EXAM_SYMBOL_LOCK';
  examType: ExamType;
  examYear: number;
  symbolNumber: string;
  /** FK to ExternalExamRegistration that claimed this symbol. */
  registrationId: string;
}

export function createExternalExamSymbolLockEntity(
  tenantId: string,
  data: {
    examType: ExamType;
    examYear: number;
    symbolNumber: string;
    registrationId: string;
    createdBy: string;
  },
): ExternalExamSymbolLockEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.externalExamSymbolLock(
      data.examType,
      data.examYear,
      data.symbolNumber,
    ),
    entityType: 'EXTERNAL_EXAM_SYMBOL_LOCK',
    examType: data.examType,
    examYear: data.examYear,
    symbolNumber: data.symbolNumber,
    registrationId: data.registrationId,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
  };
}
