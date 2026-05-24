/**
 * Enrollment State Machine Spec — Sprint D.2.8
 *
 * 100% transition coverage: every (from, to) pair tested for valid/invalid.
 * The pre-D.2 status table also covered, so this spec is the regression
 * gate for both the pre-existing transitions AND the new `provisional`
 * row introduced by D.2.8.
 *
 * Key D.2 invariants asserted:
 *   - provisional → enrolled (D.2.10 flip) is VALID
 *   - provisional → withdrawn (operator delete pre-flip) is VALID
 *   - enrolled → provisional is REJECTED (would violate provisional's
 *     "created directly, never transitioned to" rule)
 *   - pending → provisional is REJECTED (same reason)
 */

import { describe, expect, it } from '@jest/globals';
import {
  isValidTransition,
  getAllowedTransitions,
  validateTransition,
} from './enrollment-state-machine';
import type { EnrollmentStatus } from '../entities/base.entity';

const ALL_STATUSES: EnrollmentStatus[] = [
  'pending',
  'enrolled',
  'active',
  'provisional',
  'suspended',
  'withdrawn',
  'transferred',
  'graduated',
  'expelled',
  'completed',
];

// Source-of-truth map. Keep in sync with VALID_TRANSITIONS in
// enrollment-state-machine.ts.
const EXPECTED_TRANSITIONS: Record<string, EnrollmentStatus[]> = {
  pending:     ['enrolled', 'withdrawn'],
  enrolled:    ['withdrawn', 'transferred', 'graduated', 'suspended', 'expelled'],
  active:      ['withdrawn', 'transferred', 'graduated', 'suspended', 'expelled'],
  provisional: ['enrolled', 'withdrawn'],
  suspended:   ['enrolled', 'withdrawn', 'expelled'],
  withdrawn:   [],
  transferred: [],
  graduated:   [],
  expelled:    [],
  completed:   [],
};

// ============================================
// isValidTransition — full Cartesian coverage
// ============================================

describe('isValidTransition — every (from,to) pair', () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const expected = EXPECTED_TRANSITIONS[from].includes(to);
      it(`${from} → ${to} : ${expected ? 'VALID' : 'invalid'}`, () => {
        expect(isValidTransition(from, to)).toBe(expected);
      });
    }
  }
});

// ============================================
// Sprint D.2.8 — provisional row specifics
// ============================================

describe('provisional state machine (D.2.8)', () => {
  it('allows provisional → enrolled (D.2.10 atomic flip)', () => {
    expect(isValidTransition('provisional', 'enrolled')).toBe(true);
  });

  it('allows provisional → withdrawn (operator deletes pre-flip)', () => {
    expect(isValidTransition('provisional', 'withdrawn')).toBe(true);
  });

  it('rejects provisional → transferred (transfers go via D.2.6 transferred_out decision, not state machine)', () => {
    expect(isValidTransition('provisional', 'transferred')).toBe(false);
  });

  it('rejects provisional → graduated (provisional rows are pre-flip; cannot graduate directly)', () => {
    expect(isValidTransition('provisional', 'graduated')).toBe(false);
  });

  it('rejects enrolled → provisional (provisional created directly by D.2.6, never transitioned to)', () => {
    expect(isValidTransition('enrolled', 'provisional')).toBe(false);
  });

  it('rejects pending → provisional (provisional created directly by D.2.6, never transitioned to)', () => {
    expect(isValidTransition('pending', 'provisional')).toBe(false);
  });

  it('rejects withdrawn → provisional (terminal state)', () => {
    expect(isValidTransition('withdrawn', 'provisional')).toBe(false);
  });

  it('getAllowedTransitions(provisional) returns exactly [enrolled, withdrawn]', () => {
    const allowed = getAllowedTransitions('provisional');
    expect(allowed.sort()).toEqual(['enrolled', 'withdrawn'].sort());
  });
});

// ============================================
// getAllowedTransitions — pre-D.2 regression
// ============================================

describe('getAllowedTransitions — non-provisional regression', () => {
  it.each(ALL_STATUSES)('returns the documented transition set for %s', (from) => {
    const allowed = getAllowedTransitions(from);
    const expected = EXPECTED_TRANSITIONS[from];
    expect([...allowed].sort()).toEqual([...expected].sort());
  });
});

// ============================================
// validateTransition — throws on invalid
// ============================================

describe('validateTransition', () => {
  it('does not throw for a valid transition', () => {
    expect(() => validateTransition('provisional', 'enrolled')).not.toThrow();
  });

  it('throws with informative message for invalid provisional target', () => {
    expect(() => validateTransition('provisional', 'graduated')).toThrow(
      /Invalid enrollment status transition: provisional → graduated/,
    );
  });

  it('throws for invalid enrolled → provisional', () => {
    expect(() => validateTransition('enrolled', 'provisional')).toThrow(
      /Invalid enrollment status transition: enrolled → provisional/,
    );
  });

  it('throws for terminal-state outbound (withdrawn → anything)', () => {
    expect(() => validateTransition('withdrawn', 'enrolled')).toThrow(
      /terminal state/,
    );
  });
});
