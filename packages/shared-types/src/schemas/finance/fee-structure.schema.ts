/**
 * Fee Structure Schemas
 *
 * Defines billable items a school charges students.
 * Admin configures these; the system generates invoices from them.
 */

import { z } from 'zod';
import { feeTypeEnum, feeFrequencyEnum, taxTypeEnum, currencyEnum, amountSchema, taxRateSchema, enrollmentTypeEnum } from './common';
import { uuidSchema, isoDateSchema, dateSchema } from '../common';

// ============================================================================
// DUE DATE RULE
// ============================================================================

export const dueDateRuleSchema = z.object({
  type: z.enum(['days_after_enrollment', 'fixed_day_of_month', 'on_enrollment']),
  days: z.number().int().min(1).max(365).optional(),
  dayOfMonth: z.number().int().min(1).max(28).optional(),
});

export type DueDateRule = z.infer<typeof dueDateRuleSchema>;

// ============================================================================
// RESPONSE
// ============================================================================

export const feeStructureResponseSchema = z.object({
  id: uuidSchema,
  schoolId: uuidSchema,
  name: z.string(),
  description: z.string().optional(),
  academicYear: z.string(),
  academicYearId: uuidSchema,
  feeType: feeTypeEnum,
  amount: amountSchema,
  currency: currencyEnum,
  taxRate: z.number().min(0).max(100),
  taxType: taxTypeEnum,
  frequency: feeFrequencyEnum,
  gradeLevels: z.array(z.string()),
  isActive: z.boolean(),
  autoApplyOnEnrollment: z.boolean().optional().default(false),
  proRateOnMidTermEntry: z.boolean().optional(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional().nullable(),
  version: z.number().int().min(1),
  versionParentId: uuidSchema.optional().nullable(),
  templateParentId: uuidSchema.optional().nullable(),
  isOverride: z.boolean().optional().default(false),
  dueDateRule: dueDateRuleSchema.optional().nullable(),
  enrollmentTypes: z.array(enrollmentTypeEnum).optional().default([]),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type FeeStructure = z.infer<typeof feeStructureResponseSchema>;

// ============================================================================
// CREATE
// ============================================================================

export const createFeeStructureSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  academicYear: z.string().min(1).max(20),
  academicYearId: uuidSchema,
  feeType: feeTypeEnum,
  amount: amountSchema.positive('Amount must be greater than 0'),
  currency: currencyEnum.default('NPR'),
  taxRate: taxRateSchema,
  taxType: taxTypeEnum.default('none'),
  frequency: feeFrequencyEnum,
  gradeLevels: z.array(z.string().min(1).max(10)).default([]),
  autoApplyOnEnrollment: z.boolean().optional().default(false),
  proRateOnMidTermEntry: z.boolean().optional().default(false),
  effectiveFrom: dateSchema,
  effectiveTo: dateSchema.optional(),
  dueDateRule: dueDateRuleSchema.optional(),
  enrollmentTypes: z.array(enrollmentTypeEnum).default([]),
});

export type CreateFeeStructureDto = z.infer<typeof createFeeStructureSchema>;

// ============================================================================
// UPDATE
// ============================================================================

export const updateFeeStructureSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  amount: amountSchema.positive('Amount must be greater than 0').optional(),
  taxRate: taxRateSchema.optional(),
  taxType: taxTypeEnum.optional(),
  frequency: feeFrequencyEnum.optional(),
  gradeLevels: z.array(z.string().min(1).max(10)).optional(),
  isActive: z.boolean().optional(),
  autoApplyOnEnrollment: z.boolean().optional(),
  proRateOnMidTermEntry: z.boolean().optional(),
  effectiveFrom: dateSchema.optional(),
  effectiveTo: dateSchema.optional().nullable(),
  dueDateRule: dueDateRuleSchema.optional().nullable(),
  enrollmentTypes: z.array(enrollmentTypeEnum).optional(),
  reason: z.string().max(500).optional(),
});

export type UpdateFeeStructureDto = z.infer<typeof updateFeeStructureSchema>;

// ============================================================================
// FILTER
// ============================================================================

export const feeStructureFilterSchema = z.object({
  feeType: feeTypeEnum.optional(),
  frequency: feeFrequencyEnum.optional(),
  academicYear: z.string().optional(),
  gradeLevel: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  searchTerm: z.string().max(100).optional(),
});

export type FeeStructureFilterDto = z.infer<typeof feeStructureFilterSchema>;
