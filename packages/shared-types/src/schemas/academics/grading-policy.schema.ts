/**
 * Grading Policy Schemas - Academics Service
 *
 * Zod schemas for grading policy CRUD DTOs.
 * Single source of truth for types previously duplicated in:
 * - Backend: grading-policy.entity.ts, grading-policy.mapper.ts
 * - Frontend: academics.service.ts
 */

import { z } from 'zod';
import {
  gradingScaleEntrySchema,
  categoryWeightSchema,
} from './grade.schema';

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
  gradingScale: z.array(gradingScaleEntrySchema).min(1),
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
  gradingScale: z.array(gradingScaleEntrySchema).min(1).optional(),
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
  gradingScale: z.array(gradingScaleEntrySchema),
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
