/**
 * ExternalExamRetake schema spec — Sprint D.3.5
 *
 * Per `d3-sprint-plan.md` §4 D.3.5. Total: 13 assertions.
 */

import { describe, expect, it } from '@jest/globals';
import {
  createExternalExamRetakeSchema,
  updateExternalExamRetakeSchema,
  externalExamRetakeResponseSchema,
  EXTERNAL_EXAM_RETAKE_STATUSES,
} from './external-exam-retake.schema';

const ORIG_RESULT = '11111111-1111-1111-1111-111111111111';
const STU = '22222222-2222-2222-2222-222222222222';
const ENR = '33333333-3333-3333-3333-333333333333';
const SCH = '44444444-4444-4444-4444-444444444444';
const COURSE_A = '55555555-5555-5555-5555-555555555555';
const COURSE_B = '66666666-6666-6666-6666-666666666666';
const TEN = '77777777-7777-7777-7777-777777777777';
const RETAKE = '88888888-8888-8888-8888-888888888888';

const valid = {
  originalResultId: ORIG_RESULT,
  studentId: STU,
  enrollmentId: ENR,
  schoolId: SCH,
  examType: 'BLE' as const,
  courses: [COURSE_A, COURSE_B],
  retakeDate: '2026-04-12',
  fee: 250,
};

describe('createExternalExamRetakeSchema', () => {
  it('accepts a well-formed BLE supplementary retake', () => {
    expect(createExternalExamRetakeSchema.parse(valid)).toMatchObject(valid);
  });

  it('accepts NEB_12 Grade-Increment retake', () => {
    expect(
      createExternalExamRetakeSchema.parse({ ...valid, examType: 'NEB_12' }),
    ).toBeTruthy();
  });

  it('accepts fee undefined (some municipalities waive)', () => {
    const { fee: _drop, ...withoutFee } = valid;
    expect(createExternalExamRetakeSchema.parse(withoutFee)).toBeTruthy();
  });

  it('accepts fee=0', () => {
    expect(createExternalExamRetakeSchema.parse({ ...valid, fee: 0 })).toBeTruthy();
  });

  it('rejects empty courses[]', () => {
    expect(() => createExternalExamRetakeSchema.parse({ ...valid, courses: [] })).toThrow();
  });

  it('rejects courses[] > 15', () => {
    const tooMany = Array.from(
      { length: 16 },
      (_, i) => `${String(i).padStart(8, '0')}-0000-0000-0000-000000000000`,
    );
    expect(() =>
      createExternalExamRetakeSchema.parse({ ...valid, courses: tooMany }),
    ).toThrow();
  });

  it('rejects negative fee', () => {
    expect(() => createExternalExamRetakeSchema.parse({ ...valid, fee: -1 })).toThrow();
  });

  it('rejects originalResultId not UUID', () => {
    expect(() =>
      createExternalExamRetakeSchema.parse({ ...valid, originalResultId: 'not-uuid' }),
    ).toThrow();
  });
});

describe('updateExternalExamRetakeSchema', () => {
  it.each(EXTERNAL_EXAM_RETAKE_STATUSES)('accepts status=%s update', (s) => {
    expect(updateExternalExamRetakeSchema.parse({ status: s })).toEqual({ status: s });
  });

  it('rejects status outside the 4-enum', () => {
    expect(() => updateExternalExamRetakeSchema.parse({ status: 'registered' })).toThrow();
  });
});

describe('externalExamRetakeResponseSchema', () => {
  const baseResponse = {
    retakeId: RETAKE,
    originalResultId: ORIG_RESULT,
    studentId: STU,
    enrollmentId: ENR,
    schoolId: SCH,
    tenantId: TEN,
    examType: 'BLE' as const,
    courses: [COURSE_A],
    retakeDate: '2026-04-12',
    fee: 250,
    status: 'REGISTERED' as const,
    createdAt: '2026-04-01T00:00:00.000Z',
    createdBy: 'u1',
    updatedAt: '2026-04-01T00:00:00.000Z',
    updatedBy: 'u1',
  };

  it('round-trips REGISTERED state', () => {
    expect(externalExamRetakeResponseSchema.parse(baseResponse)).toBeTruthy();
  });

  it('round-trips RESULT_IMPORTED state', () => {
    expect(
      externalExamRetakeResponseSchema.parse({ ...baseResponse, status: 'RESULT_IMPORTED' }),
    ).toBeTruthy();
  });

  it('accepts fee null (DDB-serialized "not set")', () => {
    expect(
      externalExamRetakeResponseSchema.parse({ ...baseResponse, fee: null }),
    ).toBeTruthy();
  });

  it('EXTERNAL_EXAM_RETAKE_STATUSES exports the 4 values', () => {
    expect(EXTERNAL_EXAM_RETAKE_STATUSES).toEqual(['REGISTERED', 'SAT', 'RESULT_IMPORTED', 'CANCELLED']);
  });
});
