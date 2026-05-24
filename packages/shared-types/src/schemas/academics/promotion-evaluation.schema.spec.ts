/**
 * Promotion Evaluation + Commit Schema Spec — Sprint D.2.4 + D.2.5 + D.2.6
 *
 * Coverage targets (per `d2-sprint-plan.md` §4 D.2.4 + D.2.5 + D.2.6):
 *   - retentionReasonSchema: enum membership
 *   - promotionEvaluationResultSchema: positive + nested-details validation
 *   - promotionEvaluationRequestSchema: optional + bounds
 *   - promotionEvaluationResponseSchema: round-trip + empty results
 *   - promotionCommitDecisionSchema: refine (targetGradeLevel required for promoted/conditional)
 *   - promotionCommitRequestSchema: bounds + decisions[] empty rejection
 *   - promotionCommitResponseSchema: failure[] optional shape
 *
 * Total: ≥20 assertions per sprint-plan AC.
 */

import { describe, expect, it } from '@jest/globals';
import {
  retentionReasonSchema,
  promotionEvaluationResultSchema,
  promotionEvaluationRequestSchema,
  promotionEvaluationResponseSchema,
  promotionCommitDecisionSchema,
  promotionCommitRequestSchema,
  promotionCommitResponseSchema,
} from './promotion-evaluation.schema';

const ENROLLMENT_UUID = '11111111-1111-1111-1111-111111111111';
const STUDENT_UUID = '22222222-2222-2222-2222-222222222222';
const SCHOOL_UUID = '33333333-3333-3333-3333-333333333333';
const AY1_UUID = '44444444-4444-4444-4444-444444444444';
const AY2_UUID = '55555555-5555-5555-5555-555555555555';

// ============================================
// retentionReasonSchema
// ============================================

describe('retentionReasonSchema', () => {
  it.each(['subject_failure', 'attendance_failure', 'subjects_required_missing', 'no_terminal_card'] as const)(
    'accepts %s',
    (reason) => {
      expect(retentionReasonSchema.parse(reason)).toBe(reason);
    },
  );

  it('rejects unknown reason', () => {
    expect(() => retentionReasonSchema.parse('disciplinary')).toThrow();
  });
});

// ============================================
// promotionEvaluationResultSchema
// ============================================

const validEligible = {
  enrollmentId: ENROLLMENT_UUID,
  studentId: STUDENT_UUID,
  eligible: true,
  suggestedDecision: 'promoted' as const,
  retainedReasons: [],
  details: {
    overallPassedSubjects: 5,
    overallFailedSubjects: 0,
    failedSubjectIds: [],
    attendancePct: 92.5,
    passingThresholdPct: 35,
    minAttendancePct: 80,
  },
};

const validRetainedSubjectFail = {
  ...validEligible,
  eligible: false,
  suggestedDecision: 'retained' as const,
  retainedReasons: ['subject_failure' as const],
  details: {
    ...validEligible.details,
    overallPassedSubjects: 4,
    overallFailedSubjects: 1,
    failedSubjectIds: ['course-math-uuid'],
  },
};

describe('promotionEvaluationResultSchema', () => {
  it('accepts an eligible/promoted result', () => {
    expect(promotionEvaluationResultSchema.parse(validEligible)).toBeDefined();
  });

  it('accepts a retained-subject-failure result', () => {
    const parsed = promotionEvaluationResultSchema.parse(validRetainedSubjectFail);
    expect(parsed.retainedReasons).toEqual(['subject_failure']);
  });

  it('accepts stacked retainedReasons (subject + attendance)', () => {
    const stacked = {
      ...validRetainedSubjectFail,
      retainedReasons: ['subject_failure' as const, 'attendance_failure' as const],
      details: { ...validRetainedSubjectFail.details, attendancePct: 70 },
    };
    expect(promotionEvaluationResultSchema.parse(stacked).retainedReasons).toHaveLength(2);
  });

  it('accepts no_terminal_card result (single reason)', () => {
    const noCard = {
      ...validRetainedSubjectFail,
      retainedReasons: ['no_terminal_card' as const],
      details: { ...validRetainedSubjectFail.details, overallPassedSubjects: 0, overallFailedSubjects: 0 },
    };
    expect(promotionEvaluationResultSchema.parse(noCard)).toBeDefined();
  });

  it('rejects attendancePct = 100.5', () => {
    const badAtt = { ...validEligible, details: { ...validEligible.details, attendancePct: 100.5 } };
    expect(() => promotionEvaluationResultSchema.parse(badAtt)).toThrow();
  });

  it('rejects negative overallFailedSubjects', () => {
    const bad = { ...validEligible, details: { ...validEligible.details, overallFailedSubjects: -1 } };
    expect(() => promotionEvaluationResultSchema.parse(bad)).toThrow();
  });
});

// ============================================
// promotionEvaluationRequestSchema
// ============================================

describe('promotionEvaluationRequestSchema', () => {
  it('accepts empty body', () => {
    expect(promotionEvaluationRequestSchema.parse({})).toEqual({});
  });

  it('accepts enrollmentIds[]', () => {
    const parsed = promotionEvaluationRequestSchema.parse({ enrollmentIds: [ENROLLMENT_UUID] });
    expect(parsed.enrollmentIds).toHaveLength(1);
  });

  it('rejects enrollmentIds > 500 (defensive cap)', () => {
    const tooMany = Array.from({ length: 501 }, () => ENROLLMENT_UUID);
    expect(() => promotionEvaluationRequestSchema.parse({ enrollmentIds: tooMany })).toThrow();
  });
});

// ============================================
// promotionEvaluationResponseSchema
// ============================================

describe('promotionEvaluationResponseSchema', () => {
  it('accepts a populated response', () => {
    const resp = {
      fromAyId: AY1_UUID,
      targetAyId: AY2_UUID,
      gradeLevel: '7',
      schoolId: SCHOOL_UUID,
      evaluatedCount: 2,
      results: [validEligible, validRetainedSubjectFail],
    };
    const parsed = promotionEvaluationResponseSchema.parse(resp);
    expect(parsed.results).toHaveLength(2);
  });

  it('accepts empty results array', () => {
    const parsed = promotionEvaluationResponseSchema.parse({
      fromAyId: AY1_UUID,
      targetAyId: AY2_UUID,
      gradeLevel: '7',
      schoolId: SCHOOL_UUID,
      evaluatedCount: 0,
      results: [],
    });
    expect(parsed.results).toEqual([]);
  });

  it('accepts nextCursor for pagination', () => {
    const parsed = promotionEvaluationResponseSchema.parse({
      fromAyId: AY1_UUID,
      targetAyId: AY2_UUID,
      gradeLevel: '7',
      schoolId: SCHOOL_UUID,
      evaluatedCount: 1,
      results: [validEligible],
      nextCursor: 'opaque',
    });
    expect(parsed.nextCursor).toBe('opaque');
  });
});

// ============================================
// promotionCommitDecisionSchema (refined)
// ============================================

describe('promotionCommitDecisionSchema', () => {
  it('accepts promoted + targetGradeLevel', () => {
    expect(promotionCommitDecisionSchema.parse({
      enrollmentId: ENROLLMENT_UUID,
      decision: 'promoted',
      targetGradeLevel: '8',
    })).toBeDefined();
  });

  it('accepts conditional + targetGradeLevel', () => {
    expect(promotionCommitDecisionSchema.parse({
      enrollmentId: ENROLLMENT_UUID,
      decision: 'conditional',
      targetGradeLevel: '8',
    })).toBeDefined();
  });

  it('rejects promoted WITHOUT targetGradeLevel', () => {
    expect(() => promotionCommitDecisionSchema.parse({
      enrollmentId: ENROLLMENT_UUID,
      decision: 'promoted',
    })).toThrow(/targetGradeLevel/);
  });

  it('rejects conditional WITHOUT targetGradeLevel', () => {
    expect(() => promotionCommitDecisionSchema.parse({
      enrollmentId: ENROLLMENT_UUID,
      decision: 'conditional',
    })).toThrow(/targetGradeLevel/);
  });

  it.each(['retained', 'graduated', 'withdrawn', 'transferred_out'] as const)(
    'accepts %s WITHOUT targetGradeLevel',
    (decision) => {
      expect(promotionCommitDecisionSchema.parse({
        enrollmentId: ENROLLMENT_UUID,
        decision,
      })).toBeDefined();
    },
  );

  it('accepts correlationId for idempotent retry', () => {
    expect(promotionCommitDecisionSchema.parse({
      enrollmentId: ENROLLMENT_UUID,
      decision: 'retained',
      correlationId: 'commit-2026-05-23-T1',
    })).toBeDefined();
  });
});

// ============================================
// promotionCommitRequestSchema
// ============================================

describe('promotionCommitRequestSchema', () => {
  it('accepts a single-row commit', () => {
    expect(promotionCommitRequestSchema.parse({
      decisions: [{ enrollmentId: ENROLLMENT_UUID, decision: 'retained' }],
    })).toBeDefined();
  });

  it('rejects empty decisions[]', () => {
    expect(() => promotionCommitRequestSchema.parse({ decisions: [] })).toThrow();
  });

  it('rejects decisions[] > 500 (defensive cap matching evaluation request)', () => {
    const tooMany = Array.from({ length: 501 }, () => ({
      enrollmentId: ENROLLMENT_UUID,
      decision: 'retained' as const,
    }));
    expect(() => promotionCommitRequestSchema.parse({ decisions: tooMany })).toThrow();
  });

  it('rejects duplicate enrollmentId within a single request', () => {
    const otherEnrollment = '77777777-7777-7777-7777-777777777777';
    const duplicate = {
      decisions: [
        { enrollmentId: ENROLLMENT_UUID, decision: 'retained' as const },
        { enrollmentId: otherEnrollment, decision: 'retained' as const },
        { enrollmentId: ENROLLMENT_UUID, decision: 'withdrawn' as const },
      ],
    };
    expect(() => promotionCommitRequestSchema.parse(duplicate)).toThrow(/duplicate enrollmentId/);
  });

  it('accepts multiple decisions with distinct enrollmentIds', () => {
    const otherEnrollment = '77777777-7777-7777-7777-777777777777';
    const valid = {
      decisions: [
        { enrollmentId: ENROLLMENT_UUID, decision: 'retained' as const },
        { enrollmentId: otherEnrollment, decision: 'promoted' as const, targetGradeLevel: '8' },
      ],
    };
    expect(promotionCommitRequestSchema.parse(valid).decisions).toHaveLength(2);
  });
});

// ============================================
// promotionCommitResponseSchema
// ============================================

describe('promotionCommitResponseSchema', () => {
  it('accepts a successful commit response (no failures)', () => {
    expect(promotionCommitResponseSchema.parse({
      fromAyId: AY1_UUID,
      targetAyId: AY2_UUID,
      schoolId: SCHOOL_UUID,
      committedCount: 200,
      chunksTotal: 2,
      chunksSucceeded: 2,
    })).toBeDefined();
  });

  it('accepts a partial-failure response with failures[]', () => {
    const parsed = promotionCommitResponseSchema.parse({
      fromAyId: AY1_UUID,
      targetAyId: AY2_UUID,
      schoolId: SCHOOL_UUID,
      committedCount: 100,
      chunksTotal: 2,
      chunksSucceeded: 1,
      failures: [{ enrollmentId: ENROLLMENT_UUID, reason: 'ConditionalCheckFailed' }],
    });
    expect(parsed.failures).toHaveLength(1);
  });
});
