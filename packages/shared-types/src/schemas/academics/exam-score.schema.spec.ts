/**
 * ExamScore schema spec — Sprint A.3.4 + A.3.7 + A.3.9 + A.3.10
 *
 * Coverage:
 *   - createExamScoreSchema positives + negatives
 *   - bulkExamScoreSchema chunking + size guards
 *   - examScoreStatusSchema
 *   - bulkExamScoreResponseSchema
 *   - update / filter shapes
 *   - EXAM_SCORE_BULK_CHUNK_SIZE + EXAM_SCORE_BULK_MAX_TOTAL constants
 */

import {
  examScoreStatusSchema,
  createExamScoreSchema,
  updateExamScoreSchema,
  bulkExamScoreSchema,
  bulkExamScoreResponseSchema,
  examScoreResponseSchema,
  examScoreFilterSchema,
  EXAM_SCORE_BULK_CHUNK_SIZE,
  EXAM_SCORE_BULK_MAX_TOTAL,
} from './exam-score.schema';

describe('ExamScore schemas (A.3.4 + A.3.7 + A.3.9 + A.3.10)', () => {
  // ============================================
  // Constants
  // ============================================
  describe('chunking constants', () => {
    it('EXAM_SCORE_BULK_CHUNK_SIZE is 100 (DDB TransactWriteItems limit)', () => {
      expect(EXAM_SCORE_BULK_CHUNK_SIZE).toBe(100);
    });

    it('EXAM_SCORE_BULK_MAX_TOTAL is 250 (2.5 chunks)', () => {
      expect(EXAM_SCORE_BULK_MAX_TOTAL).toBe(250);
    });
  });

  // ============================================
  // examScoreStatusSchema
  // ============================================
  describe('examScoreStatusSchema', () => {
    it('accepts entered + locked', () => {
      expect(examScoreStatusSchema.safeParse('entered').success).toBe(true);
      expect(examScoreStatusSchema.safeParse('locked').success).toBe(true);
    });

    it('rejects unknown status', () => {
      expect(examScoreStatusSchema.safeParse('draft').success).toBe(false);
      expect(examScoreStatusSchema.safeParse('Entered').success).toBe(false);
    });
  });

  // ============================================
  // createExamScoreSchema
  // ============================================
  describe('createExamScoreSchema', () => {
    const validBase = {
      examCourseId: '11111111-1111-1111-1111-111111111111',
      enrollmentId: '22222222-2222-2222-2222-222222222222',
      rawScore: 75,
    };

    it('accepts a valid create payload', () => {
      const r = createExamScoreSchema.safeParse(validBase);
      expect(r.success).toBe(true);
    });

    it('accepts rawScore === 0 (edge: full failure)', () => {
      const r = createExamScoreSchema.safeParse({ ...validBase, rawScore: 0 });
      expect(r.success).toBe(true);
    });

    it('rejects rawScore < 0', () => {
      const r = createExamScoreSchema.safeParse({ ...validBase, rawScore: -1 });
      expect(r.success).toBe(false);
    });

    it('rejects rawScore > 1000 (schema-layer cap; ExamCourse.maxMarks is the runtime cap)', () => {
      const r = createExamScoreSchema.safeParse({ ...validBase, rawScore: 1001 });
      expect(r.success).toBe(false);
    });

    it('rejects non-UUID examCourseId or enrollmentId', () => {
      expect(
        createExamScoreSchema.safeParse({ ...validBase, examCourseId: 'bad' }).success,
      ).toBe(false);
      expect(
        createExamScoreSchema.safeParse({ ...validBase, enrollmentId: 'bad' }).success,
      ).toBe(false);
    });

    it('accepts optional correlationId', () => {
      const r = createExamScoreSchema.safeParse({
        ...validBase,
        correlationId: '33333333-3333-3333-3333-333333333333',
      });
      expect(r.success).toBe(true);
    });
  });

  // ============================================
  // updateExamScoreSchema
  // ============================================
  describe('updateExamScoreSchema', () => {
    it('accepts rawScore-only update', () => {
      const r = updateExamScoreSchema.safeParse({ rawScore: 80 });
      expect(r.success).toBe(true);
    });

    it('accepts empty update', () => {
      const r = updateExamScoreSchema.safeParse({});
      expect(r.success).toBe(true);
    });
  });

  // ============================================
  // bulkExamScoreSchema (A.3.9)
  // ============================================
  describe('bulkExamScoreSchema', () => {
    const validCorrelationId = '44444444-4444-4444-4444-444444444444';

    function buildScores(n: number) {
      return Array.from({ length: n }, (_, i) => ({
        examCourseId: '55555555-5555-5555-5555-555555555555',
        enrollmentId: `66666666-6666-6666-6666-${String(i).padStart(12, '0')}`,
        rawScore: 50 + (i % 50),
      }));
    }

    it('accepts a valid bulk payload (10 scores)', () => {
      const r = bulkExamScoreSchema.safeParse({
        correlationId: validCorrelationId,
        scores: buildScores(10),
      });
      expect(r.success).toBe(true);
    });

    it('accepts exactly 250 scores (max allowed)', () => {
      const r = bulkExamScoreSchema.safeParse({
        correlationId: validCorrelationId,
        scores: buildScores(EXAM_SCORE_BULK_MAX_TOTAL),
      });
      expect(r.success).toBe(true);
    });

    it('rejects 251 scores (exceeds bulk maximum)', () => {
      const r = bulkExamScoreSchema.safeParse({
        correlationId: validCorrelationId,
        scores: buildScores(EXAM_SCORE_BULK_MAX_TOTAL + 1),
      });
      expect(r.success).toBe(false);
    });

    it('rejects empty scores[] (must contain at least 1)', () => {
      const r = bulkExamScoreSchema.safeParse({
        correlationId: validCorrelationId,
        scores: [],
      });
      expect(r.success).toBe(false);
    });

    it('rejects missing correlationId', () => {
      const r = bulkExamScoreSchema.safeParse({
        scores: buildScores(5),
      });
      expect(r.success).toBe(false);
    });

    it('rejects non-UUID correlationId', () => {
      const r = bulkExamScoreSchema.safeParse({
        correlationId: 'not-a-uuid',
        scores: buildScores(5),
      });
      expect(r.success).toBe(false);
    });

    it('rejects invalid score within the array (one bad apple fails the whole batch)', () => {
      const scores = buildScores(5);
      scores[3].rawScore = -10;
      const r = bulkExamScoreSchema.safeParse({
        correlationId: validCorrelationId,
        scores,
      });
      expect(r.success).toBe(false);
    });

    it('accepts chunk-size-aligned payloads (100 + 200 + 250)', () => {
      for (const n of [100, 200, 250]) {
        const r = bulkExamScoreSchema.safeParse({
          correlationId: validCorrelationId,
          scores: buildScores(n),
        });
        expect(r.success).toBe(true);
      }
    });
  });

  // ============================================
  // bulkExamScoreResponseSchema
  // ============================================
  describe('bulkExamScoreResponseSchema', () => {
    it('accepts a typical multi-chunk response', () => {
      const r = bulkExamScoreResponseSchema.safeParse({
        correlationId: '44444444-4444-4444-4444-444444444444',
        examId: '77777777-7777-7777-7777-777777777777',
        totalScores: 220,
        totalCreated: 220,
        totalSkipped: 0,
        totalFailed: 0,
        chunks: [
          { chunkIndex: 0, chunkSize: 100, status: 'ok' },
          { chunkIndex: 1, chunkSize: 100, status: 'ok' },
          { chunkIndex: 2, chunkSize: 20, status: 'ok' },
        ],
        alreadyProcessed: false,
      });
      expect(r.success).toBe(true);
    });

    it('accepts idempotent re-write response', () => {
      const r = bulkExamScoreResponseSchema.safeParse({
        correlationId: '44444444-4444-4444-4444-444444444444',
        examId: '77777777-7777-7777-7777-777777777777',
        totalScores: 100,
        totalCreated: 0,
        totalSkipped: 100,
        totalFailed: 0,
        chunks: [
          { chunkIndex: 0, chunkSize: 100, status: 'idempotent_skip' },
        ],
        alreadyProcessed: true,
      });
      expect(r.success).toBe(true);
    });

    it('accepts partial-failure response', () => {
      const r = bulkExamScoreResponseSchema.safeParse({
        correlationId: '44444444-4444-4444-4444-444444444444',
        examId: '77777777-7777-7777-7777-777777777777',
        totalScores: 200,
        totalCreated: 100,
        totalSkipped: 0,
        totalFailed: 100,
        chunks: [
          { chunkIndex: 0, chunkSize: 100, status: 'ok' },
          { chunkIndex: 1, chunkSize: 100, status: 'failed', failureReason: 'ConditionalCheckFailedException on score #42' },
        ],
        alreadyProcessed: false,
      });
      expect(r.success).toBe(true);
    });
  });

  // ============================================
  // examScoreResponseSchema (smoke)
  // ============================================
  describe('examScoreResponseSchema', () => {
    it('accepts a full response (keyed by enrollmentId — invariant 3)', () => {
      const r = examScoreResponseSchema.safeParse({
        examScoreId: '99999999-9999-9999-9999-999999999999',
        examId: '88888888-8888-8888-8888-888888888888',
        examCourseId: '11111111-1111-1111-1111-111111111111',
        enrollmentId: '22222222-2222-2222-2222-222222222222',
        schoolId: '33333333-3333-3333-3333-333333333333',
        tenantId: 'tenant-001',
        studentId: '44444444-4444-4444-4444-444444444444',
        rawScore: 75,
        status: 'entered',
        enteredBy: 'admin-user-001',
        enteredAt: '2026-05-22T10:00:00.000Z',
        version: 1,
        createdAt: '2026-05-22T10:00:00.000Z',
        updatedAt: '2026-05-22T10:00:00.000Z',
      });
      expect(r.success).toBe(true);
    });
  });

  // ============================================
  // examScoreFilterSchema
  // ============================================
  describe('examScoreFilterSchema', () => {
    it('accepts empty filter', () => {
      const r = examScoreFilterSchema.safeParse({});
      expect(r.success).toBe(true);
    });

    it('accepts filter by enrollmentId (cross-AY transcript)', () => {
      const r = examScoreFilterSchema.safeParse({
        enrollmentId: '22222222-2222-2222-2222-222222222222',
      });
      expect(r.success).toBe(true);
    });

    it('accepts filter by correlationId (bulk-write debugging)', () => {
      const r = examScoreFilterSchema.safeParse({
        correlationId: '44444444-4444-4444-4444-444444444444',
      });
      expect(r.success).toBe(true);
    });
  });
});
