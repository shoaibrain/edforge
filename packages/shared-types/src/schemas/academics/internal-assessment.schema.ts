/**
 * InternalAssessment schemas — Sprint D.3.2
 *
 * Per-(student × course × rubricCategory × examType) score row. Captures
 * the internal-50% portion of an external exam. The archetype-defaulted
 * internal-weight (e.g. PABSON-BLE 50%) is applied at aggregation time
 * by D.4.6 / D.5.x / D.6.x — NOT at the entity layer. D.3 stores raw
 * `score` + `maxScore` only.
 *
 * **Ed-Fi V6 alignment:** `edforge:InternalAssessmentScore` (analogous to
 * a component portion of Ed-Fi `StudentAssessmentScoreResult`).
 *
 * **State machine — `DRAFT → LOCKED_FOR_IEMIS`** (one-way at the helper
 * level). IEMIS-rejection unlock flow is D.4.3 service-layer with a
 * dedicated PATCH carrying `supportFlowReason` audit field.
 *
 * **GSI plan:**
 *   - GSI1: `gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}'`,
 *           `gsi1sk='INT_ASSESS#{registrationId}#{assessmentId}'`
 *   - GSI2 cross-AY: `gsi2pk='TENANT#{tid}#ENROLLMENT#{enrollmentId}'`,
 *           `gsi2sk='INT_ASSESS#{examType}#{courseId}'`
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.2
 */

import { z } from 'zod';
import { examTypeSchema } from './external-exam-shared.schema';

export const internalAssessmentStatusSchema = z.enum(['DRAFT', 'LOCKED_FOR_IEMIS']);
export type InternalAssessmentStatus = z.infer<typeof internalAssessmentStatusSchema>;

export const INTERNAL_ASSESSMENT_STATUSES = internalAssessmentStatusSchema.options;

// ============================================
// Create InternalAssessment schema
// ============================================

export const createInternalAssessmentSchema = z
  .object({
    registrationId: z.string().uuid(),
    studentId: z.string().uuid(),
    enrollmentId: z.string().uuid(),
    schoolId: z.string().uuid(),
    examType: examTypeSchema,
    courseId: z.string().uuid(),
    rubricCategoryId: z.string().uuid(),
    score: z.number().min(0),
    maxScore: z.number().min(0),
    enteredBy: z.string().min(1).max(80),
    enteredAt: z.string(),
  })
  .superRefine((val, ctx) => {
    if (val.score > val.maxScore) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['score'],
        message: 'score must be ≤ maxScore',
      });
    }
  });
export type CreateInternalAssessmentDto = z.infer<typeof createInternalAssessmentSchema>;

// ============================================
// Update schema (status transition + correction)
// ============================================

export const updateInternalAssessmentSchema = z
  .object({
    status: internalAssessmentStatusSchema.optional(),
    score: z.number().min(0).optional(),
    /**
     * Operator-only audit field for D.4.3 IEMIS-rejection unlock flow.
     * D.3 carries the shape; D.4.3 enforces "required when status flips
     * LOCKED_FOR_IEMIS → DRAFT".
     */
    supportFlowReason: z.string().max(500).optional(),
  });
export type UpdateInternalAssessmentDto = z.infer<typeof updateInternalAssessmentSchema>;

// ============================================
// Response schema
// ============================================

export const internalAssessmentResponseSchema = z.object({
  assessmentId: z.string().uuid(),
  registrationId: z.string().uuid(),
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string().uuid(),
  examType: examTypeSchema,
  courseId: z.string().uuid(),
  rubricCategoryId: z.string().uuid(),
  score: z.number().min(0),
  maxScore: z.number().min(0),
  status: internalAssessmentStatusSchema,
  enteredBy: z.string().min(1).max(80),
  enteredAt: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type InternalAssessmentResponseDto = z.infer<typeof internalAssessmentResponseSchema>;
