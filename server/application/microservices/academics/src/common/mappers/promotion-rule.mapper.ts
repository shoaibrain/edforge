/**
 * PromotionRule Mapper — Sprint D.2.1
 *
 * Translates between PromotionRuleEntity (DDB shape) and the
 * `PromotionRuleResponseDto` published by `@aibrains/shared-types`.
 *
 * Defensive backward-compat: legacy rows pre-D.2 do not exist (D.2 is the
 * sprint that introduces this entity), so the mapper is intentionally
 * strict — every field a fresh entity carries is required in the DTO. Any
 * undefined surface from a hand-modified DDB row will produce a clean Zod
 * parse failure on the consumer, not a silent default. No NaN / "" /
 * "unknown" fallbacks.
 */

import type { PromotionRuleEntity } from '../entities/promotion-rule.entity';
import type { PromotionRuleResponseDto } from '@aibrains/shared-types';

export function promotionRuleEntityToDto(
  entity: PromotionRuleEntity,
): PromotionRuleResponseDto {
  return {
    ruleId: entity.ruleId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    gradeLevel: entity.gradeLevel,
    archetypeId: entity.archetypeId,
    passingThresholdPct: entity.passingThresholdPct,
    minAttendancePct: entity.minAttendancePct,
    subjectsRequired: entity.subjectsRequired,
    archetypeDefaulted: entity.archetypeDefaulted,
    description: entity.description,
    isActive: entity.isActive,
    createdAt: entity.createdAt!,
    updatedAt: entity.updatedAt!,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}
