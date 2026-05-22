/**
 * Grading Policy Schemas - Academics Service
 *
 * Zod schemas for grading policy CRUD DTOs.
 * Single source of truth for types previously duplicated in:
 * - Backend: grading-policy.entity.ts, grading-policy.mapper.ts
 * - Frontend: academics.service.ts
 *
 * D.1.1 (2026-05-22) — `gradingScale` field renamed to `letterGrades` and
 * `gpaScale: '4.0' | '5.0'` added. Aligns with ArchetypeDefaults vocabulary
 * (PABSON profile + master-plan §0.3). Old field name still accepted on the
 * write path for one transition cycle; new code always emits `letterGrades`.
 */

import { z } from 'zod';
import {
  letterGradeEntrySchema,
  categoryWeightSchema,
} from './grade.schema';

// ============================================
// GPA Scale
// ============================================

/**
 * Ceiling of the GPA scale. `4.0` for US + Nepal CEHRD; `5.0` for
 * weighted-honors policies. Drives the honors/AP gpa-cap in
 * `gpa-calculator.service.ts` (D.1.4).
 */
export const gpaScaleSchema = z.enum(['4.0', '5.0']);
export type GpaScale = z.infer<typeof gpaScaleSchema>;

// ============================================
// Rounding Rule
// ============================================

export const roundingRuleSchema = z.enum(['up', 'down', 'nearest']);
export type RoundingRule = z.infer<typeof roundingRuleSchema>;

// ============================================
// Create Grading Policy Schema
// ============================================

export const createGradingPolicySchema = z.object({
  schoolId: z.string(),
  policyName: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  gpaScale: gpaScaleSchema,
  letterGrades: z.array(letterGradeEntrySchema).min(1),
  categoryWeights: z.array(categoryWeightSchema),
  dropLowestScores: z.array(z.object({
    categoryId: z.string(),
    count: z.number().int().min(1),
  })).optional(),
  roundingRule: roundingRuleSchema,
  minimumPassingGrade: z.number().min(0).max(100),
  isDefault: z.boolean().optional(),
});
export type CreateGradingPolicyDto = z.infer<typeof createGradingPolicySchema>;

// ============================================
// Update Grading Policy Schema
// ============================================

export const updateGradingPolicySchema = z.object({
  policyName: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  gpaScale: gpaScaleSchema.optional(),
  letterGrades: z.array(letterGradeEntrySchema).min(1).optional(),
  categoryWeights: z.array(categoryWeightSchema).optional(),
  dropLowestScores: z.array(z.object({
    categoryId: z.string(),
    count: z.number().int().min(1),
  })).optional(),
  roundingRule: roundingRuleSchema.optional(),
  minimumPassingGrade: z.number().min(0).max(100).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});
export type UpdateGradingPolicyDto = z.infer<typeof updateGradingPolicySchema>;

// ============================================
// Grading Policy Response Schema
// ============================================

export const gradingPolicyResponseSchema = z.object({
  policyId: z.string(),
  schoolId: z.string(),
  tenantId: z.string().optional(),
  policyName: z.string(),
  description: z.string().optional(),
  gpaScale: gpaScaleSchema,
  letterGrades: z.array(letterGradeEntrySchema),
  categoryWeights: z.array(categoryWeightSchema),
  dropLowestScores: z.array(z.object({
    categoryId: z.string(),
    count: z.number(),
  })).optional(),
  roundingRule: roundingRuleSchema,
  minimumPassingGrade: z.number(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});
export type GradingPolicyResponseDto = z.infer<typeof gradingPolicyResponseSchema>;
