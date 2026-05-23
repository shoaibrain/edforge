/**
 * ResultCard Schema Spec — Sprint A.4.2 + A.4.4 + A.4.5
 *
 * Coverage targets (per `a4-sprint-plan.md` §3 Phase 1):
 *   - resultCardStatusSchema: enum membership + tuple coverage
 *   - resultCardCourseScoreSchema: positives + negatives (incl. rawScore>maxMarks)
 *   - updateResultCardConductSchema + updateResultCardRemarkSchema: length caps
 *   - resultCardPublishSchema: empty payload + optional notes
 *   - resultCardResponseSchema: nullable fields + denormalized studentId
 *   - resultCardFilterSchema: optional-everything
 *
 * Total: ≥40 assertions per sprint-plan AC.
 */

import { describe, expect, it } from '@jest/globals';
import { z } from 'zod';
import {
  resultCardStatusSchema,
  RESULT_CARD_STATUSES,
  resultCardCourseScoreSchema,
  updateResultCardConductSchema,
  updateResultCardRemarkSchema,
  resultCardPublishSchema,
  resultCardResponseSchema,
  resultCardListResponseSchema,
  resultCardFilterSchema,
} from './result-card.schema';

// ============================================
// resultCardStatusSchema
// ============================================

describe('resultCardStatusSchema', () => {
  it('accepts draft', () => {
    expect(resultCardStatusSchema.parse('draft')).toBe('draft');
  });

  it('accepts published', () => {
    expect(resultCardStatusSchema.parse('published')).toBe('published');
  });

  it('rejects unknown status', () => {
    expect(() => resultCardStatusSchema.parse('archived')).toThrow();
  });

  it('rejects intermediate states from Exam state machine', () => {
    // Defensive: ensure A.4 status enum is NOT accidentally A.3's exam enum
    expect(() => resultCardStatusSchema.parse('scheduled')).toThrow();
    expect(() => resultCardStatusSchema.parse('in_progress')).toThrow();
    expect(() => resultCardStatusSchema.parse('closed')).toThrow();
  });

  it('RESULT_CARD_STATUSES tuple covers exactly 2 values', () => {
    expect(RESULT_CARD_STATUSES).toHaveLength(2);
    expect(RESULT_CARD_STATUSES).toEqual(['draft', 'published']);
  });
});

// ============================================
// resultCardCourseScoreSchema
// ============================================

const validCourseScore = {
  courseId: '11111111-1111-1111-1111-111111111111',
  examCourseId: '22222222-2222-2222-2222-222222222222',
  academicSubject: 'mathematics' as const,
  rawScore: 75,
  maxMarks: 100,
  grade: 'A',
  gpa: 4.0,
  isPassing: true,
};

describe('resultCardCourseScoreSchema', () => {
  it('accepts a valid course score', () => {
    expect(resultCardCourseScoreSchema.parse(validCourseScore)).toBeDefined();
  });

  it('accepts isTerminalFail flag for CEHRD NG semantics', () => {
    const ng = {
      ...validCourseScore,
      grade: 'NG',
      gpa: 0,
      isPassing: false,
      isTerminalFail: true,
    };
    expect(resultCardCourseScoreSchema.parse(ng)).toBeDefined();
  });

  it('accepts boundary rawScore equal to maxMarks', () => {
    const boundary = { ...validCourseScore, rawScore: 100, maxMarks: 100 };
    expect(resultCardCourseScoreSchema.parse(boundary)).toBeDefined();
  });

  it('accepts rawScore = 0', () => {
    const zero = { ...validCourseScore, rawScore: 0, grade: 'F', gpa: 0, isPassing: false };
    expect(resultCardCourseScoreSchema.parse(zero)).toBeDefined();
  });

  it('rejects rawScore exceeding maxMarks', () => {
    const over = { ...validCourseScore, rawScore: 101, maxMarks: 100 };
    expect(() => resultCardCourseScoreSchema.parse(over)).toThrow();
  });

  it('rejects negative rawScore', () => {
    const neg = { ...validCourseScore, rawScore: -1 };
    expect(() => resultCardCourseScoreSchema.parse(neg)).toThrow();
  });

  it('rejects gpa above 5.0 cap', () => {
    const tooHigh = { ...validCourseScore, gpa: 5.1 };
    expect(() => resultCardCourseScoreSchema.parse(tooHigh)).toThrow();
  });

  it('rejects empty grade string', () => {
    const empty = { ...validCourseScore, grade: '' };
    expect(() => resultCardCourseScoreSchema.parse(empty)).toThrow();
  });

  it('rejects grade longer than 5 chars', () => {
    const long = { ...validCourseScore, grade: 'A+++++' };
    expect(() => resultCardCourseScoreSchema.parse(long)).toThrow();
  });

  it('rejects invalid courseId UUID', () => {
    const bad = { ...validCourseScore, courseId: 'not-a-uuid' };
    expect(() => resultCardCourseScoreSchema.parse(bad)).toThrow();
  });

  it('rejects unknown academicSubject value', () => {
    const bad = { ...validCourseScore, academicSubject: 'cooking' };
    expect(() => resultCardCourseScoreSchema.parse(bad)).toThrow();
  });
});

// ============================================
// updateResultCardConductSchema
// ============================================

describe('updateResultCardConductSchema', () => {
  it('accepts a non-empty conduct string', () => {
    expect(updateResultCardConductSchema.parse({ conduct: 'Excellent' })).toEqual({ conduct: 'Excellent' });
  });

  it('rejects empty conduct', () => {
    expect(() => updateResultCardConductSchema.parse({ conduct: '' })).toThrow();
  });

  it('rejects conduct exceeding 2000 chars', () => {
    const long = 'x'.repeat(2001);
    expect(() => updateResultCardConductSchema.parse({ conduct: long })).toThrow();
  });

  it('accepts conduct exactly at 2000-char cap', () => {
    const max = 'x'.repeat(2000);
    expect(updateResultCardConductSchema.parse({ conduct: max })).toBeDefined();
  });
});

// ============================================
// updateResultCardRemarkSchema
// ============================================

describe('updateResultCardRemarkSchema', () => {
  it('accepts a non-empty remark', () => {
    const r = 'Shoaib has shown great improvement.';
    expect(updateResultCardRemarkSchema.parse({ classTeacherRemark: r })).toEqual({ classTeacherRemark: r });
  });

  it('rejects empty remark', () => {
    expect(() => updateResultCardRemarkSchema.parse({ classTeacherRemark: '' })).toThrow();
  });

  it('rejects remark exceeding 2000 chars', () => {
    const long = 'x'.repeat(2001);
    expect(() => updateResultCardRemarkSchema.parse({ classTeacherRemark: long })).toThrow();
  });
});

// ============================================
// resultCardPublishSchema
// ============================================

describe('resultCardPublishSchema', () => {
  it('accepts empty payload', () => {
    expect(resultCardPublishSchema.parse({})).toEqual({});
  });

  it('accepts optional notes', () => {
    expect(resultCardPublishSchema.parse({ notes: 'Approved by principal' }))
      .toEqual({ notes: 'Approved by principal' });
  });

  it('rejects notes longer than 500 chars', () => {
    const long = 'x'.repeat(501);
    expect(() => resultCardPublishSchema.parse({ notes: long })).toThrow();
  });
});

// ============================================
// resultCardResponseSchema
// ============================================

const validResponse = {
  cardId: '00000000-0000-0000-0000-000000000001',
  tenantId: 'tenant-xyz',
  schoolId: '00000000-0000-0000-0000-000000000002',
  enrollmentId: '00000000-0000-0000-0000-000000000003',
  studentId: '00000000-0000-0000-0000-000000000004',
  examId: '00000000-0000-0000-0000-000000000005',
  termId: '00000000-0000-0000-0000-000000000006',
  academicYearId: '00000000-0000-0000-0000-000000000007',
  courseScores: [validCourseScore],
  totalScore: 75,
  totalMaxMarks: 100,
  termGpa: 4.0,
  overallGrade: 'A',
  classRank: null,
  sectionRank: null,
  conduct: null,
  classTeacherRemark: null,
  status: 'draft' as const,
  publishedAt: null,
  publishedBy: null,
  isTerminalExam: false,
  isActive: true,
  version: 1,
  createdAt: '2026-05-22T10:00:00.000Z',
  updatedAt: '2026-05-22T10:00:00.000Z',
};

describe('resultCardResponseSchema', () => {
  it('accepts a fully-populated draft card with nullable fields', () => {
    expect(resultCardResponseSchema.parse(validResponse)).toBeDefined();
  });

  it('accepts a published card with publishedAt + publishedBy', () => {
    const published = {
      ...validResponse,
      status: 'published' as const,
      publishedAt: '2026-05-23T10:00:00.000Z',
      publishedBy: 'user-001',
    };
    expect(resultCardResponseSchema.parse(published)).toBeDefined();
  });

  it('accepts non-null conduct + remark', () => {
    const filled = {
      ...validResponse,
      conduct: 'Excellent',
      classTeacherRemark: 'Hardworking student.',
    };
    expect(resultCardResponseSchema.parse(filled)).toBeDefined();
  });

  it('accepts isTerminalExam=true (drives C.9.5 cross-year handoff)', () => {
    const terminal = { ...validResponse, isTerminalExam: true };
    expect(resultCardResponseSchema.parse(terminal)).toBeDefined();
  });

  it('accepts classRank + sectionRank when computed (V1.5 forward-compat)', () => {
    const ranked = { ...validResponse, classRank: 3, sectionRank: 1 };
    expect(resultCardResponseSchema.parse(ranked)).toBeDefined();
  });

  it('rejects classRank = 0 (1-indexed)', () => {
    const bad = { ...validResponse, classRank: 0 };
    expect(() => resultCardResponseSchema.parse(bad)).toThrow();
  });

  it('rejects studentId="unknown" — invariant: R42-resolved on write', () => {
    // The schema enforces UUID — 'unknown' would never round-trip.
    // This is an explicit guard against accidental ExamScore.studentId='unknown' leakage.
    const bad = { ...validResponse, studentId: 'unknown' };
    expect(() => resultCardResponseSchema.parse(bad)).toThrow();
  });

  it('rejects negative totalScore', () => {
    const bad = { ...validResponse, totalScore: -1 };
    expect(() => resultCardResponseSchema.parse(bad)).toThrow();
  });

  it('rejects empty courseScores invalid item via refinement', () => {
    const bad = {
      ...validResponse,
      courseScores: [{ ...validCourseScore, rawScore: 200, maxMarks: 100 }],
    };
    expect(() => resultCardResponseSchema.parse(bad)).toThrow();
  });
});

// ============================================
// resultCardListResponseSchema
// ============================================

describe('resultCardListResponseSchema', () => {
  it('accepts an empty page', () => {
    const empty = { items: [], hasMore: false };
    expect(() => resultCardListResponseSchema.parse(empty)).not.toThrow();
  });

  it('accepts a page with items + lastEvaluatedKey for cursor pagination', () => {
    const page = {
      items: [validResponse],
      hasMore: true,
      lastEvaluatedKey: 'eyJjYXJkSWQiOiAiYWJjMTIzIn0=',
      total: 250,
    };
    expect(() => resultCardListResponseSchema.parse(page)).not.toThrow();
  });
});

// ============================================
// resultCardFilterSchema
// ============================================

describe('resultCardFilterSchema', () => {
  it('accepts an empty filter', () => {
    expect(resultCardFilterSchema.parse({})).toEqual({});
  });

  it('accepts examId-only filter', () => {
    const f = { examId: '00000000-0000-0000-0000-000000000005' };
    expect(resultCardFilterSchema.parse(f)).toEqual(f);
  });

  it('accepts compound filter', () => {
    const f = {
      schoolId: '00000000-0000-0000-0000-000000000002',
      academicYearId: '00000000-0000-0000-0000-000000000007',
      termId: '00000000-0000-0000-0000-000000000006',
      status: 'published' as const,
      isTerminalExam: true,
    };
    expect(resultCardFilterSchema.parse(f)).toEqual(f);
  });

  it('rejects invalid status', () => {
    expect(() => resultCardFilterSchema.parse({ status: 'archived' })).toThrow();
  });

  it('rejects non-UUID examId', () => {
    expect(() => resultCardFilterSchema.parse({ examId: 'not-a-uuid' })).toThrow();
  });
});

// ============================================
// Type-level sanity (compile-only — z.infer round-trip)
// ============================================

describe('z.infer type round-trip', () => {
  it('ResultCardCourseScoreDto matches schema shape', () => {
    type T = z.infer<typeof resultCardCourseScoreSchema>;
    const x: T = validCourseScore;
    expect(x.academicSubject).toBe('mathematics');
  });

  it('ResultCardResponseDto matches schema shape', () => {
    type T = z.infer<typeof resultCardResponseSchema>;
    const x: T = validResponse;
    expect(x.status).toBe('draft');
  });
});
