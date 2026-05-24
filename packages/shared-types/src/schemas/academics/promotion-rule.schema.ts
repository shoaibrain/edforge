/**
 * PromotionRule Schemas — Sprint D.2.1
 *
 * Zod schemas for the per-(school, gradeLevel) PromotionRule entity that
 * governs the academic-year rollover decision (promoted / retained / etc.).
 *
 * **Architecture: Core Ed-Fi V6 + Edges (per `d2-sprint-plan.md` §1.5).**
 *   - `PromotionRule` is the Ed-Fi V6 extension entity `edforge:PromotionPolicy`
 *     analogue. Core (archetype-blind) entity.
 *   - Defaults come from `archetypeDefaults[archetype].promotionDefaults`
 *     (PABSON: 35% pass / 80% attendance) — Edge data.
 *   - Service layer reads PromotionRule rows; never branches on
 *     `tenant.archetype` (invariant 12).
 *
 * **Lazy-seed pattern (D.2.3):**
 *   First GET `/academics/promotion-rules?schoolId=…&gradeLevel=…` that
 *   returns empty triggers `ensureDefaultRule()` which writes a row with
 *   `archetypeDefaulted=true`. Mirrors D.1.3 `ensureDefaultPolicy`.
 *   First PATCH clears `archetypeDefaulted` to false (operator-edited).
 *
 * **Write-once semantics on consumer side:**
 *   PromotionRule itself is mutable (operator can PATCH `passingThresholdPct`
 *   etc.). The write-once field is `Enrollment.promotionDecision` (D.2.7).
 *
 * **Soft-delete via `isActive`:**
 *   DELETE flips `isActive=false`; the row stays in DDB for audit traceability.
 *   Active-only query filter applied at controller layer.
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.1 + D.2.2 + D.2.3
 * @see packages/shared-types/src/archetype/archetype-defaults.ts (PABSON.promotionDefaults)
 */

import { z } from 'zod';
import { isoDateSchema, createPaginatedResponseSchema } from '../common';
import { academicSubjectSchema } from '../../descriptors/academic-subject';

// ============================================
// Promotion decision (write-once on Enrollment per D.2.7)
// ============================================

/**
 * Decision outcomes recorded on the source-AY Enrollment row by D.2.6 commit.
 *
 *   - `promoted`        — student advances to target-AY enrollment (provisional)
 *   - `retained`        — student stays in same grade; no new AY enrollment created
 *   - `conditional`     — V1 treats as `promoted` operationally; probation workflow is V1.5
 *                          (per `d2-sprint-plan.md` §8 #7)
 *   - `graduated`       — student exits the gradeLadder at the archetype's final grade
 *                          (e.g., PABSON Grade 12 NEB). Source enrollment status → `graduated`
 *   - `withdrawn`       — operator withdraws student during promotion review
 *   - `transferred_out` — operator marks transfer to another school
 */
export const promotionDecisionSchema = z.enum([
  'promoted',
  'retained',
  'conditional',
  'graduated',
  'withdrawn',
  'transferred_out',
]);
export type PromotionDecision = z.infer<typeof promotionDecisionSchema>;

export const PROMOTION_DECISIONS = promotionDecisionSchema.options;

// ============================================
// Create PromotionRule schema
// ============================================

export const createPromotionRuleSchema = z.object({
  schoolId: z.string().uuid(),
  gradeLevel: z.string().min(1).max(10),
  archetypeId: z.string().min(1).max(40),
  passingThresholdPct: z.number().min(0).max(100),
  minAttendancePct: z.number().min(0).max(100),
  subjectsRequired: z.array(academicSubjectSchema).default([]),
  description: z.string().max(1000).optional(),
});
export type CreatePromotionRuleDto = z.infer<typeof createPromotionRuleSchema>;

// ============================================
// Update PromotionRule schema
// ============================================

/**
 * Partial update. Note: `schoolId`, `gradeLevel`, `archetypeId` are NOT
 * patchable — those are identity fields. To change scope, soft-delete the
 * row and create a fresh one.
 */
export const updatePromotionRuleSchema = z.object({
  passingThresholdPct: z.number().min(0).max(100).optional(),
  minAttendancePct: z.number().min(0).max(100).optional(),
  subjectsRequired: z.array(academicSubjectSchema).optional(),
  description: z.string().max(1000).optional(),
  isActive: z.boolean().optional(),
});
export type UpdatePromotionRuleDto = z.infer<typeof updatePromotionRuleSchema>;

// ============================================
// PromotionRule response schema
// ============================================

export const promotionRuleResponseSchema = z.object({
  ruleId: z.string().uuid(),
  schoolId: z.string().uuid(),
  tenantId: z.string(),
  gradeLevel: z.string(),
  archetypeId: z.string(),
  passingThresholdPct: z.number(),
  minAttendancePct: z.number(),
  subjectsRequired: z.array(academicSubjectSchema),
  /**
   * True if the row was written by the D.2.3 lazy-seed path AND has not
   * yet been operator-edited. Flipped to false on the first PATCH (D.2.2).
   * Drives the AdminWeb "Default" badge.
   */
  archetypeDefaulted: z.boolean(),
  description: z.string().optional(),
  isActive: z.boolean(),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  createdBy: z.string().optional(),
  updatedBy: z.string().optional(),
});
export type PromotionRuleResponseDto = z.infer<typeof promotionRuleResponseSchema>;

// ============================================
// Paginated list response
// ============================================

export const promotionRuleListResponseSchema = createPaginatedResponseSchema(
  promotionRuleResponseSchema,
);
export type PromotionRuleListResponseDto = z.infer<typeof promotionRuleListResponseSchema>;

// ============================================
// Filter schema (LIST endpoint)
// ============================================

export const promotionRuleFilterSchema = z.object({
  schoolId: z.string().uuid().optional(),
  gradeLevel: z.string().min(1).max(10).optional(),
  archetypeId: z.string().min(1).max(40).optional(),
  isActive: z.boolean().optional(),
});
export type PromotionRuleFilterDto = z.infer<typeof promotionRuleFilterSchema>;
