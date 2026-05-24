/**
 * Promotion Evaluation + Commit Schemas — Sprint D.2.4 + D.2.5 + D.2.6
 *
 * Request/response shapes for the cross-year promotion workflow:
 *   1. D.2.5 batch evaluation endpoint returns suggestions (read-only).
 *   2. Operator reviews suggestions.
 *   3. D.2.6 commit endpoint atomically applies decisions chunked at 100
 *      per TransactWriteItems.
 *
 * The pure-function evaluator (D.2.4) lives in academics service code and
 * uses these schemas for its DTO boundary. Service callers (D.2.5 controller)
 * resolve PromotionRule + Attendance + ResultCard rows by DDB reads before
 * invoking the evaluator (which is pure — zero DDB inside).
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.4 + D.2.5 + D.2.6
 */

import { z } from 'zod';
import { promotionDecisionSchema } from './promotion-rule.schema';

// ============================================
// Retention reason (evaluator output)
// ============================================

/**
 * Why the evaluator suggested 'retained' instead of 'promoted'. Multiple
 * reasons can stack on one enrollment (e.g., both subject_failure AND
 * attendance_failure). `no_terminal_card` fires when the enrollment has
 * no terminal-exam ResultCard yet — operator's decision is then explicitly
 * "needs review."
 */
export const retentionReasonSchema = z.enum([
  'subject_failure',
  'attendance_failure',
  'subjects_required_missing',
  'no_terminal_card',
]);
export type RetentionReason = z.infer<typeof retentionReasonSchema>;

// ============================================
// Per-enrollment evaluation result (D.2.4 output row)
// ============================================

/**
 * The pure-function evaluator's output for ONE enrollment. The D.2.5
 * endpoint returns an array of these, one per enrolment in the (fromAyId,
 * gradeLevel) scope.
 */
export const promotionEvaluationResultSchema = z.object({
  enrollmentId: z.string().uuid(),
  studentId: z.string().uuid(),
  studentName: z.string().optional(),
  eligible: z.boolean(),
  suggestedDecision: promotionDecisionSchema,
  retainedReasons: z.array(retentionReasonSchema),
  details: z.object({
    overallPassedSubjects: z.number().int().min(0),
    overallFailedSubjects: z.number().int().min(0),
    failedSubjectIds: z.array(z.string()),
    attendancePct: z.number().min(0).max(100),
    passingThresholdPct: z.number().min(0).max(100),
    minAttendancePct: z.number().min(0).max(100),
  }),
});
export type PromotionEvaluationResult = z.infer<typeof promotionEvaluationResultSchema>;

// ============================================
// D.2.5 batch evaluation request (query params + optional body)
// ============================================

/**
 * Optional restriction to a subset of enrolments. Empty/absent = evaluate
 * every enrollment in (fromAyId, gradeLevel) on the school.
 */
export const promotionEvaluationRequestSchema = z.object({
  enrollmentIds: z.array(z.string().uuid()).max(500).optional(),
});
export type PromotionEvaluationRequestDto = z.infer<typeof promotionEvaluationRequestSchema>;

// ============================================
// D.2.5 batch evaluation response
// ============================================

export const promotionEvaluationResponseSchema = z.object({
  fromAyId: z.string().uuid(),
  targetAyId: z.string().uuid(),
  gradeLevel: z.string(),
  schoolId: z.string().uuid(),
  evaluatedCount: z.number().int().min(0),
  results: z.array(promotionEvaluationResultSchema),
  /**
   * Cursor for fetching the next page when cohort exceeds the defensive
   * 500-row cap. V1 PABSON sections rarely exceed ~40; cursor is for
   * future-proofing.
   */
  nextCursor: z.string().optional(),
});
export type PromotionEvaluationResponseDto = z.infer<typeof promotionEvaluationResponseSchema>;

// ============================================
// D.2.6 commit request (one decision per enrollment)
// ============================================

/**
 * One row in the commit body. `targetGradeLevel` is required for `promoted`
 * + `conditional` decisions (the target-AY enrollment row needs a gradeLevel);
 * absent for `retained` (no new row created), `graduated`, `withdrawn`,
 * `transferred_out` (those terminate the prior-AY enrolment without creating
 * a new one).
 *
 * `correlationId` is an operator-supplied idempotency key. If supplied,
 * a second commit with the SAME (enrollmentId, correlationId) tuple is a
 * no-op (rather than 409). If absent, retry on already-decided rows returns
 * 409 `PROMOTION_DECISION_LOCKED`.
 */
export const promotionCommitDecisionSchema = z.object({
  enrollmentId: z.string().uuid(),
  decision: promotionDecisionSchema,
  targetGradeLevel: z.string().min(1).max(10).optional(),
  correlationId: z.string().min(1).max(100).optional(),
}).refine(
  (d) => {
    // promoted/conditional REQUIRE targetGradeLevel
    if (d.decision === 'promoted' || d.decision === 'conditional') {
      return d.targetGradeLevel !== undefined;
    }
    return true;
  },
  { message: 'targetGradeLevel is required for promoted/conditional decisions' },
);
export type PromotionCommitDecisionDto = z.infer<typeof promotionCommitDecisionSchema>;

/**
 * Reject duplicate `enrollmentId` within a single commit request. The
 * service layer's idempotency-by-correlationId dedupe (D.2.6 flow step 2)
 * handles cross-request retries, but WITHIN one request the operator can
 * only have ONE decision per enrollment. Catching at the DTO boundary is
 * cheaper than the TransactWriteItems-level ConditionalCheckFailed surface
 * and consistent with the per-row .refine() above.
 */
export const promotionCommitRequestSchema = z.object({
  decisions: z.array(promotionCommitDecisionSchema).min(1).max(500),
}).superRefine((value, ctx) => {
  const seen = new Map<string, number>();
  for (let i = 0; i < value.decisions.length; i++) {
    const id = value.decisions[i].enrollmentId;
    const firstIdx = seen.get(id);
    if (firstIdx !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `duplicate enrollmentId in decisions (also at index ${firstIdx})`,
        path: ['decisions', i, 'enrollmentId'],
      });
    } else {
      seen.set(id, i);
    }
  }
});
export type PromotionCommitRequestDto = z.infer<typeof promotionCommitRequestSchema>;

// ============================================
// D.2.6 commit response (chunked write result)
// ============================================

export const promotionCommitFailureSchema = z.object({
  enrollmentId: z.string().uuid(),
  reason: z.string().min(1),
});

export const promotionCommitResponseSchema = z.object({
  fromAyId: z.string().uuid(),
  targetAyId: z.string().uuid(),
  schoolId: z.string().uuid(),
  committedCount: z.number().int().min(0),
  chunksTotal: z.number().int().min(0),
  chunksSucceeded: z.number().int().min(0),
  failures: z.array(promotionCommitFailureSchema).optional(),
});
export type PromotionCommitResponseDto = z.infer<typeof promotionCommitResponseSchema>;
