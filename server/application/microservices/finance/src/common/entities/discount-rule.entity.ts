/**
 * Discount Rule Entity
 *
 * PK: tenantId
 * SK: DISCOUNT_RULE#{schoolId}#{discountRuleId}
 * GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI1SK: DISCOUNT_RULE#{priority}#{name}
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';
import type { FeeType } from '@aibrains/shared-types';

export interface DiscountConditionData {
  type: 'sibling' | 'early_payment' | 'scholarship' | 'staff_child' | 'manual';
  minSiblings?: number;
  daysBefore?: number;
  scholarshipId?: string;
}

export interface DiscountRuleEntity extends BaseEntity {
  entityType: 'DISCOUNT_RULE';
  discountRuleId: string;
  schoolId: string;
  academicYearId: string;
  name: string;
  description?: string;
  type: 'percentage' | 'fixed';
  value: number;
  applicableFeeTypes: FeeType[];
  condition: DiscountConditionData;
  priority: number;
  isActive: boolean;
  maxDiscountAmount?: number;
  gsi1pk: string;
  gsi1sk: string;
}

export function createDiscountRuleEntity(
  tenantId: string,
  schoolId: string,
  data: {
    academicYearId: string;
    name: string;
    description?: string;
    type: 'percentage' | 'fixed';
    value: number;
    applicableFeeTypes: FeeType[];
    condition: DiscountConditionData;
    priority?: number;
    maxDiscountAmount?: number;
  },
  userId: string,
): DiscountRuleEntity {
  const discountRuleId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: `DISCOUNT_RULE#${schoolId}#${discountRuleId}`,
    entityType: 'DISCOUNT_RULE' as any,
    discountRuleId,
    schoolId,
    academicYearId: data.academicYearId,
    name: data.name,
    description: data.description,
    type: data.type,
    value: data.value,
    applicableFeeTypes: data.applicableFeeTypes,
    condition: data.condition,
    priority: data.priority ?? 0,
    isActive: true,
    maxDiscountAmount: data.maxDiscountAmount,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `DISCOUNT_RULE#${String(data.priority ?? 0).padStart(3, '0')}#${data.name.toUpperCase()}`,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
