/**
 * ExternalExamResult schemas — Sprint D.3.4
 *
 * One row per (registrationId) carrying the per-course breakdown of an
 * external-exam outcome. The `courseResults[]` entries are typed via the
 * existing `gradeLetterSchema` from D.1 (free string `max(5)` — D.4.6
 * service-layer asserts the letter is in the school's active
 * `GradingPolicy.letterGrades[].letter` set, NOT this schema).
 *
 * **Ed-Fi V6 alignment:** `edforge:StudentExternalAssessment` (analogous
 * to `StudentAssessment` + `StudentAssessmentScoreResult[]`).
 *
 * **`isSupplementary` semantics:** per-courseResult flag (NOT per-row).
 * A student can supplement 1 of 3 NG subjects and pass the others
 * outright; per-entry flag captures that nuance.
 *
 * **`overallStatus` derivation:** stored as denormalized enum (written
 * at D.4.6 / D.5.x / D.6.x time, NOT computed on read). Re-derivation
 * after a supplementary import is the caller's responsibility.
 *
 * **GSI plan:**
 *   - GSI1: `gsi1pk='TENANT#{tid}#SCHOOL#{schoolId}'`,
 *           `gsi1sk='EXT_RESULT#{examType}#{resultId}'`
 *   - GSI2 cross-AY: `gsi2pk='TENANT#{tid}#ENROLLMENT#{enrollmentId}'`,
 *           `gsi2sk='EXT_RESULT#{examType}'`
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.4
 */

import { z } from 'zod';
import { examTypeSchema } from './external-exam-shared.schema';
import { academicSubjectSchema } from '../../descriptors/academic-subject';
import { gradeLetterSchema } from './grade.schema';

// ============================================
// External-exam per-course result entry
// ============================================

export const externalExamCourseResultSchema = z.object({
  courseId: z.string().uuid(),
  /** Denormalized from `Course.academicSubject` at write time. */
  academicSubject: academicSubjectSchema,
  /**
   * Free string `max(5)` per D.1 (`gradeLetterSchema`). Includes `'NG'`
   * (Not Graded) per D.4.0 + D.5.0 research. Runtime check against the
   * school's `GradingPolicy.letterGrades[].letter` is service-layer
   * (D.4.6 / D.5.x / D.6.x), NOT schema.
   */
  letterGrade: gradeLetterSchema,
  /** 4.0 (or 5.0) scale per `GradingPolicy.gpaScale`. */
  gpaPoints: z.number().min(0).max(5),
  /** Sum across InternalAssessment rows for this (registration, course). */
  internalScore: z.number().min(0).optional(),
  /** Imported from authority ledger. */
  externalScore: z.number().min(0).optional(),
  /** True iff this row was overwritten by D.4.7 / D.5.4 / D.6.5 supplementary import. */
  isSupplementary: z.boolean().default(false),
});
export type ExternalExamCourseResultDto = z.infer<typeof externalExamCourseResultSchema>;

// ============================================
// Overall status (denormalized at write time by D.4.6 / D.5.x / D.6.x)
// ============================================

export const externalExamOverallStatusSchema = z.enum([
  'passed',
  'failed',
  'failed_with_supplementary_eligible',
]);
export type ExternalExamOverallStatus = z.infer<typeof externalExamOverallStatusSchema>;

export const EXTERNAL_EXAM_OVERALL_STATUSES = externalExamOverallStatusSchema.options;

// ============================================
// Create ExternalExamResult schema
// ============================================

export const createExternalExamResultSchema = z.object({
  registrationId: z.string().uuid(),
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  examType: examTypeSchema,
  /** ≥1 entry, ≤15 (sanity cap; BLE = 9, NEB-XII = 7, 15 is generous through V1.5). */
  courseResults: z.array(externalExamCourseResultSchema).min(1).max(15),
  /** NEB-11/12 only; BLE/SEE leave undefined. */
  cumulativeGpa: z.number().min(0).max(5).optional(),
  overallStatus: externalExamOverallStatusSchema,
  importedAt: z.string(),
});
export type CreateExternalExamResultDto = z.infer<typeof createExternalExamResultSchema>;

// ============================================
// Update schema (D.4.7 supplementary overwrite + D.4.6 status re-derivation)
// ============================================

export const updateExternalExamResultSchema = z.object({
  courseResults: z.array(externalExamCourseResultSchema).min(1).max(15).optional(),
  cumulativeGpa: z.number().min(0).max(5).optional(),
  overallStatus: externalExamOverallStatusSchema.optional(),
});
export type UpdateExternalExamResultDto = z.infer<typeof updateExternalExamResultSchema>;

// ============================================
// Response schema
// ============================================

export const externalExamResultResponseSchema = z.object({
  resultId: z.string().uuid(),
  registrationId: z.string().uuid(),
  studentId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string().uuid(),
  examType: examTypeSchema,
  courseResults: z.array(externalExamCourseResultSchema).min(1).max(15),
  cumulativeGpa: z.number().min(0).max(5).nullable().optional(),
  overallStatus: externalExamOverallStatusSchema,
  importedAt: z.string(),
  createdAt: z.string(),
  createdBy: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string(),
});
export type ExternalExamResultResponseDto = z.infer<typeof externalExamResultResponseSchema>;
