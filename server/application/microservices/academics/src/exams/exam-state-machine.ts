/**
 * Exam State Machine — Sprint A.3.8
 *
 * Pure-function state machine for Exam.status lifecycle. Service code calls
 * `validateTransition(currentStatus, targetStatus)` before writing the new
 * status. Idempotent no-op (current === target) returns `{ valid: true,
 * isNoOp: true }` so callers can short-circuit without 409.
 *
 * **State graph (V1):**
 *
 *   draft ⇄ scheduled → in_progress → closed → published (terminal)
 *
 *   Back-edges:
 *     scheduled → draft   (operator un-schedules)
 *     in_progress → scheduled  (operator postpones)
 *
 * All other transitions return `{ valid: false }` and the service issues
 * 409 EXAM_STATE_INVALID_TRANSITION.
 *
 * **`published` is terminal in V1.** Un-publish requires operator-led
 * inline-policy DDB ops (out of scope; V1.5 enhancement candidate).
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.8
 */

import type { ExamStatus } from '@aibrains/shared-types';

/**
 * Result of a transition validation call.
 */
export interface TransitionResult {
  /** Whether the transition is permitted. */
  valid: boolean;
  /** True when current === target (operator re-sent same status). */
  isNoOp: boolean;
  /** Human-readable reason when `valid === false`. */
  reason?: string;
}

/**
 * Allowed-transition table. Each key is the CURRENT status; the array
 * lists target statuses that are permitted from it.
 */
export const ALLOWED_EXAM_TRANSITIONS: Readonly<Record<ExamStatus, ReadonlyArray<ExamStatus>>> = {
  draft: ['scheduled'],
  scheduled: ['draft', 'in_progress'],
  in_progress: ['scheduled', 'closed'],
  closed: ['published'],
  published: [], // terminal
};

/**
 * Validate a status transition.
 *
 * - Returns `{ valid: true, isNoOp: true }` when current === target
 *   (operator re-sent the same status). Service responds 200 with no
 *   state change + no audit row + no event (no-op idempotency).
 * - Returns `{ valid: true, isNoOp: false }` when the transition is in
 *   ALLOWED_EXAM_TRANSITIONS. Service writes new status + audit + event.
 * - Returns `{ valid: false, reason }` otherwise. Service responds 409
 *   EXAM_STATE_INVALID_TRANSITION with `reason` in the error detail.
 */
export function validateTransition(
  currentStatus: ExamStatus,
  targetStatus: ExamStatus,
): TransitionResult {
  if (currentStatus === targetStatus) {
    return { valid: true, isNoOp: true };
  }
  const allowed = ALLOWED_EXAM_TRANSITIONS[currentStatus];
  if (allowed.includes(targetStatus)) {
    return { valid: true, isNoOp: false };
  }
  return {
    valid: false,
    isNoOp: false,
    reason: `transition ${currentStatus} → ${targetStatus} not allowed (legal next states from ${currentStatus}: ${allowed.length === 0 ? '<terminal>' : allowed.join(', ')})`,
  };
}

/**
 * Returns true when the given status accepts ExamScore writes.
 * Service-layer guard called by exam-scores.service before persisting.
 *
 * Per master plan A.3.7:
 *   - draft: rejected with EXAM_NOT_SCHEDULED
 *   - scheduled / in_progress: accepted
 *   - closed / published: rejected with EXAM_LOCKED
 */
export function acceptsScoreWrites(status: ExamStatus): boolean {
  return status === 'scheduled' || status === 'in_progress';
}

/**
 * Returns true when the given status accepts ExamCourse additions.
 * Operator can add/remove ExamCourses only while Exam is mutable.
 *
 * Per master plan A.3.6: draft + scheduled accept ExamCourse mutations;
 * in_progress / closed / published reject.
 */
export function acceptsExamCourseMutations(status: ExamStatus): boolean {
  return status === 'draft' || status === 'scheduled';
}

/**
 * Returns true when the exam is soft-deleted (`isActive === false`).
 *
 * Soft-delete is a terminal tombstone: no mutation path (rename, transition,
 * exam-course add/remove, score record/bulk/update) may touch a tombstoned
 * exam. The result-batch Lambda also refuses to generate ResultCards for one.
 * Null-safe so callers can pass a possibly-absent exam uniformly; a missing
 * exam is handled by the caller's own not-found guard, not treated as a
 * tombstone here. Soft-delete is the explicit `isActive: false`; a row with
 * `isActive` absent is treated as active (matches the Lambda's filter).
 */
export function isExamTombstoned(
  exam: { isActive?: boolean } | null | undefined,
): boolean {
  return !!exam && exam.isActive === false;
}
