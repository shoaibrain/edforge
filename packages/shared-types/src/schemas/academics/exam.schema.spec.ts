/**
 * Exam schema spec — Sprint A.3.2 + A.3.8 + A.3.10
 *
 * Coverage:
 *   - examStatusSchema enum (5 values; covers full state machine)
 *   - createExamSchema positives + negatives (date range, examType enum)
 *   - updateExamSchema (immutable fields not present)
 *   - examStatusTransitionSchema
 *   - examFilterSchema
 */

import {
  examStatusSchema,
  EXAM_STATUSES,
  createExamSchema,
  updateExamSchema,
  examStatusTransitionSchema,
  examFilterSchema,
  examResponseSchema,
  type ExamStatus,
} from './exam.schema';

describe('Exam schemas (A.3.2 + A.3.8 + A.3.10)', () => {
  // ============================================
  // examStatusSchema
  // ============================================
  describe('examStatusSchema', () => {
    it('exports exactly 5 status values matching the state machine', () => {
      expect(EXAM_STATUSES).toHaveLength(5);
      expect(new Set(EXAM_STATUSES)).toEqual(
        new Set(['draft', 'scheduled', 'in_progress', 'closed', 'published']),
      );
    });

    it.each(EXAM_STATUSES)('accepts canonical status %s', (status) => {
      expect(examStatusSchema.safeParse(status).success).toBe(true);
    });

    it('rejects unknown status', () => {
      expect(examStatusSchema.safeParse('cancelled').success).toBe(false);
      expect(examStatusSchema.safeParse('Draft').success).toBe(false); // case-sensitive
      expect(examStatusSchema.safeParse('').success).toBe(false);
    });

    it('TS type narrows to the union', () => {
      const valid: ExamStatus = 'scheduled';
      expect(valid).toBe('scheduled');
    });
  });

  // ============================================
  // createExamSchema
  // ============================================
  describe('createExamSchema', () => {
    const validBase = {
      examName: 'Term 1 Final',
      schoolId: '11111111-1111-1111-1111-111111111111',
      academicYearId: '22222222-2222-2222-2222-222222222222',
      termId: '33333333-3333-3333-3333-333333333333',
      examType: 'terminal' as const,
      gradeLevels: ['10'],
      startDate: '2026-06-01',
      endDate: '2026-06-15',
    };

    it('accepts a valid create payload', () => {
      const r = createExamSchema.safeParse(validBase);
      expect(r.success).toBe(true);
    });

    it('rejects invalid examType (not in examPatternKeySchema enum)', () => {
      const r = createExamSchema.safeParse({ ...validBase, examType: 'astrology_test' });
      expect(r.success).toBe(false);
    });

    it('accepts all 6 examPatternKey values', () => {
      const types = ['unit_test', 'terminal', 'send_up', 'pre_board', 'final', 'monthly_test'];
      for (const t of types) {
        const r = createExamSchema.safeParse({ ...validBase, examType: t });
        expect(r.success).toBe(true);
      }
    });

    it('rejects startDate > endDate', () => {
      const r = createExamSchema.safeParse({
        ...validBase,
        startDate: '2026-06-15',
        endDate: '2026-06-01',
      });
      expect(r.success).toBe(false);
    });

    it('accepts startDate === endDate (single-day exam)', () => {
      const r = createExamSchema.safeParse({
        ...validBase,
        startDate: '2026-06-01',
        endDate: '2026-06-01',
      });
      expect(r.success).toBe(true);
    });

    it('rejects examName too short', () => {
      const r = createExamSchema.safeParse({ ...validBase, examName: 'X' });
      expect(r.success).toBe(false);
    });

    it('rejects non-UUID schoolId / termId / academicYearId', () => {
      expect(createExamSchema.safeParse({ ...validBase, schoolId: 'not-a-uuid' }).success).toBe(false);
      expect(createExamSchema.safeParse({ ...validBase, termId: 'not-a-uuid' }).success).toBe(false);
      expect(createExamSchema.safeParse({ ...validBase, academicYearId: 'not-a-uuid' }).success).toBe(false);
    });

    it('accepts optional description', () => {
      const r = createExamSchema.safeParse({ ...validBase, description: 'Term-end final for Grade 10' });
      expect(r.success).toBe(true);
    });

    // ELS.1 — grade-level scoping
    it('rejects missing gradeLevels', () => {
      const { gradeLevels: _omit, ...withoutGradeLevels } = validBase;
      const r = createExamSchema.safeParse(withoutGradeLevels);
      expect(r.success).toBe(false);
    });

    it('rejects empty gradeLevels array', () => {
      const r = createExamSchema.safeParse({ ...validBase, gradeLevels: [] });
      expect(r.success).toBe(false);
    });

    it('accepts a single-grade exam (the common K-12 case)', () => {
      const r = createExamSchema.safeParse({ ...validBase, gradeLevels: ['2'] });
      expect(r.success).toBe(true);
    });

    it('accepts a grade-split exam (PABSON NCF-OPMATH-G910 case)', () => {
      const r = createExamSchema.safeParse({ ...validBase, gradeLevels: ['9', '10'] });
      expect(r.success).toBe(true);
    });

    it('accepts IEMIS pre-primary codes (ECD / PPC)', () => {
      const r = createExamSchema.safeParse({ ...validBase, gradeLevels: ['ECD', 'PPC'] });
      expect(r.success).toBe(true);
    });

    it('rejects an empty grade code', () => {
      const r = createExamSchema.safeParse({ ...validBase, gradeLevels: [''] });
      expect(r.success).toBe(false);
    });
  });

  // ============================================
  // updateExamSchema
  // ============================================
  describe('updateExamSchema', () => {
    it('accepts partial update with examName only', () => {
      const r = updateExamSchema.safeParse({ examName: 'Renamed Final' });
      expect(r.success).toBe(true);
    });

    it('accepts empty update payload', () => {
      const r = updateExamSchema.safeParse({});
      expect(r.success).toBe(true);
    });

    it('does NOT carry immutable fields (schoolId / termId / academicYearId are absent from the type)', () => {
      // TS-level check: these properties must NOT be assignable.
      // We test it via the schema's shape — passing them is allowed (Zod
      // ignores extras by default) but they have no semantic effect.
      const r = updateExamSchema.safeParse({ examName: 'OK', schoolId: 'extra' });
      expect(r.success).toBe(true);
      // The parsed output should NOT carry schoolId
      if (r.success) {
        expect((r.data as Record<string, unknown>).schoolId).toBeUndefined();
      }
    });
  });

  // ============================================
  // examStatusTransitionSchema
  // ============================================
  describe('examStatusTransitionSchema', () => {
    it('accepts a valid transition payload', () => {
      const r = examStatusTransitionSchema.safeParse({ targetStatus: 'scheduled' });
      expect(r.success).toBe(true);
    });

    it('accepts optional notes', () => {
      const r = examStatusTransitionSchema.safeParse({
        targetStatus: 'closed',
        notes: 'All marks entered, locking',
      });
      expect(r.success).toBe(true);
    });

    it('rejects invalid targetStatus', () => {
      const r = examStatusTransitionSchema.safeParse({ targetStatus: 'cancelled' });
      expect(r.success).toBe(false);
    });
  });

  // ============================================
  // examFilterSchema
  // ============================================
  describe('examFilterSchema', () => {
    it('accepts empty filter (all-fields-optional)', () => {
      const r = examFilterSchema.safeParse({});
      expect(r.success).toBe(true);
    });

    it('accepts filter by termId + status', () => {
      const r = examFilterSchema.safeParse({
        termId: '33333333-3333-3333-3333-333333333333',
        status: 'in_progress',
      });
      expect(r.success).toBe(true);
    });

    it('rejects invalid examType in filter', () => {
      const r = examFilterSchema.safeParse({ examType: 'astrology_test' });
      expect(r.success).toBe(false);
    });
  });

  // ============================================
  // examResponseSchema (smoke — shape only)
  // ============================================
  describe('examResponseSchema', () => {
    it('accepts a full response shape', () => {
      const r = examResponseSchema.safeParse({
        examId: '99999999-9999-9999-9999-999999999999',
        schoolId: '11111111-1111-1111-1111-111111111111',
        tenantId: 'tenant-001',
        examName: 'Term 1 Final',
        academicYearId: '22222222-2222-2222-2222-222222222222',
        termId: '33333333-3333-3333-3333-333333333333',
        examType: 'terminal',
        startDate: '2026-06-01',
        endDate: '2026-06-15',
        status: 'scheduled',
        isActive: true,
        version: 1,
        createdAt: '2026-05-22T10:00:00.000Z',
        updatedAt: '2026-05-22T10:00:00.000Z',
      });
      expect(r.success).toBe(true);
    });
  });
});
