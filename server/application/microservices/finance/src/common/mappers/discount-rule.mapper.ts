import { DiscountRuleEntity } from '../entities/discount-rule.entity';
import type { DiscountRule } from '@aibrains/shared-types';

export function discountRuleEntityToDto(entity: DiscountRuleEntity): DiscountRule {
  return {
    id: entity.discountRuleId,
    schoolId: entity.schoolId,
    academicYearId: entity.academicYearId,
    name: entity.name,
    description: entity.description,
    type: entity.type,
    value: entity.value,
    applicableFeeTypes: entity.applicableFeeTypes,
    condition: entity.condition as DiscountRule['condition'],
    priority: entity.priority,
    isActive: entity.isActive,
    maxDiscountAmount: entity.maxDiscountAmount,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
