/**
 * RubricCategory schemas — Sprint D.3.0
 *
 * Per-(school, examType) rubric category row (e.g. PABSON-BLE 4 categories:
 * unitTests / projectWork / participation / subjectActivities). Holds the
 * weight % of each category within the internal-assessment portion of an
 * external exam. Aggregation engine (D.4.6 / D.5.x / D.6.x) consumes these
 * to compute the internal-50% portion from `InternalAssessment` rows.
 *
 * **Architecture (per `d3-sprint-plan.md` §1.5):**
 *   - Core (archetype-blind). `examType` is the discriminator.
 *   - Seed rows are archetype-specific (Edge) — D.4.2 / D.5.x / D.6.x seed
 *     per-archetype × examType pairings via the lazy-seed pattern (mirror
 *     D.1.3 / D.2.3). D.3 ships shape only.
 *   - `academicSubject?` is the A.2.1 `AcademicSubjectDescriptor` enum.
 *     Undefined = "applies to all subjects" (e.g. participation, conduct).
 *
 * **Ed-Fi V6 alignment:** `edforge:AssessmentItemRubric` (entity-extension
 * namespace; analogous to Ed-Fi `AssessmentReportingMethod` +
 * `LearningStandardItem` combined).
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.0
 */

import { z } from 'zod';
import { examTypeSchema } from './external-exam-shared.schema';
import { academicSubjectSchema } from '../../descriptors/academic-subject';
import { isoDateSchema } from '../common';

// ============================================
// Create RubricCategory schema
// ============================================

export const createRubricCategorySchema = z.object({
  schoolId: z.string().uuid(),
  examType: examTypeSchema,
  /** Undefined = "applies to all subjects" (e.g. participation, conduct). */
  academicSubject: academicSubjectSchema.optional(),
  categoryName: z.string().min(1).max(80),
  /** % of internal-assessment total (0-100). Aggregation engine asserts categories sum ≤100 per examType. */
  weight: z.number().min(0).max(100),
  /** FK to archetype-defaults seed origin (audit trail; set by lazy-seed, cleared on operator PATCH). */
  archetypeDefaultId: z.string().max(80).optional(),
  /** Free-text link to CDC rubric publication. URL validation deferred to V1.5. */
  cdcReference: z.string().max(500).optional(),
});
export type CreateRubricCategoryDto = z.infer<typeof createRubricCategorySchema>;

// ============================================
// Update RubricCategory schema
// ============================================

/**
 * Partial update. Identity fields (`schoolId`, `examType`,
 * `academicSubject`, `categoryName`) are NOT patchable — to rescope, soft-
 * delete + create fresh.
 */
export const updateRubricCategorySchema = z.object({
  weight: z.number().min(0).max(100).optional(),
  cdcReference: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
});
export type UpdateRubricCategoryDto = z.infer<typeof updateRubricCategorySchema>;

// ============================================
// Response schema
// ============================================

export const rubricCategoryResponseSchema = z.object({
  categoryId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string().uuid(),
  examType: examTypeSchema,
  academicSubject: academicSubjectSchema.nullable().optional(),
  categoryName: z.string().min(1).max(80),
  weight: z.number().min(0).max(100),
  archetypeDefaultId: z.string().max(80).nullable().optional(),
  archetypeDefaulted: z.boolean(),
  cdcReference: z.string().max(500).nullable().optional(),
  isActive: z.boolean(),
  createdAt: isoDateSchema,
  createdBy: z.string(),
  updatedAt: isoDateSchema,
  updatedBy: z.string(),
});
export type RubricCategoryResponseDto = z.infer<typeof rubricCategoryResponseSchema>;
