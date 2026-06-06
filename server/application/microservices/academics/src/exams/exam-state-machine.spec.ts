/**
 * Exam state-machine spec — Sprint A.3.8
 *
 * Coverage:
 *   - 100% transition coverage (every state pair tested: 5x5 = 25 cases)
 *   - Idempotent no-op (current === target) returns isNoOp: true
 *   - Allowed transitions return valid: true
 *   - Disallowed transitions return valid: false with reason
 *   - acceptsScoreWrites + acceptsExamCourseMutations helpers
 */

import {
  validateTransition,
  acceptsScoreWrites,
  acceptsExamCourseMutations,
  isExamTombstoned,
  ALLOWED_EXAM_TRANSITIONS,
} from './exam-state-machine';
import type { ExamStatus } from '@aibrains/shared-types';

const ALL_STATUSES: ExamStatus[] = [
  'draft',
  'scheduled',
  'in_progress',
  'closed',
  'published',
];

describe('exam-state-machine (A.3.8)', () => {
  describe('validateTransition', () => {
    it('no-op (same status) returns isNoOp: true', () => {
      for (const s of ALL_STATUSES) {
        const r = validateTransition(s, s);
        expect(r.valid).toBe(true);
        expect(r.isNoOp).toBe(true);
      }
    });

    describe('allowed transitions', () => {
      const allowed: Array<[ExamStatus, ExamStatus]> = [
        ['draft', 'scheduled'],
        ['scheduled', 'draft'],         // back-edge: operator un-schedules
        ['scheduled', 'in_progress'],
        ['in_progress', 'scheduled'],   // back-edge: operator postpones
        ['in_progress', 'closed'],
        ['closed', 'published'],
      ];
      it.each(allowed)('%s → %s is allowed', (from, to) => {
        const r = validateTransition(from, to);
        expect(r.valid).toBe(true);
        expect(r.isNoOp).toBe(false);
      });
    });

    describe('disallowed transitions', () => {
      // Skip current === target (covered above) + the 6 allowed transitions.
      const allowedSet = new Set<string>([
        'draft|scheduled',
        'scheduled|draft',
        'scheduled|in_progress',
        'in_progress|scheduled',
        'in_progress|closed',
        'closed|published',
      ]);
      const cases: Array<[ExamStatus, ExamStatus]> = [];
      for (const from of ALL_STATUSES) {
        for (const to of ALL_STATUSES) {
          if (from === to) continue;
          if (allowedSet.has(`${from}|${to}`)) continue;
          cases.push([from, to]);
        }
      }

      it.each(cases)('%s → %s is rejected', (from, to) => {
        const r = validateTransition(from, to);
        expect(r.valid).toBe(false);
        expect(r.isNoOp).toBe(false);
        expect(r.reason).toBeDefined();
        expect(r.reason).toContain(from);
        expect(r.reason).toContain(to);
      });
    });

    it('published is terminal (no outgoing transitions)', () => {
      expect(ALLOWED_EXAM_TRANSITIONS.published).toEqual([]);
      for (const to of ALL_STATUSES) {
        if (to === 'published') continue; // no-op handled separately
        const r = validateTransition('published', to);
        expect(r.valid).toBe(false);
      }
    });

    it('reason mentions <terminal> when from is published', () => {
      const r = validateTransition('published', 'draft');
      expect(r.reason).toContain('<terminal>');
    });
  });

  describe('acceptsScoreWrites', () => {
    it('accepts only scheduled + in_progress', () => {
      expect(acceptsScoreWrites('draft')).toBe(false);
      expect(acceptsScoreWrites('scheduled')).toBe(true);
      expect(acceptsScoreWrites('in_progress')).toBe(true);
      expect(acceptsScoreWrites('closed')).toBe(false);
      expect(acceptsScoreWrites('published')).toBe(false);
    });
  });

  describe('acceptsExamCourseMutations', () => {
    it('accepts only draft + scheduled', () => {
      expect(acceptsExamCourseMutations('draft')).toBe(true);
      expect(acceptsExamCourseMutations('scheduled')).toBe(true);
      expect(acceptsExamCourseMutations('in_progress')).toBe(false);
      expect(acceptsExamCourseMutations('closed')).toBe(false);
      expect(acceptsExamCourseMutations('published')).toBe(false);
    });
  });

  describe('isExamTombstoned', () => {
    it('true only for an explicit isActive=false', () => {
      expect(isExamTombstoned({ isActive: false })).toBe(true);
    });
    it('false for an active exam', () => {
      expect(isExamTombstoned({ isActive: true })).toBe(false);
    });
    it('false when isActive is absent (matches the Lambda active-by-default filter)', () => {
      expect(isExamTombstoned({})).toBe(false);
    });
    it('null-safe: false for null/undefined so callers pass a possibly-absent exam', () => {
      expect(isExamTombstoned(null)).toBe(false);
      expect(isExamTombstoned(undefined)).toBe(false);
    });
  });
});
