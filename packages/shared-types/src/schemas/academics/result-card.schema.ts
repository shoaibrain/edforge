/**
 * ResultCard Schemas — Sprint A.4.2 + A.4.4 + A.4.5
 *
 * Zod schemas for the per-student per-term ResultCard entity (academics).
 *
 * **Architecture: Core Ed-Fi V6 (per `a4-sprint-plan.md` §1.5).**
 *   - `ResultCard` is the Ed-Fi `StudentAcademicRecord` analogue.
 *   - **Keyed by `enrollmentId`** per invariant 3 (carryover from A.3.4).
 *     Preserves cross-AY identity through promotion (D.2.10) rewrites.
 *   - `courseScores[]` denormalizes `academicSubject` descriptor at write
 *     time so render path (C.4.3) + downstream BLE/SEE/NEB import
 *     (D.4.6/D.5.4/D.6.x) can aggregate by subject without re-reading
 *     Course rows.
 *   - `studentId` is resolved from Enrollment AT AGGREGATION TIME (R42
 *     mitigation — A.3 bulk handler may have written `ExamScore.studentId
 *     = 'unknown'`; ResultCard always carries the correct value).
 *
 * **Lifecycle (A.4.5 state machine):**
 *   draft ─→ published (single irreversible transition; terminal in V1).
 *   Re-publish attempt → 409 `RESULT_ALREADY_PUBLISHED` (NOT 200 no-op;
 *   publish is operationally significant per `a4-sprint-plan.md` §8 #5).
 *
 * **Conduct + remarks (A.4.4):**
 *   - PATCH /academics/result-cards/{cardId}/conduct  → body: { conduct }
 *   - PATCH /academics/result-cards/{cardId}/remark   → body: { classTeacherRemark }
 *   Both 409 `RESULT_LOCKED` after publish.
 *
 * **Generation:** ResultCard rows are written by the result-batch Lambda
 * (A.4.3) on `exam.closed` event — there is no operator-facing CREATE
 * endpoint in V1. The Lambda calls `aggregateTermResults()` (pure function,
 * A.4.1) and writes via TransactWriteItems chunked at 100.
 *
 * @see docs/pilot-greenlight/a4-sprint-plan.md §4 A.4.1 – A.4.6
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';
import { academicSubjectSchema } from '../../descriptors/academic-subject';

// ============================================
// Status (state machine — Sprint A.4.5)
// ============================================

/**
 * ResultCard lifecycle. Single irreversible transition `draft → published`.
 * `published` is terminal in V1; un-publish requires inline-policy operator
 * DDB op (pattern (b) per memory `feedback_just_ask_for_a_prod_token`).
 */
export const resultCardStatusSchema = z.enum(['draft', 'published']);
export type ResultCardStatus = z.infer<typeof resultCardStatusSchema>;

/**
 * Tuple of status values. Useful for state-machine spec coverage.
 */
export const RESULT_CARD_STATUSES = resultCardStatusSchema.options;

// ============================================
// Per-course score (nested in ResultCard.courseScores[])
// ============================================

/**
 * One course's aggregated result inside a ResultCard. Denormalizes
 * `academicSubject` from Course (A.2.1) so renderer + downstream
 * importers don't need extra GetItem lookups per row.
 *
 * `grade` + `gpa` are derived from `GradingPolicy.letterGrades[]` (D.1)
 * at aggregation time. `isPassing` + `isTerminalFail` mirror the policy
 * row's flags (per D.1 letterGradeEntrySchema).
 */
export const resultCardCourseScoreSchema = z.object({
  // FKs
  courseId: z.string().uuid(),
  examCourseId: z.string().uuid(),

  // Denormalized descriptor — enables subject-axis aggregation without
  // Course re-reads. Source: Course.academicSubject (A.2.1).
  academicSubject: academicSubjectSchema,

  // Raw inputs (copied from ExamScore at aggregation)
  rawScore: z.number().min(0).max(1000),
  maxMarks: z.number().min(0).max(1000),

  // Derived (from GradingPolicy.letterGrades[]) — A.4.1 aggregation output
  grade: z.string().min(1).max(5),                     // letter, e.g. 'A+', 'NG'
  gpa: z.number().min(0).max(5),                       // letterGradeEntry.gpaPoints
  isPassing: z.boolean(),                              // policy-row flag
  isTerminalFail: z.boolean().optional(),              // CEHRD NG semantics
}).refine(
  (s) => s.rawScore <= s.maxMarks,
  { message: 'rawScore must be ≤ maxMarks', path: ['rawScore'] },
);

export type ResultCardCourseScoreDto = z.infer<typeof resultCardCourseScoreSchema>;

// ============================================
// Conduct PATCH (A.4.4)
// ============================================

/**
 * PATCH /academics/result-cards/{cardId}/conduct.
 * Free-text operator field; capped at 2000 chars.
 */
export const updateResultCardConductSchema = z.object({
  conduct: z.string().min(1).max(2000),
});
export type UpdateResultCardConductDto = z.infer<typeof updateResultCardConductSchema>;

// ============================================
// Remark PATCH (A.4.4)
// ============================================

/**
 * PATCH /academics/result-cards/{cardId}/remark.
 * Class-teacher's narrative remark; capped at 2000 chars.
 */
export const updateResultCardRemarkSchema = z.object({
  classTeacherRemark: z.string().min(1).max(2000),
});
export type UpdateResultCardRemarkDto = z.infer<typeof updateResultCardRemarkSchema>;

// ============================================
// Publish PATCH (A.4.5)
// ============================================

/**
 * PATCH /academics/result-cards/{cardId}/publish.
 * Empty payload by default; optional `notes` for audit-log enrichment
 * (e.g., "published after parent-meeting sign-off").
 *
 * Service-layer guard: 409 RESULT_ALREADY_PUBLISHED on second call;
 * 200 + audit + `result.published` event on first.
 */
export const resultCardPublishSchema = z.object({
  notes: z.string().max(500).optional(),
});
export type ResultCardPublishDto = z.infer<typeof resultCardPublishSchema>;

// ============================================
// Response (GET)
// ============================================

export const resultCardResponseSchema = z.object({
  cardId: z.string().uuid(),
  tenantId: z.string(),
  schoolId: z.string().uuid(),

  // Identity (per invariant 3 — keyed by enrollmentId)
  enrollmentId: z.string().uuid(),
  studentId: z.string().uuid(),                        // resolved at aggregation (R42)

  // Context
  examId: z.string().uuid(),
  termId: z.string().uuid(),
  academicYearId: z.string().uuid(),

  // Aggregated per-course results
  courseScores: z.array(resultCardCourseScoreSchema),

  // Term totals (derived by A.4.1 aggregation)
  totalScore: z.number().min(0),
  totalMaxMarks: z.number().min(0),
  termGpa: z.number().min(0).max(5),
  overallGrade: z.string().min(1).max(5),

  // V1 null; V1.5 computes
  classRank: z.number().int().min(1).nullable().optional(),
  sectionRank: z.number().int().min(1).nullable().optional(),

  // Operator-edited fields (A.4.4)
  conduct: z.string().max(2000).nullable().optional(),
  classTeacherRemark: z.string().max(2000).nullable().optional(),

  // Lifecycle
  status: resultCardStatusSchema,
  publishedAt: isoDateSchema.nullable().optional(),
  publishedBy: z.string().nullable().optional(),

  // Drives C.9.5 cross-year handoff (`result.published.isTerminal`)
  isTerminalExam: z.boolean(),

  // Standard metadata
  isActive: z.boolean(),
  version: z.number().int().min(1),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});

export type ResultCardResponseDto = z.infer<typeof resultCardResponseSchema>;

// ============================================
// List response
// ============================================

export const resultCardListResponseSchema = createPaginatedResponseSchema(
  resultCardResponseSchema,
);
export type ResultCardListResponseDto = z.infer<typeof resultCardListResponseSchema>;

// ============================================
// Filter (LIST query params)
// ============================================

export const resultCardFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  examId: z.string().uuid().optional(),
  termId: z.string().uuid().optional(),
  academicYearId: z.string().uuid().optional(),
  enrollmentId: z.string().uuid().optional(),
  studentId: z.string().uuid().optional(),
  status: resultCardStatusSchema.optional(),
  isTerminalExam: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type ResultCardFilterDto = z.infer<typeof resultCardFilterSchema>;
