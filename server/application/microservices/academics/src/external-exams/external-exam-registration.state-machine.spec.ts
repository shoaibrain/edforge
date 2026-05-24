/**
 * ExternalExamRegistration state-machine spec — Sprint D.3.1
 *
 * Per `d3-sprint-plan.md` §4 D.3.1 — 4×4 transition matrix (16 cells):
 *   - 4 legal transitions (DRAFT→SUBMITTED_TO_IEMIS, DRAFT→CANCELLED,
 *     SUBMITTED_TO_IEMIS→SYMBOL_ASSIGNED, SUBMITTED_TO_IEMIS→CANCELLED)
 *   - 4 idempotent no-ops (one per state)
 *   - 8 illegal transitions (every cell in the matrix marked ❌)
 *
 * Every cell asserted explicitly. ~20 assertions total.
 */

import { describe, expect, it } from '@jest/globals';
import {
  validateTransition,
  getAllowedTransitions,
  isLegalForward,
} from './external-exam-registration.state-machine';

describe('ExternalExamRegistration state machine — 4 legal transitions', () => {
  it('DRAFT → SUBMITTED_TO_IEMIS is legal', () => {
    expect(validateTransition('DRAFT', 'SUBMITTED_TO_IEMIS')).toEqual({ ok: true });
  });

  it('DRAFT → CANCELLED is legal', () => {
    expect(validateTransition('DRAFT', 'CANCELLED')).toEqual({ ok: true });
  });

  it('SUBMITTED_TO_IEMIS → SYMBOL_ASSIGNED is legal', () => {
    expect(validateTransition('SUBMITTED_TO_IEMIS', 'SYMBOL_ASSIGNED')).toEqual({ ok: true });
  });

  it('SUBMITTED_TO_IEMIS → CANCELLED is legal (operator cancel; rare)', () => {
    expect(validateTransition('SUBMITTED_TO_IEMIS', 'CANCELLED')).toEqual({ ok: true });
  });
});

describe('ExternalExamRegistration state machine — 4 idempotent no-ops', () => {
  it('DRAFT → DRAFT is idempotent', () => {
    expect(validateTransition('DRAFT', 'DRAFT')).toEqual({ ok: true, noop: true });
  });

  it('SUBMITTED_TO_IEMIS → SUBMITTED_TO_IEMIS is idempotent', () => {
    expect(validateTransition('SUBMITTED_TO_IEMIS', 'SUBMITTED_TO_IEMIS')).toEqual({
      ok: true,
      noop: true,
    });
  });

  it('SYMBOL_ASSIGNED → SYMBOL_ASSIGNED is idempotent (terminal state can be re-entered)', () => {
    expect(validateTransition('SYMBOL_ASSIGNED', 'SYMBOL_ASSIGNED')).toEqual({
      ok: true,
      noop: true,
    });
  });

  it('CANCELLED → CANCELLED is idempotent (terminal)', () => {
    expect(validateTransition('CANCELLED', 'CANCELLED')).toEqual({ ok: true, noop: true });
  });
});

describe('ExternalExamRegistration state machine — 8 illegal transitions', () => {
  const illegalPairs: Array<[string, string]> = [
    ['DRAFT', 'SYMBOL_ASSIGNED'],
    ['SUBMITTED_TO_IEMIS', 'DRAFT'],
    ['SYMBOL_ASSIGNED', 'DRAFT'],
    ['SYMBOL_ASSIGNED', 'SUBMITTED_TO_IEMIS'],
    ['SYMBOL_ASSIGNED', 'CANCELLED'],
    ['CANCELLED', 'DRAFT'],
    ['CANCELLED', 'SUBMITTED_TO_IEMIS'],
    ['CANCELLED', 'SYMBOL_ASSIGNED'],
  ];

  it.each(illegalPairs)('%s → %s is illegal', (from, to) => {
    expect(validateTransition(from, to)).toEqual({
      ok: false,
      reason: 'illegal_transition',
      from,
      to,
    });
  });
});

describe('ExternalExamRegistration state machine — unknown status guards', () => {
  it('unknown from rejects with reason=unknown_status', () => {
    expect(validateTransition('draft', 'CANCELLED')).toEqual({
      ok: false,
      reason: 'unknown_status',
      from: 'draft',
      to: 'CANCELLED',
    });
  });

  it('unknown to rejects with reason=unknown_status', () => {
    expect(validateTransition('DRAFT', 'SOMETHING_ELSE')).toEqual({
      ok: false,
      reason: 'unknown_status',
      from: 'DRAFT',
      to: 'SOMETHING_ELSE',
    });
  });
});

describe('ExternalExamRegistration state machine — getAllowedTransitions', () => {
  it('DRAFT has 2 outbound transitions', () => {
    const allowed = getAllowedTransitions('DRAFT');
    expect(allowed).toHaveLength(2);
    expect(allowed).toContain('SUBMITTED_TO_IEMIS');
    expect(allowed).toContain('CANCELLED');
  });

  it('SUBMITTED_TO_IEMIS has 2 outbound transitions', () => {
    const allowed = getAllowedTransitions('SUBMITTED_TO_IEMIS');
    expect(allowed).toHaveLength(2);
    expect(allowed).toContain('SYMBOL_ASSIGNED');
    expect(allowed).toContain('CANCELLED');
  });

  it('SYMBOL_ASSIGNED is terminal (no outbound transitions)', () => {
    expect(getAllowedTransitions('SYMBOL_ASSIGNED')).toEqual([]);
  });

  it('CANCELLED is terminal (no outbound transitions)', () => {
    expect(getAllowedTransitions('CANCELLED')).toEqual([]);
  });
});

describe('ExternalExamRegistration state machine — isLegalForward', () => {
  it('returns true for legal forward', () => {
    expect(isLegalForward('DRAFT', 'SUBMITTED_TO_IEMIS')).toBe(true);
  });

  it('returns false for idempotent (NOT a forward — same-state)', () => {
    expect(isLegalForward('DRAFT', 'DRAFT')).toBe(false);
  });

  it('returns false for illegal', () => {
    expect(isLegalForward('SYMBOL_ASSIGNED', 'CANCELLED')).toBe(false);
  });
});
