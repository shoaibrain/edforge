/**
 * Exam Schemas — Sprint A.3.2 + A.3.10
 *
 * Zod schemas for the term-end Exam entity (academics).
 *
 * **Architecture: Core Ed-Fi V6 (per `a3-sprint-plan.md` §1.5).**
 *   - `Exam` is the canonical Ed-Fi `Assessment` analogue. Archetype-blind
 *     at this layer; the `examType` enum value's membership for a given
 *     school is constrained by `archetypeDefaults[archetype].examPattern`
 *     read at validation time (NOT at schema-definition time).
 *   - `examPatternKeySchema` is reused from `archetype-defaults.schema.ts`
 *     (Sprint 0.4) — no duplicate enum.
 *
 * **Distinct from existing `Grade` entity:** Grade represents per-student
 * per-course per-term marks for classwork / daily-grading flow. Exam (this
 * entity) represents the structured term-end exam with its own state
 * machine (draft → scheduled → in_progress → closed → published). They
 * coexist; Grade stays for non-exam grading.
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.2 + A.3.5 + A.3.8
 */

import { z } from 'zod';
import { isoDateSchema, dateSchema, createPaginatedResponseSchema } from '../common';
import { examPatternKeySchema } from '../archetype-defaults.schema';

// ============================================
// Exam status (state machine — Sprint A.3.8)
// ============================================

/**
 * Exam lifecycle state.
 *
 * Transitions (A.3.8 state machine):
 *   draft ⇄ scheduled → in_progress → closed → published (terminal in V1)
 *
 * Back-edges allowed: scheduled→draft (un-schedule), in_progress→scheduled (postpone).
 * All other transitions return 409 EXAM_STATE_INVALID_TRANSITION.
 *
 * **`published` is terminal in V1.** Un-publish requires operator-led
 * inline-policy DDB ops (pattern (b) per memory `feedback_just_ask_for_a_prod_token`).
 */
export const examStatusSchema = z.enum([
  'draft',
  'scheduled',
  'in_progress',
  'closed',
  'published',
]);
export type ExamStatus = z.infer<typeof examStatusSchema>;

/**
 * Tuple of all status values. Useful for state-machine spec coverage.
 */
export const EXAM_STATUSES = examStatusSchema.options;

// ============================================
// Create Exam
// ============================================

/**
 * Create-exam DTO. Service-layer validates:
 *   - schoolId exists (Identity service call)
 *   - termId references a real Term for the school + academicYearId
 *   - examType ∈ archetypeDefaults[tenant.archetype].examPattern (read at runtime)
 *   - startDate ≤ endDate
 */
export const createExamSchema = z.object({
  examName: z.string().min(2).max(200),
  schoolId: z.string().uuid(),
  academicYearId: z.string().uuid(),
  termId: z.string().uuid(),

  // Term-level exam cadence — enum constrained at the global level here;
  // per-archetype subset enforced server-side from archetypeDefaults.examPattern.
  examType: examPatternKeySchema,

  // YYYY-MM-DD; exam-day granularity is sufficient (no time-of-day).
  startDate: dateSchema,
  endDate: dateSchema,

  description: z.string().max(2000).optional(),
}).refine(
  (e) => new Date(e.startDate).getTime() <= new Date(e.endDate).getTime(),
  { message: 'startDate must be on or before endDate', path: ['endDate'] },
);

export type CreateExamDto = z.infer<typeof createExamSchema>;

// ============================================
// Update Exam (partial; immutable fields omitted)
// ============================================

/**
 * Update-exam DTO. Immutable after creation: `schoolId`, `academicYearId`,
 * `termId` (operator must DELETE + recreate to change context). `examType`
 * is mutable while `status === 'draft'`; service guards otherwise.
 *
 * Status transitions go through the dedicated `PATCH /exams/:examId/status`
 * endpoint (A.3.8), NOT this generic PATCH.
 */
export const updateExamSchema = z.object({
  examName: z.string().min(2).max(200).optional(),
  examType: examPatternKeySchema.optional(),
  startDate: dateSchema.optional(),
  endDate: dateSchema.optional(),
  description: z.string().max(2000).optional(),
});

export type UpdateExamDto = z.infer<typeof updateExamSchema>;

// ============================================
// Status transition (A.3.8 dedicated endpoint)
// ============================================

/**
 * Payload for `PATCH /exams/:examId/status`. Operator targets a status;
 * service validates the transition against the state-machine util.
 */
export const examStatusTransitionSchema = z.object({
  targetStatus: examStatusSchema,
  // Audit-log enrichment; operator can record why they transitioned (e.g.
  // "exam postponed due to weather").
  notes: z.string().max(500).optional(),
});

export type ExamStatusTransitionDto = z.infer<typeof examStatusTransitionSchema>;

// ============================================
// Exam response
// ============================================

export const examResponseSchema = z.object({
  examId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string(),

  examName: z.string(),
  academicYearId: z.string().uuid(),
  termId: z.string().uuid(),

  examType: examPatternKeySchema,
  startDate: dateSchema,
  endDate: dateSchema,
  status: examStatusSchema,

  description: z.string().optional(),
  // Denormalized read-side convenience: sum of ExamCourse.maxMarks at the
  // most recent write. NOT auto-recomputed; operator can refresh via PATCH.
  totalMaxMarks: z.number().min(0).max(10_000).optional(),

  // Status tracking
  isActive: z.boolean(),
  version: z.number().int().min(1),

  // Metadata
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type ExamResponseDto = z.infer<typeof examResponseSchema>;

// ============================================
// List response
// ============================================

export const examListResponseSchema = createPaginatedResponseSchema(examResponseSchema);
export type ExamListResponseDto = z.infer<typeof examListResponseSchema>;

// ============================================
// Filter
// ============================================

export const examFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  termId: z.string().uuid().optional(),
  examType: examPatternKeySchema.optional(),
  status: examStatusSchema.optional(),
  startDateFrom: dateSchema.optional(),
  startDateTo: dateSchema.optional(),
  isActive: z.boolean().optional(),
  searchTerm: z.string().max(100).optional(),
});

export type ExamFilterDto = z.infer<typeof examFilterSchema>;
