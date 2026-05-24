/**
 * ExternalExamRetake schemas — Sprint D.3.5
 *
 * Grade-Increment retake row. BLE supplementary (D.4.7) + NEB Grade-12
 * (D.6.5) both write to this entity. Eligibility rule (BLE: NG ≤3
 * subjects per D.4.0 §7.2) is service-layer; the entity itself accepts
 * any number of courses in `courses[]`.
 *
 * **Ed-Fi V6 alignment:** `edforge:ExternalAssessmentRetake` — no clean
 * Ed-Fi analogue; modeled as own entity with FK back to original result.
 *
 * **State machine:** `REGISTERED → SAT → RESULT_IMPORTED` (forward only)
 * with `* → CANCELLED` allowed at any non-terminal state. D.3 ships the
 * enum; the transition validator (if needed) is D.4.7 / D.6.5 scope.
 *
 * **GSI plan:**
 *   - GSI1: `gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}'`,
 *           `gsi1sk='EXT_RETAKE#{retakeId}'`
 *   - GSI2 cross-AY: `gsi2pk='TENANT#{tid}#ENROLLMENT#{enrollmentId}'`,
 *           `gsi2sk='EXT_RETAKE#{examType}'`
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.5
 */

import { z } from 'zod';
import { examTypeSchema } from './external-exam-shared.schema';

export const externalExamRetakeStatusSchema = z.enum([
  'REGISTERED',
  'SAT',
  'RESULT_IMPORTED',
  'CANCELLED',
]);
export type ExternalExamRetakeStatus = z.infer<typeof externalExamRetakeStatusSchema>;

export const EXTERNAL_EXAM_RETAKE_STATUSES = externalExamRetakeStatusSchema.options;

// ============================================
// Create ExternalExamRetake schema
// ============================================

export const createExternalExamRetakeSchema = z.object({
  originalResultId: z.string().uuid(),
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  examType: examTypeSchema,
  /** ≥1 entry, ≤15 (same sanity cap as ExternalExamResult.courseResults). */
  courses: z.array(z.string().uuid()).min(1).max(15),
  retakeDate: z.string(),
  /** Optional municipality-set retake fee (NPR). */
  fee: z.number().min(0).optional(),
});
export type CreateExternalExamRetakeDto = z.infer<typeof createExternalExamRetakeSchema>;

// ============================================
// Update schema (state transitions)
// ============================================

export const updateExternalExamRetakeSchema = z.object({
  status: externalExamRetakeStatusSchema.optional(),
  fee: z.number().min(0).optional(),
});
export type UpdateExternalExamRetakeDto = z.infer<typeof updateExternalExamRetakeSchema>;

// ============================================
// Response schema
// ============================================

export const externalExamRetakeResponseSchema = z.object({
  retakeId: z.string().uuid(),
  originalResultId: z.string().uuid(),
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string().uuid(),
  examType: examTypeSchema,
  courses: z.array(z.string().uuid()).min(1).max(15),
  retakeDate: z.string(),
  fee: z.number().min(0).nullable().optional(),
  status: externalExamRetakeStatusSchema,
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type ExternalExamRetakeResponseDto = z.infer<typeof externalExamRetakeResponseSchema>;
