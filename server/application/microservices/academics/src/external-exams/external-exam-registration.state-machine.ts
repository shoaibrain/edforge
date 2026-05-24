/**
 * ExternalExamRegistration state machine — Sprint D.3.1 / D.3.6
 *
 * 4-state lifecycle defined in `d3-sprint-plan.md` §4 D.3.1. Canonical
 * breakdown of the 4×4 transition matrix is 4 legal + 4 idempotent +
 * 8 illegal (16 cells total).
 *
 * Concurrency story: legal transitions in D.4 service code MUST be
 * applied via a DDB `attribute_exists(status) AND status = :expected`
 * condition expression in addition to this helper's pre-flight check.
 * The helper rejects bad caller intent; the DDB condition rejects races.
 *
 * Why a separate module from `common/utils/enrollment-state-machine.ts`:
 * the enrollment machine is cross-cutting (touched by 4 services);
 * this registration machine is exam-registration-specific and lives
 * inside the `external-exams/` module per plan §8 #5.
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.1
 */

import {
  ExternalExamRegistrationStatus,
  EXTERNAL_EXAM_REGISTRATION_STATUSES,
} from '@aibrains/shared-types';

/**
 * Valid forward transitions. CANCELLED is reachable from DRAFT or
 * SUBMITTED_TO_IEMIS; from SYMBOL_ASSIGNED a cancel requires a
 * support-flow with audit-trail (not auto-allowed here).
 */
const VALID_TRANSITIONS: Record<ExternalExamRegistrationStatus, Set<ExternalExamRegistrationStatus>> = {
  DRAFT:               new Set(['SUBMITTED_TO_IEMIS', 'CANCELLED']),
  SUBMITTED_TO_IEMIS:  new Set(['SYMBOL_ASSIGNED', 'CANCELLED']),
  SYMBOL_ASSIGNED:     new Set(),
  CANCELLED:           new Set(),
};

export type TransitionResult =
  | { ok: true; noop?: boolean }
  | { ok: false; reason: 'illegal_transition' | 'unknown_status'; from: string; to: string };

/**
 * Validate a transition from `from` to `to`. Same-state is idempotent
 * no-op (returns `{ ok: true, noop: true }`). Legal forward is
 * `{ ok: true }`. Anything else is `{ ok: false, reason, from, to }`.
 *
 * Does not throw — caller decides HTTP status (D.4 controllers).
 */
export function validateTransition(
  from: ExternalExamRegistrationStatus | string,
  to: ExternalExamRegistrationStatus | string,
): TransitionResult {
  if (
    !EXTERNAL_EXAM_REGISTRATION_STATUSES.includes(from as ExternalExamRegistrationStatus) ||
    !EXTERNAL_EXAM_REGISTRATION_STATUSES.includes(to as ExternalExamRegistrationStatus)
  ) {
    return { ok: false, reason: 'unknown_status', from: String(from), to: String(to) };
  }

  if (from === to) {
    return { ok: true, noop: true };
  }

  const allowed = VALID_TRANSITIONS[from as ExternalExamRegistrationStatus];
  if (allowed.has(to as ExternalExamRegistrationStatus)) {
    return { ok: true };
  }
  return { ok: false, reason: 'illegal_transition', from: String(from), to: String(to) };
}

/**
 * Get allowed next states. Returns empty for terminal states
 * (SYMBOL_ASSIGNED, CANCELLED).
 */
export function getAllowedTransitions(
  from: ExternalExamRegistrationStatus,
): ExternalExamRegistrationStatus[] {
  const allowed = VALID_TRANSITIONS[from];
  return Array.from(allowed ?? []);
}

/**
 * Pure introspection: is `to` reachable from `from` in exactly one step
 * (NOT counting idempotent no-ops)?
 */
export function isLegalForward(
  from: ExternalExamRegistrationStatus,
  to: ExternalExamRegistrationStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.has(to) === true;
}
