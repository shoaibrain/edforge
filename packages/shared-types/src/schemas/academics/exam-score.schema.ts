/**
 * ExamScore Schemas — Sprint A.3.4 + A.3.7 + A.3.9 + A.3.10
 *
 * Zod schemas for individual exam-score entries (per student per
 * ExamCourse) and bulk-write payload.
 *
 * **Architecture: Core Ed-Fi V6 (per `a3-sprint-plan.md` §1.5).**
 *   - `ExamScore` is the Ed-Fi `StudentAssessmentScoreResult` analogue.
 *   - **Keyed by `enrollmentId`, NOT `(studentId, examId)`** per invariant 3.
 *     Preserves cross-year integrity: when grade-promotion (D.2.10) rewrites
 *     enrollment, ExamScore stays bound to the prior-AY enrollment.
 *   - `0 ≤ rawScore ≤ ExamCourse.maxMarks` invariant enforced server-side
 *     at write time (this schema only enforces `rawScore ≥ 0`; max is dynamic).
 *
 * **Bulk write (A.3.9):** chunked at 100 per DDB TransactWriteItems limit.
 * Operator supplies `correlationId` for idempotent retries. Same correlationId
 * + same set of (examCourseId, enrollmentId) tuples → safe re-POST.
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.4 + A.3.7 + A.3.9 + A.3.10
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';

// ============================================
// Constants — chunking + bulk limits
// ============================================

/**
 * DDB TransactWriteItems hard limit. Each bulk-score chunk = 1 transaction.
 */
export const EXAM_SCORE_BULK_CHUNK_SIZE = 100;

/**
 * Maximum total scores per bulk request (2.5 chunks). Larger payloads are
 * rejected at the schema layer with `BULK_PAYLOAD_TOO_LARGE` — operator
 * splits and retries with distinct correlationIds.
 */
export const EXAM_SCORE_BULK_MAX_TOTAL = 250;

// ============================================
// ExamScore status (per-row lifecycle)
// ============================================

/**
 * Per-row status. `entered` allows operator updates; `locked` rejects
 * further PATCH (set by Exam state machine when parent Exam closes).
 */
export const examScoreStatusSchema = z.enum(['entered', 'locked']);
export type ExamScoreStatus = z.infer<typeof examScoreStatusSchema>;

// ============================================
// Single-score create
// ============================================

/**
 * Create-exam-score DTO. Service-layer validates:
 *   - examCourseId exists + parent Exam.status ∈ {scheduled, in_progress}
 *     (rejects with EXAM_NOT_SCHEDULED for draft, EXAM_LOCKED for closed/published)
 *   - enrollmentId exists + active in the school
 *   - rawScore ≤ ExamCourse.maxMarks (dynamic; not checked at schema layer)
 */
export const createExamScoreSchema = z.object({
  examCourseId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  // Min only at schema layer; ExamCourse.maxMarks bound enforced server-side.
  rawScore: z.number().min(0).max(1000),
  // Optional correlation marker (single writes can opt-in to track origin;
  // bulk writes always carry it).
  correlationId: z.string().uuid().optional(),
});

export type CreateExamScoreDto = z.infer<typeof createExamScoreSchema>;

// ============================================
// Single-score update
// ============================================

/**
 * Update-exam-score DTO. Allowed while ExamScore.status === 'entered'
 * (parent Exam still ∈ {scheduled, in_progress}). Service returns 409
 * SCORE_LOCKED on `status === 'locked'`.
 */
export const updateExamScoreSchema = z.object({
  rawScore: z.number().min(0).max(1000).optional(),
});

export type UpdateExamScoreDto = z.infer<typeof updateExamScoreSchema>;

// ============================================
// Bulk write (A.3.9)
// ============================================

/**
 * Bulk payload — operator submits up to 250 scores across an Exam.
 * Service chunks at 100 per DDB transaction.
 *
 * Idempotency: re-POST with same `correlationId` + same (examCourseId,
 * enrollmentId) tuples → safe (returns `{alreadyProcessed: true, ...}`).
 * Partial-match scenarios → 409 BULK_PARTIAL_RETRY_NOT_SUPPORTED;
 * operator splits and retries cleanly with new correlationIds.
 */
export const bulkExamScoreSchema = z.object({
  correlationId: z.string().uuid({
    message: 'correlationId must be a valid UUID',
  }),
  scores: z.array(
    z.object({
      examCourseId: z.string().uuid(),
      enrollmentId: z.string().uuid(),
      rawScore: z.number().min(0).max(1000),
    }),
  )
    .min(1, { message: 'scores array must contain at least 1 entry' })
    .max(EXAM_SCORE_BULK_MAX_TOTAL, {
      message: `scores array exceeds bulk maximum (${EXAM_SCORE_BULK_MAX_TOTAL})`,
    }),
});

export type BulkExamScoreDto = z.infer<typeof bulkExamScoreSchema>;

// ============================================
// Bulk-write response
// ============================================

/**
 * Bulk-write response shape. `chunks[]` carries per-chunk results so
 * operator can identify partial failures + retry targeted chunks.
 */
export const bulkExamScoreResponseSchema = z.object({
  correlationId: z.string().uuid(),
  examId: z.string().uuid(),
  totalScores: z.number().int().min(0),
  totalCreated: z.number().int().min(0),
  totalSkipped: z.number().int().min(0), // idempotent re-write
  totalFailed: z.number().int().min(0),
  chunks: z.array(z.object({
    chunkIndex: z.number().int().min(0),
    chunkSize: z.number().int().min(0),
    status: z.enum(['ok', 'idempotent_skip', 'failed']),
    failureReason: z.string().optional(),
  })),
  alreadyProcessed: z.boolean(), // true if correlationId fully matched
});

export type BulkExamScoreResponseDto = z.infer<typeof bulkExamScoreResponseSchema>;

// ============================================
// Single-score response
// ============================================

export const examScoreResponseSchema = z.object({
  examScoreId: z.string().uuid(),
  examId: z.string().uuid(),
  examCourseId: z.string().uuid(),
  enrollmentId: z.string().uuid(),

  // Denormalized for audit + downstream query convenience
  schoolId: z.string().uuid(),
  tenantId: z.string(),
  studentId: z.string().uuid(),

  rawScore: z.number(),
  status: examScoreStatusSchema,

  correlationId: z.string().uuid().optional(),

  enteredBy: z.string(),
  enteredAt: isoDateSchema,

  version: z.number().int().min(1),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
});

export type ExamScoreResponseDto = z.infer<typeof examScoreResponseSchema>;

// ============================================
// List response
// ============================================

export const examScoreListResponseSchema = createPaginatedResponseSchema(
  examScoreResponseSchema,
);
export type ExamScoreListResponseDto = z.infer<typeof examScoreListResponseSchema>;

// ============================================
// Filter
// ============================================

export const examScoreFilterSchema = z.object({
  examId: z.string().uuid().optional(),
  examCourseId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  status: examScoreStatusSchema.optional(),
  correlationId: z.string().uuid().optional(),
});

export type ExamScoreFilterDto = z.infer<typeof examScoreFilterSchema>;
