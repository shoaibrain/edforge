/**
 * Enrollment Status State Machine
 *
 * Defines valid transitions between enrollment statuses.
 * Based on Ed-Fi StudentSchoolAssociation lifecycle:
 * - enrolled → withdrawn, transferred, graduated, suspended, expelled
 * - pending → enrolled, withdrawn (cancelled)
 * - suspended → enrolled (reinstated), withdrawn, expelled
 * - provisional → enrolled (Sprint D.2.10 flip), withdrawn (operator delete pre-flip)
 * - withdrawn/transferred/graduated/expelled → no outbound transitions (terminal)
 *
 * Sprint D.2.8 — `provisional` is the AY2 row created by D.2.6 commit;
 * D.2.10 flips it to `enrolled` on terminal `result.published`. `provisional`
 * is NOT a target of any other transition: `enrolled → provisional` and
 * `pending → provisional` are rejected (provisional rows are created
 * directly via the commit path, never transitioned to).
 */

import { EnrollmentStatus } from '../entities/base.entity';

/**
 * Valid status transitions map.
 * Key = current status, Value = set of allowed next statuses.
 */
const VALID_TRANSITIONS: Record<string, Set<string>> = {
  pending:     new Set(['enrolled', 'withdrawn']),
  enrolled:    new Set(['withdrawn', 'transferred', 'graduated', 'suspended', 'expelled']),
  active:      new Set(['withdrawn', 'transferred', 'graduated', 'suspended', 'expelled']),
  provisional: new Set(['enrolled', 'withdrawn']),
  suspended:   new Set(['enrolled', 'withdrawn', 'expelled']),
  // Terminal states - no outbound transitions
  withdrawn:   new Set(),
  transferred: new Set(),
  graduated:   new Set(),
  expelled:    new Set(),
  completed:   new Set(),
};

/**
 * Check if a status transition is valid.
 */
export function isValidTransition(from: EnrollmentStatus, to: EnrollmentStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return false;
  return allowed.has(to);
}

/**
 * Get allowed next statuses for a given current status.
 */
export function getAllowedTransitions(from: EnrollmentStatus): EnrollmentStatus[] {
  const allowed = VALID_TRANSITIONS[from];
  if (!allowed) return [];
  return Array.from(allowed) as EnrollmentStatus[];
}

/**
 * Validate a status transition, throwing BadRequestException-compatible message if invalid.
 */
export function validateTransition(from: EnrollmentStatus, to: EnrollmentStatus): void {
  if (!isValidTransition(from, to)) {
    const allowed = getAllowedTransitions(from);
    const allowedStr = allowed.length > 0 ? allowed.join(', ') : 'none (terminal state)';
    throw new Error(
      `Invalid enrollment status transition: ${from} → ${to}. Allowed transitions from '${from}': ${allowedStr}`
    );
  }
}
