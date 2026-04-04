/**
 * Discount Rule Schemas
 *
 * Rules for automatic and manual discounts:
 * sibling discounts, early payment, scholarships, staff child, manual.
 */

import { z } from 'zod';
import { feeTypeEnum, currencyEnum, amountSchema } from './common';
import { uuidSchema } from '../common';

export const discountConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('sibling'), minSiblings: z.number().int().min(2).default(2) }),
  z.object({ type: z.literal('early_payment'), daysBefore: z.number().int().min(1) }),
  z.object({ type: z.literal('scholarship'), scholarshipId: z.string().min(1) }),
  z.object({ type: z.literal('staff_child') }),
  z.object({ type: z.literal('manual') }),
]);

export type DiscountCondition = z.infer<typeof discountConditionSchema>;

export const discountRuleResponseSchema = z.object({
  id: uuidSchema,
  schoolId: uuidSchema,
  academicYearId: uuidSchema,
  name: z.string(),
  description: z.string().optional(),
  type: z.enum(['percentage', 'fixed']),
  value: z.number().min(0),
  applicableFeeTypes: z.array(feeTypeEnum),
  condition: discountConditionSchema,
  priority: z.number().int().min(0).default(0),
  isActive: z.boolean(),
  maxDiscountAmount: z.number().min(0).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type DiscountRule = z.infer<typeof discountRuleResponseSchema>;

export const createDiscountRuleSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  academicYearId: uuidSchema,
  type: z.enum(['percentage', 'fixed']),
  value: z.number().min(0),
  applicableFeeTypes: z.array(feeTypeEnum).min(1),
  condition: discountConditionSchema,
  priority: z.number().int().min(0).default(0),
  maxDiscountAmount: z.number().min(0).optional(),
}).refine(
  (data) => data.type !== 'percentage' || data.value <= 100,
  { message: 'Percentage discount value cannot exceed 100', path: ['value'] },
);

export type CreateDiscountRuleDto = z.infer<typeof createDiscountRuleSchema>;

export const updateDiscountRuleSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  type: z.enum(['percentage', 'fixed']).optional(),
  value: z.number().min(0).optional(),
  applicableFeeTypes: z.array(feeTypeEnum).optional(),
  condition: discountConditionSchema.optional(),
  priority: z.number().int().min(0).optional(),
  isActive: z.boolean().optional(),
  maxDiscountAmount: z.number().min(0).optional().nullable(),
}).refine(
  (data) => data.type !== 'percentage' || data.value === undefined || data.value <= 100,
  { message: 'Percentage discount value cannot exceed 100', path: ['value'] },
);

export type UpdateDiscountRuleDto = z.infer<typeof updateDiscountRuleSchema>;
