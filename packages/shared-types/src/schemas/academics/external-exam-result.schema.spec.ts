/**
 * ExternalExamResult schema spec — Sprint D.3.4
 *
 * Per `d3-sprint-plan.md` §4 D.3.4 — includes:
 *   - explicit `'NG'` letter-grade case (R-D3.9 mitigation)
 *   - mixed pass/fail/NG case
 *   - per-courseResult `isSupplementary` round-trip (R-D3.8)
 *   - `courseResults[]` bounds (≥1, ≤15)
 *
 * Total: 21 assertions (≥10 per §1.4).
 */

import { describe, expect, it } from '@jest/globals';
import {
  createExternalExamResultSchema,
  updateExternalExamResultSchema,
  externalExamResultResponseSchema,
  externalExamCourseResultSchema,
  EXTERNAL_EXAM_OVERALL_STATUSES,
} from './external-exam-result.schema';

const REG = '11111111-1111-1111-1111-111111111111';
const STU = '22222222-2222-2222-2222-222222222222';
const ENR = '33333333-3333-3333-3333-333333333333';
const SCH = '44444444-4444-4444-4444-444444444444';
const COURSE_A = '55555555-5555-5555-5555-555555555555';
const COURSE_B = '66666666-6666-6666-6666-666666666666';
const COURSE_C = '77777777-7777-7777-7777-777777777777';
const TEN = '88888888-8888-8888-8888-888888888888';
const RES = '99999999-9999-9999-9999-999999999999';

const passingCourse = {
  courseId: COURSE_A,
  academicSubject: 'mathematics' as const,
  letterGrade: 'A+',
  gpaPoints: 4.0,
  internalScore: 45,
  externalScore: 48,
  isSupplementary: false,
};

const failingNgCourse = {
  courseId: COURSE_B,
  academicSubject: 'science' as const,
  letterGrade: 'NG',
  gpaPoints: 0,
  internalScore: 12,
  externalScore: 8,
  isSupplementary: false,
};

const supplementaryPassCourse = {
  courseId: COURSE_C,
  academicSubject: 'english' as const,
  letterGrade: 'C+',
  gpaPoints: 2.4,
  externalScore: 32,
  isSupplementary: true,
};

describe('externalExamCourseResultSchema', () => {
  it('accepts A+ letterGrade', () => {
    expect(externalExamCourseResultSchema.parse(passingCourse)).toMatchObject(passingCourse);
  });

  it('accepts NG letterGrade (D.4.0 + D.5.0 requirement)', () => {
    expect(externalExamCourseResultSchema.parse(failingNgCourse)).toMatchObject(failingNgCourse);
  });

  it('accepts isSupplementary=true', () => {
    const parsed = externalExamCourseResultSchema.parse(supplementaryPassCourse);
    expect(parsed.isSupplementary).toBe(true);
  });

  it('defaults isSupplementary to false when omitted', () => {
    const { isSupplementary: _drop, ...withoutFlag } = passingCourse;
    const parsed = externalExamCourseResultSchema.parse(withoutFlag);
    expect(parsed.isSupplementary).toBe(false);
  });

  it("rejects letterGrade=''", () => {
    expect(() =>
      externalExamCourseResultSchema.parse({ ...passingCourse, letterGrade: '' }),
    ).toThrow();
  });

  it('rejects letterGrade > 5 chars', () => {
    expect(() =>
      externalExamCourseResultSchema.parse({ ...passingCourse, letterGrade: 'A-PLUS' }),
    ).toThrow();
  });

  it('rejects gpaPoints > 5', () => {
    expect(() =>
      externalExamCourseResultSchema.parse({ ...passingCourse, gpaPoints: 5.1 }),
    ).toThrow();
  });

  it('rejects negative gpaPoints', () => {
    expect(() =>
      externalExamCourseResultSchema.parse({ ...passingCourse, gpaPoints: -0.1 }),
    ).toThrow();
  });

  it('rejects academicSubject as raw string', () => {
    expect(() =>
      externalExamCourseResultSchema.parse({ ...passingCourse, academicSubject: 'math' }),
    ).toThrow();
  });
});

describe('createExternalExamResultSchema', () => {
  const valid = {
    registrationId: REG,
    studentId: STU,
    enrollmentId: ENR,
    schoolId: SCH,
    examType: 'BLE' as const,
    courseResults: [passingCourse, failingNgCourse, supplementaryPassCourse],
    overallStatus: 'failed_with_supplementary_eligible' as const,
    importedAt: '2026-12-15T00:00:00.000Z',
  };

  it('accepts mixed pass / NG / supplementary courseResults', () => {
    const parsed = createExternalExamResultSchema.parse(valid);
    expect(parsed.courseResults).toHaveLength(3);
    expect(parsed.courseResults[1].letterGrade).toBe('NG');
    expect(parsed.courseResults[2].isSupplementary).toBe(true);
  });

  it('accepts cumulativeGpa for NEB-12', () => {
    expect(
      createExternalExamResultSchema.parse({ ...valid, examType: 'NEB_12', cumulativeGpa: 3.4 }),
    ).toBeTruthy();
  });

  it('rejects empty courseResults[]', () => {
    expect(() =>
      createExternalExamResultSchema.parse({ ...valid, courseResults: [] }),
    ).toThrow();
  });

  it('rejects courseResults[] > 15', () => {
    const tooMany = Array.from({ length: 16 }, () => passingCourse);
    expect(() =>
      createExternalExamResultSchema.parse({ ...valid, courseResults: tooMany }),
    ).toThrow();
  });

  it('accepts overallStatus="passed"', () => {
    expect(
      createExternalExamResultSchema.parse({
        ...valid,
        courseResults: [passingCourse],
        overallStatus: 'passed',
      }),
    ).toBeTruthy();
  });

  it('rejects overallStatus outside the 3-enum', () => {
    expect(() =>
      createExternalExamResultSchema.parse({
        ...valid,
        overallStatus: 'pending',
      }),
    ).toThrow();
  });
});

describe('updateExternalExamResultSchema', () => {
  it('accepts a status re-derivation update', () => {
    expect(updateExternalExamResultSchema.parse({ overallStatus: 'passed' })).toBeTruthy();
  });

  it('accepts a supplementary courseResults[] overwrite', () => {
    expect(
      updateExternalExamResultSchema.parse({
        courseResults: [{ ...failingNgCourse, letterGrade: 'B', gpaPoints: 2.8, isSupplementary: true }],
      }),
    ).toBeTruthy();
  });
});

describe('externalExamResultResponseSchema', () => {
  const baseResponse = {
    resultId: RES,
    registrationId: REG,
    studentId: STU,
    enrollmentId: ENR,
    schoolId: SCH,
    tenantId: TEN,
    examType: 'BLE' as const,
    courseResults: [passingCourse, failingNgCourse],
    overallStatus: 'failed_with_supplementary_eligible' as const,
    importedAt: '2026-12-15T00:00:00.000Z',
    createdAt: '2026-12-15T00:00:00.000Z',
    createdBy: 'u1',
    updatedAt: '2026-12-15T00:00:00.000Z',
    updatedBy: 'u1',
  };

  it('round-trips a 2-course result', () => {
    expect(externalExamResultResponseSchema.parse(baseResponse)).toBeTruthy();
  });

  it('round-trips cumulativeGpa null (BLE serialized form)', () => {
    expect(
      externalExamResultResponseSchema.parse({ ...baseResponse, cumulativeGpa: null }),
    ).toBeTruthy();
  });

  it('EXTERNAL_EXAM_OVERALL_STATUSES exports the 3 values', () => {
    expect(EXTERNAL_EXAM_OVERALL_STATUSES).toEqual([
      'passed',
      'failed',
      'failed_with_supplementary_eligible',
    ]);
  });
});
