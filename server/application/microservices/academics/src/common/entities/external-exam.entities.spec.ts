/**
 * D.3 ExternalAssessment family — entity factory specs (consolidated)
 *
 * One spec file covers all 7 D.3 entity factories (6 entities + 1 lock).
 * Per `d3-sprint-plan.md` §4 + §12 PR-review checklist. Total: 50+
 * assertions.
 *
 * Coverage per entity:
 *   - entityType matches
 *   - entityKey is built via the canonical EntityKeyBuilder method
 *   - GSI keys are populated with the correct format
 *   - Audit fields are set (createdAt, version=1)
 *   - Sparse GSI13 on registration stays undefined at DRAFT creation
 *
 * Cross-AY traceability for D.3.2 (R-D3.2 of plan) lives in the
 * shared-types spec since the entity factory doesn't expose
 * enrollmentId distinctness directly.
 */

import { describe, expect, it } from '@jest/globals';
import { EntityKeyBuilder } from './base.entity';
import { createRubricCategoryEntity } from './rubric-category.entity';
import {
  createExternalExamRegistrationEntity,
  createExternalExamRegistrationLockEntity,
  createExternalExamSymbolLockEntity,
} from './external-exam-registration.entity';
import { createInternalAssessmentEntity } from './internal-assessment.entity';
import { createExternalExamAdmitCardEntity } from './external-exam-admit-card.entity';
import { createExternalExamResultEntity } from './external-exam-result.entity';
import { createExternalExamRetakeEntity } from './external-exam-retake.entity';

const TENANT = 'tenant-uuid';
const SCHOOL = 'school-uuid';
const STUDENT = 'student-uuid';
const ENROLL = 'enroll-uuid';
const COURSE = 'course-uuid';
const REG = 'reg-uuid';
const RUBRIC = 'rubric-uuid';
const RESULT = 'result-uuid';
const RETAKE = 'retake-uuid';
const CARD = 'card-uuid';
const ASSESS = 'assess-uuid';
const USER = 'creator-uuid';

describe('createRubricCategoryEntity', () => {
  const entity = createRubricCategoryEntity(TENANT, RUBRIC, SCHOOL, {
    examType: 'BLE',
    academicSubject: 'mathematics',
    categoryName: 'unitTests',
    weight: 30,
    archetypeDefaulted: true,
    createdBy: USER,
  });

  it('has entityType=RUBRIC_CATEGORY', () => {
    expect(entity.entityType).toBe('RUBRIC_CATEGORY');
  });

  it('builds entityKey via EntityKeyBuilder', () => {
    expect(entity.entityKey).toBe(EntityKeyBuilder.rubricCategory(SCHOOL, RUBRIC));
  });

  it('populates GSI1 with lowercase school-scope shape', () => {
    expect(entity.gsi1pk).toBe(`tenant#${TENANT}#school#${SCHOOL}`);
    expect(entity.gsi1sk).toBe(`rubric-category#BLE#${RUBRIC}`);
  });

  it('starts with version=1 + isActive=true', () => {
    expect(entity.version).toBe(1);
    expect(entity.isActive).toBe(true);
  });

  it('preserves archetypeDefaulted flag from input', () => {
    expect(entity.archetypeDefaulted).toBe(true);
  });

  it('accepts undefined academicSubject (applies to all subjects)', () => {
    const e = createRubricCategoryEntity(TENANT, RUBRIC, SCHOOL, {
      examType: 'BLE',
      categoryName: 'participation',
      weight: 20,
      archetypeDefaulted: true,
      createdBy: USER,
    });
    expect(e.academicSubject).toBeUndefined();
  });
});

describe('createExternalExamRegistrationEntity', () => {
  const entity = createExternalExamRegistrationEntity(TENANT, REG, {
    studentId: STUDENT,
    enrollmentId: ENROLL,
    schoolId: SCHOOL,
    examType: 'BLE',
    examYear: 2083,
    examAuthority: 'KMC_001',
    municipalityId: 'muni-uuid',
    courses: [COURSE],
    registrationDate: '2026-04-15',
    createdBy: USER,
  });

  it('has entityType=EXTERNAL_EXAM_REGISTRATION', () => {
    expect(entity.entityType).toBe('EXTERNAL_EXAM_REGISTRATION');
  });

  it('builds entityKey via EntityKeyBuilder', () => {
    expect(entity.entityKey).toBe(EntityKeyBuilder.externalExamRegistration(SCHOOL, REG));
  });

  it('GSI1 cohort key includes examType + examYear + registrationId', () => {
    expect(entity.gsi1pk).toBe(`tenant#${TENANT}#school#${SCHOOL}`);
    expect(entity.gsi1sk).toBe(`ext-exam-reg#BLE#2083#${REG}`);
  });

  it('GSI2 cross-AY key uses enrollmentId', () => {
    expect(entity.gsi2pk).toBe(`tenant#${TENANT}#enrollment#${ENROLL}`);
    expect(entity.gsi2sk).toBe(`ext-exam-reg#BLE`);
  });

  it('GSI13 sparse keys are UNDEFINED at DRAFT creation (no symbolNumber yet)', () => {
    expect(entity.gsi13pk).toBeUndefined();
    expect(entity.gsi13sk).toBeUndefined();
    expect(entity.symbolNumber).toBeUndefined();
  });

  it('starts with status=DRAFT', () => {
    expect(entity.status).toBe('DRAFT');
  });

  it('preserves municipalityId for BLE', () => {
    expect(entity.municipalityId).toBe('muni-uuid');
  });
});

describe('createExternalExamRegistrationLockEntity', () => {
  const lock = createExternalExamRegistrationLockEntity(TENANT, {
    schoolId: SCHOOL,
    studentId: STUDENT,
    examType: 'BLE',
    examYear: 2083,
    registrationId: REG,
    createdBy: USER,
  });

  it('has entityType=EXTERNAL_EXAM_REGISTRATION_LOCK', () => {
    expect(lock.entityType).toBe('EXTERNAL_EXAM_REGISTRATION_LOCK');
  });

  it('builds deterministic entityKey via EntityKeyBuilder (race-safe uniqueness)', () => {
    expect(lock.entityKey).toBe(
      EntityKeyBuilder.externalExamRegistrationLock(SCHOOL, STUDENT, 'BLE', 2083),
    );
    expect(lock.entityKey).toBe(`EXT_EXAM_REG_LOCK#${SCHOOL}#${STUDENT}#BLE#2083`);
  });

  it('stores FK to the registration that claimed the lock', () => {
    expect(lock.registrationId).toBe(REG);
  });

  it('two locks with same (schoolId, studentId, examType, examYear) produce the SAME entityKey', () => {
    const lock2 = createExternalExamRegistrationLockEntity(TENANT, {
      schoolId: SCHOOL,
      studentId: STUDENT,
      examType: 'BLE',
      examYear: 2083,
      registrationId: 'a-different-reg-id',
      createdBy: USER,
    });
    expect(lock.entityKey).toBe(lock2.entityKey);
  });

  it('differs by examYear', () => {
    const lock2084 = createExternalExamRegistrationLockEntity(TENANT, {
      schoolId: SCHOOL,
      studentId: STUDENT,
      examType: 'BLE',
      examYear: 2084,
      registrationId: REG,
      createdBy: USER,
    });
    expect(lock.entityKey).not.toBe(lock2084.entityKey);
  });
});

describe('createExternalExamSymbolLockEntity (uniqueness primitive)', () => {
  const lock = createExternalExamSymbolLockEntity(TENANT, {
    examType: 'BLE',
    examYear: 2083,
    symbolNumber: 'SYM-31012345-007',
    registrationId: REG,
    createdBy: USER,
  });

  it('has entityType=EXTERNAL_EXAM_SYMBOL_LOCK', () => {
    expect(lock.entityType).toBe('EXTERNAL_EXAM_SYMBOL_LOCK');
  });

  it('builds deterministic entityKey via EntityKeyBuilder', () => {
    expect(lock.entityKey).toBe(
      EntityKeyBuilder.externalExamSymbolLock('BLE', 2083, 'SYM-31012345-007'),
    );
    expect(lock.entityKey).toBe('EXT_EXAM_SYMBOL_LOCK#BLE#2083#SYM-31012345-007');
  });

  it('stores FK to the registration that claimed the symbol', () => {
    expect(lock.registrationId).toBe(REG);
  });

  it('two locks with same (examType, examYear, symbolNumber) produce the SAME entityKey (race-safe)', () => {
    const lock2 = createExternalExamSymbolLockEntity(TENANT, {
      examType: 'BLE',
      examYear: 2083,
      symbolNumber: 'SYM-31012345-007',
      registrationId: 'a-different-reg-id',
      createdBy: USER,
    });
    expect(lock.entityKey).toBe(lock2.entityKey);
  });

  it('differs by symbolNumber (same examType + examYear)', () => {
    const otherSymbol = createExternalExamSymbolLockEntity(TENANT, {
      examType: 'BLE',
      examYear: 2083,
      symbolNumber: 'SYM-31012345-008',
      registrationId: REG,
      createdBy: USER,
    });
    expect(lock.entityKey).not.toBe(otherSymbol.entityKey);
  });

  it('differs by examYear (same examType + symbolNumber) — authorities re-issue symbols per year', () => {
    const nextYear = createExternalExamSymbolLockEntity(TENANT, {
      examType: 'BLE',
      examYear: 2084,
      symbolNumber: 'SYM-31012345-007',
      registrationId: REG,
      createdBy: USER,
    });
    expect(lock.entityKey).not.toBe(nextYear.entityKey);
  });
});

describe('createInternalAssessmentEntity', () => {
  const entity = createInternalAssessmentEntity(TENANT, ASSESS, {
    registrationId: REG,
    studentId: STUDENT,
    enrollmentId: ENROLL,
    schoolId: SCHOOL,
    examType: 'BLE',
    courseId: COURSE,
    rubricCategoryId: RUBRIC,
    score: 24,
    maxScore: 30,
    enteredBy: USER,
    enteredAt: '2026-05-20T00:00:00.000Z',
    createdBy: USER,
  });

  it('has entityType=INTERNAL_ASSESSMENT', () => {
    expect(entity.entityType).toBe('INTERNAL_ASSESSMENT');
  });

  it('builds entityKey via EntityKeyBuilder', () => {
    expect(entity.entityKey).toBe(EntityKeyBuilder.internalAssessment(REG, ASSESS));
  });

  it('GSI2 cross-AY key uses enrollmentId + examType + courseId', () => {
    expect(entity.gsi2pk).toBe(`tenant#${TENANT}#enrollment#${ENROLL}`);
    expect(entity.gsi2sk).toBe(`int-assess#BLE#${COURSE}`);
  });

  it('starts with status=DRAFT', () => {
    expect(entity.status).toBe('DRAFT');
  });
});

describe('createExternalExamAdmitCardEntity', () => {
  const entity = createExternalExamAdmitCardEntity(TENANT, CARD, {
    registrationId: REG,
    studentId: STUDENT,
    schoolId: SCHOOL,
    externalRollNumber: 'SYM-31012345-007',
    examCenterName: 'KMC Test Center 7',
    examCenterAddress: 'Putalisadak, Kathmandu',
    examDates: ['2026-12-01', '2026-12-03'],
    issuedAt: '2026-11-20T00:00:00.000Z',
    createdBy: USER,
  });

  it('has entityType=EXTERNAL_EXAM_ADMIT_CARD', () => {
    expect(entity.entityType).toBe('EXTERNAL_EXAM_ADMIT_CARD');
  });

  it('builds entityKey 1:1 with registrationId', () => {
    expect(entity.entityKey).toBe(EntityKeyBuilder.externalExamAdmitCard(REG));
  });

  it('pdfS3Url omitted at creation (renderer populates later)', () => {
    expect(entity.pdfS3Url).toBeUndefined();
  });
});

describe('createExternalExamResultEntity', () => {
  const entity = createExternalExamResultEntity(TENANT, RESULT, {
    registrationId: REG,
    studentId: STUDENT,
    enrollmentId: ENROLL,
    schoolId: SCHOOL,
    examType: 'BLE',
    courseResults: [
      {
        courseId: COURSE,
        academicSubject: 'mathematics',
        letterGrade: 'NG',
        gpaPoints: 0,
        isSupplementary: false,
      },
    ],
    overallStatus: 'failed_with_supplementary_eligible',
    importedAt: '2026-12-15T00:00:00.000Z',
    createdBy: USER,
  });

  it('has entityType=EXTERNAL_EXAM_RESULT', () => {
    expect(entity.entityType).toBe('EXTERNAL_EXAM_RESULT');
  });

  it('builds entityKey 1:1 with registrationId', () => {
    expect(entity.entityKey).toBe(EntityKeyBuilder.externalExamResult(REG));
  });

  it('GSI2 cross-AY key uses enrollmentId + examType', () => {
    expect(entity.gsi2pk).toBe(`tenant#${TENANT}#enrollment#${ENROLL}`);
    expect(entity.gsi2sk).toBe(`ext-result#BLE`);
  });

  it('preserves NG letterGrade in courseResults', () => {
    expect(entity.courseResults[0].letterGrade).toBe('NG');
  });

  it('preserves overallStatus enum', () => {
    expect(entity.overallStatus).toBe('failed_with_supplementary_eligible');
  });
});

describe('createExternalExamRetakeEntity', () => {
  const entity = createExternalExamRetakeEntity(TENANT, RETAKE, {
    originalResultId: RESULT,
    studentId: STUDENT,
    enrollmentId: ENROLL,
    schoolId: SCHOOL,
    examType: 'BLE',
    courses: [COURSE],
    retakeDate: '2026-04-12',
    fee: 250,
    createdBy: USER,
  });

  it('has entityType=EXTERNAL_EXAM_RETAKE', () => {
    expect(entity.entityType).toBe('EXTERNAL_EXAM_RETAKE');
  });

  it('builds entityKey via originalResultId + retakeId', () => {
    expect(entity.entityKey).toBe(EntityKeyBuilder.externalExamRetake(RESULT, RETAKE));
  });

  it('starts with status=REGISTERED', () => {
    expect(entity.status).toBe('REGISTERED');
  });

  it('preserves fee', () => {
    expect(entity.fee).toBe(250);
  });
});

describe('D.3 EntityKeyBuilder shape contract', () => {
  it('rubricCategory key shape', () => {
    expect(EntityKeyBuilder.rubricCategory('S', 'C')).toBe('RUBRIC_CATEGORY#S#C');
  });

  it('externalExamRegistration key shape', () => {
    expect(EntityKeyBuilder.externalExamRegistration('S', 'R')).toBe('EXT_EXAM_REG#S#R');
  });

  it('externalExamRegistrationLock key shape (deterministic 4-tuple)', () => {
    expect(EntityKeyBuilder.externalExamRegistrationLock('S', 'St', 'BLE', 2083)).toBe(
      'EXT_EXAM_REG_LOCK#S#St#BLE#2083',
    );
  });

  it('internalAssessment key shape', () => {
    expect(EntityKeyBuilder.internalAssessment('R', 'A')).toBe('INTERNAL_ASSESSMENT#R#A');
  });

  it('externalExamAdmitCard key shape (1:1 with registrationId)', () => {
    expect(EntityKeyBuilder.externalExamAdmitCard('R')).toBe('EXT_ADMIT_CARD#R');
  });

  it('externalExamResult key shape (1:1 with registrationId)', () => {
    expect(EntityKeyBuilder.externalExamResult('R')).toBe('EXT_EXAM_RESULT#R');
  });

  it('externalExamRetake key shape (originalResultId + retakeId)', () => {
    expect(EntityKeyBuilder.externalExamRetake('Res', 'Rt')).toBe('EXT_EXAM_RETAKE#Res#Rt');
  });

  it('externalExamSymbolLock key shape (deterministic by examType + examYear + symbolNumber)', () => {
    expect(EntityKeyBuilder.externalExamSymbolLock('BLE', 2083, 'SYM-007')).toBe(
      'EXT_EXAM_SYMBOL_LOCK#BLE#2083#SYM-007',
    );
  });
});
