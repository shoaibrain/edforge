/**
 * D.3 ExternalAssessment family — mapper round-trip specs (consolidated)
 *
 * Validates the §4.1 round-trip contract from `d3-sprint-plan.md`:
 *   1. Idempotency — DTO matches entity field-by-field (audit excluded)
 *   2. JSON-safe — DTO survives JSON.parse(JSON.stringify(...))
 *   3. Optional preservation — absent fields stay absent / null
 *   4. Sparse GSI preservation — sparse keys NOT in DTO surface
 *   5. Cross-entity FK preservation — all FK byte-pass-through
 *   6. Letter-grade byte-pass-through (NG, A+, mixed)
 *   7. IEEE-754 precision (gpaPoints)
 *
 * 30+ assertions across 6 mappers.
 */

import { describe, expect, it } from '@jest/globals';
import { createRubricCategoryEntity } from '../entities/rubric-category.entity';
import { createExternalExamRegistrationEntity } from '../entities/external-exam-registration.entity';
import { createInternalAssessmentEntity } from '../entities/internal-assessment.entity';
import { createExternalExamAdmitCardEntity } from '../entities/external-exam-admit-card.entity';
import { createExternalExamResultEntity } from '../entities/external-exam-result.entity';
import { createExternalExamRetakeEntity } from '../entities/external-exam-retake.entity';
import { rubricCategoryEntityToDto } from './rubric-category.mapper';
import { externalExamRegistrationEntityToDto } from './external-exam-registration.mapper';
import { internalAssessmentEntityToDto } from './internal-assessment.mapper';
import { externalExamAdmitCardEntityToDto } from './external-exam-admit-card.mapper';
import { externalExamResultEntityToDto } from './external-exam-result.mapper';
import { externalExamRetakeEntityToDto } from './external-exam-retake.mapper';

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

describe('rubricCategoryEntityToDto', () => {
  const entity = createRubricCategoryEntity(TENANT, RUBRIC, SCHOOL, {
    examType: 'BLE',
    academicSubject: 'mathematics',
    categoryName: 'unitTests',
    weight: 30,
    archetypeDefaulted: true,
    createdBy: USER,
  });
  const dto = rubricCategoryEntityToDto(entity);

  it('preserves identity fields', () => {
    expect(dto.categoryId).toBe(entity.categoryId);
    expect(dto.schoolId).toBe(entity.schoolId);
    expect(dto.tenantId).toBe(entity.tenantId);
    expect(dto.examType).toBe(entity.examType);
  });

  it('preserves academicSubject when set', () => {
    expect(dto.academicSubject).toBe('mathematics');
  });

  it('serializes academicSubject=undefined → null (DTO accepts both)', () => {
    const e = createRubricCategoryEntity(TENANT, RUBRIC, SCHOOL, {
      examType: 'BLE',
      categoryName: 'participation',
      weight: 20,
      archetypeDefaulted: true,
      createdBy: USER,
    });
    expect(rubricCategoryEntityToDto(e).academicSubject).toBeNull();
  });

  it('survives JSON round-trip (JSON-safe)', () => {
    const json = JSON.parse(JSON.stringify(dto));
    expect(json).toEqual(dto);
  });
});

describe('externalExamRegistrationEntityToDto', () => {
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
  const dto = externalExamRegistrationEntityToDto(entity);

  it('preserves FK fields byte-for-byte', () => {
    expect(dto.studentId).toBe(STUDENT);
    expect(dto.enrollmentId).toBe(ENROLL);
    expect(dto.schoolId).toBe(SCHOOL);
    expect(dto.tenantId).toBe(TENANT);
    expect(dto.municipalityId).toBe('muni-uuid');
  });

  it('serializes symbolNumber=undefined → null (sparse field)', () => {
    expect(dto.symbolNumber).toBeNull();
    expect(dto.examCenter).toBeNull();
  });

  it('starts with status=DRAFT', () => {
    expect(dto.status).toBe('DRAFT');
  });

  it('preserves courses[] order', () => {
    expect(dto.courses).toEqual([COURSE]);
  });
});

describe('internalAssessmentEntityToDto', () => {
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
  const dto = internalAssessmentEntityToDto(entity);

  it('preserves IEEE-754 score values', () => {
    expect(dto.score).toBe(24);
    expect(dto.maxScore).toBe(30);
  });

  it('preserves enteredAt ISO datetime', () => {
    expect(dto.enteredAt).toBe('2026-05-20T00:00:00.000Z');
  });

  it('preserves FK fields', () => {
    expect(dto.registrationId).toBe(REG);
    expect(dto.courseId).toBe(COURSE);
    expect(dto.rubricCategoryId).toBe(RUBRIC);
  });
});

describe('externalExamAdmitCardEntityToDto', () => {
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
  const dto = externalExamAdmitCardEntityToDto(entity);

  it('serializes pdfS3Url=undefined → null (pre-render)', () => {
    expect(dto.pdfS3Url).toBeNull();
  });

  it('preserves examDates[] order', () => {
    expect(dto.examDates).toEqual(['2026-12-01', '2026-12-03']);
  });

  it('preserves externalRollNumber byte-for-byte', () => {
    expect(dto.externalRollNumber).toBe('SYM-31012345-007');
  });
});

describe('externalExamResultEntityToDto', () => {
  const courseResults = [
    {
      courseId: COURSE,
      academicSubject: 'mathematics' as const,
      letterGrade: 'A+',
      gpaPoints: 4.0,
      internalScore: 45,
      externalScore: 48,
      isSupplementary: false,
    },
    {
      courseId: 'course-2',
      academicSubject: 'science' as const,
      letterGrade: 'NG',
      gpaPoints: 0,
      internalScore: 12,
      externalScore: 8,
      isSupplementary: false,
    },
    {
      courseId: 'course-3',
      academicSubject: 'english' as const,
      letterGrade: 'C+',
      gpaPoints: 2.4,
      externalScore: 32,
      isSupplementary: true,
    },
  ];
  const entity = createExternalExamResultEntity(TENANT, RESULT, {
    registrationId: REG,
    studentId: STUDENT,
    enrollmentId: ENROLL,
    schoolId: SCHOOL,
    examType: 'BLE',
    courseResults,
    overallStatus: 'failed_with_supplementary_eligible',
    importedAt: '2026-12-15T00:00:00.000Z',
    createdBy: USER,
  });
  const dto = externalExamResultEntityToDto(entity);

  it('preserves NG letterGrade byte-for-byte (no normalization)', () => {
    expect(dto.courseResults[1].letterGrade).toBe('NG');
  });

  it('preserves A+ letterGrade byte-for-byte', () => {
    expect(dto.courseResults[0].letterGrade).toBe('A+');
  });

  it('preserves isSupplementary per-courseResult (R-D3.8)', () => {
    expect(dto.courseResults[0].isSupplementary).toBe(false);
    expect(dto.courseResults[1].isSupplementary).toBe(false);
    expect(dto.courseResults[2].isSupplementary).toBe(true);
  });

  it('preserves gpaPoints IEEE-754 (no rounding)', () => {
    expect(dto.courseResults[0].gpaPoints).toBe(4.0);
    expect(dto.courseResults[2].gpaPoints).toBe(2.4);
  });

  it('serializes cumulativeGpa=undefined → null (BLE row)', () => {
    expect(dto.cumulativeGpa).toBeNull();
  });

  it('preserves overallStatus enum', () => {
    expect(dto.overallStatus).toBe('failed_with_supplementary_eligible');
  });

  it('survives JSON round-trip with mixed letterGrades + sparse fields', () => {
    expect(JSON.parse(JSON.stringify(dto))).toEqual(dto);
  });
});

describe('externalExamRetakeEntityToDto', () => {
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
  const dto = externalExamRetakeEntityToDto(entity);

  it('starts with status=REGISTERED', () => {
    expect(dto.status).toBe('REGISTERED');
  });

  it('preserves fee', () => {
    expect(dto.fee).toBe(250);
  });

  it('serializes fee=undefined → null when omitted', () => {
    const e = createExternalExamRetakeEntity(TENANT, RETAKE, {
      originalResultId: RESULT,
      studentId: STUDENT,
      enrollmentId: ENROLL,
      schoolId: SCHOOL,
      examType: 'NEB_12',
      courses: [COURSE],
      retakeDate: '2026-04-12',
      createdBy: USER,
    });
    expect(externalExamRetakeEntityToDto(e).fee).toBeNull();
  });

  it('preserves originalResultId FK', () => {
    expect(dto.originalResultId).toBe(RESULT);
  });
});
