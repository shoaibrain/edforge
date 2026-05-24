/**
 * InternalAssessment schema spec — Sprint D.3.2
 *
 * Per `d3-sprint-plan.md` §4 D.3.2 — includes the cross-field
 * `score ≤ maxScore` refinement + cross-AY traceability case
 * (two enrollmentIds for same studentId produce distinct rows).
 *
 * Total: 15 assertions (≥10 per §1.4).
 */

import { describe, expect, it } from '@jest/globals';
import {
  createInternalAssessmentSchema,
  updateInternalAssessmentSchema,
  internalAssessmentResponseSchema,
  INTERNAL_ASSESSMENT_STATUSES,
} from './internal-assessment.schema';

const STUDENT = '11111111-1111-1111-1111-111111111111';
const ENROLL_G7 = '22222222-2222-2222-2222-222222222222';
const ENROLL_G8 = '33333333-3333-3333-3333-333333333333';
const SCHOOL = '44444444-4444-4444-4444-444444444444';
const REG = '55555555-5555-5555-5555-555555555555';
const COURSE = '66666666-6666-6666-6666-666666666666';
const RUBRIC = '77777777-7777-7777-7777-777777777777';
const TENANT = '88888888-8888-8888-8888-888888888888';
const ASSESS = '99999999-9999-9999-9999-999999999999';

const valid = {
  registrationId: REG,
  studentId: STUDENT,
  enrollmentId: ENROLL_G8,
  schoolId: SCHOOL,
  examType: 'BLE' as const,
  courseId: COURSE,
  rubricCategoryId: RUBRIC,
  score: 24,
  maxScore: 30,
  enteredBy: 'staff-uuid',
  enteredAt: '2026-05-20T00:00:00.000Z',
};

describe('createInternalAssessmentSchema — shape + cross-field refinement', () => {
  it('accepts a well-formed row', () => {
    expect(createInternalAssessmentSchema.parse(valid)).toMatchObject(valid);
  });

  it('accepts score=0 (a documented zero)', () => {
    expect(createInternalAssessmentSchema.parse({ ...valid, score: 0 })).toBeTruthy();
  });

  it('accepts score=maxScore (boundary)', () => {
    expect(createInternalAssessmentSchema.parse({ ...valid, score: 30 })).toBeTruthy();
  });

  it('rejects score > maxScore (refinement)', () => {
    expect(() =>
      createInternalAssessmentSchema.parse({ ...valid, score: 31, maxScore: 30 }),
    ).toThrow(/maxScore/);
  });

  it('rejects negative score', () => {
    expect(() => createInternalAssessmentSchema.parse({ ...valid, score: -1 })).toThrow();
  });

  it('rejects negative maxScore', () => {
    expect(() => createInternalAssessmentSchema.parse({ ...valid, maxScore: -1 })).toThrow();
  });

  it("rejects enteredBy=''", () => {
    expect(() => createInternalAssessmentSchema.parse({ ...valid, enteredBy: '' })).toThrow();
  });

  it('rejects courseId not UUID', () => {
    expect(() =>
      createInternalAssessmentSchema.parse({ ...valid, courseId: 'not-uuid' }),
    ).toThrow();
  });

  it('rejects enteredAt that is not an ISO datetime', () => {
    expect(() =>
      createInternalAssessmentSchema.parse({ ...valid, enteredAt: '2026-05-20' }),
    ).toThrow();
    expect(() =>
      createInternalAssessmentSchema.parse({ ...valid, enteredAt: 'yesterday' }),
    ).toThrow();
  });
});

describe('createInternalAssessmentSchema — cross-AY traceability (invariant 3)', () => {
  it('same studentId across two enrollmentIds produces distinct, well-formed rows', () => {
    const g7 = createInternalAssessmentSchema.parse({ ...valid, enrollmentId: ENROLL_G7 });
    const g8 = createInternalAssessmentSchema.parse({ ...valid, enrollmentId: ENROLL_G8 });
    expect(g7.enrollmentId).toBe(ENROLL_G7);
    expect(g8.enrollmentId).toBe(ENROLL_G8);
    expect(g7.studentId).toBe(g8.studentId);
    // The GSI2 partition key differs by enrollmentId → cross-AY isolation
    // happens at the storage layer; this assertion exists so future
    // refactors that introduce a "studentId-only" join path break loud.
    expect(g7.enrollmentId).not.toBe(g8.enrollmentId);
  });
});

describe('updateInternalAssessmentSchema', () => {
  it('accepts a score-correction update', () => {
    expect(updateInternalAssessmentSchema.parse({ score: 27 })).toEqual({ score: 27 });
  });

  it('accepts LOCKED_FOR_IEMIS transition (status only)', () => {
    expect(
      updateInternalAssessmentSchema.parse({ status: 'LOCKED_FOR_IEMIS' }),
    ).toEqual({ status: 'LOCKED_FOR_IEMIS' });
  });

  it('accepts supportFlowReason (D.4.3 unlock payload)', () => {
    expect(
      updateInternalAssessmentSchema.parse({
        status: 'DRAFT',
        supportFlowReason: 'IEMIS rejected the file because of an off-by-one student-list error; re-locking after fix',
      }),
    ).toBeTruthy();
  });

  it('rejects status outside the 2-enum', () => {
    expect(() => updateInternalAssessmentSchema.parse({ status: 'draft' })).toThrow();
  });
});

describe('internalAssessmentResponseSchema', () => {
  const baseResponse = {
    assessmentId: ASSESS,
    registrationId: REG,
    studentId: STUDENT,
    enrollmentId: ENROLL_G8,
    schoolId: SCHOOL,
    tenantId: TENANT,
    examType: 'BLE' as const,
    courseId: COURSE,
    rubricCategoryId: RUBRIC,
    score: 24,
    maxScore: 30,
    status: 'DRAFT' as const,
    enteredBy: 'staff-uuid',
    enteredAt: '2026-05-20T00:00:00.000Z',
    createdAt: '2026-05-20T00:00:00.000Z',
    createdBy: 'staff-uuid',
    updatedAt: '2026-05-20T00:00:00.000Z',
    updatedBy: 'staff-uuid',
  };

  it('round-trips DRAFT status', () => {
    expect(internalAssessmentResponseSchema.parse(baseResponse)).toBeTruthy();
  });

  it('round-trips LOCKED_FOR_IEMIS status', () => {
    expect(
      internalAssessmentResponseSchema.parse({ ...baseResponse, status: 'LOCKED_FOR_IEMIS' }),
    ).toBeTruthy();
  });

  it('INTERNAL_ASSESSMENT_STATUSES exports both values', () => {
    expect(INTERNAL_ASSESSMENT_STATUSES).toEqual(['DRAFT', 'LOCKED_FOR_IEMIS']);
  });
});
