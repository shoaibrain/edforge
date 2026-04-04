/**
 * Credit Note Schemas
 *
 * Scholarships, grants, refund credits, fee waivers, adjustments.
 */

import { z } from 'zod';
import { currencyEnum, amountSchema } from './common';
import { uuidSchema, dateSchema } from '../common';

export const creditNoteTypeEnum = z.enum([
  'scholarship', 'grant', 'refund', 'adjustment', 'fee_waiver',
]);
export type CreditNoteType = z.infer<typeof creditNoteTypeEnum>;

export const creditNoteStatusEnum = z.enum([
  'active', 'applied', 'expired', 'cancelled',
]);
export type CreditNoteStatus = z.infer<typeof creditNoteStatusEnum>;

export const creditNoteResponseSchema = z.object({
  id: uuidSchema,
  studentAccountId: uuidSchema,
  studentId: uuidSchema,
  schoolId: uuidSchema,
  amount: amountSchema,
  remainingAmount: amountSchema,
  currency: currencyEnum,
  type: creditNoteTypeEnum,
  description: z.string(),
  fundingSource: z.string().optional(),
  appliedToInvoices: z.array(z.object({
    invoiceId: uuidSchema,
    amount: z.number().min(0),
    appliedAt: z.string(),
  })).default([]),
  status: creditNoteStatusEnum,
  effectiveDate: z.string(),
  expiryDate: z.string().optional().nullable(),
  approvedBy: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type CreditNote = z.infer<typeof creditNoteResponseSchema>;

export const createCreditNoteSchema = z.object({
  studentId: uuidSchema,
  amount: amountSchema.positive('Amount must be greater than 0'),
  currency: currencyEnum.default('NPR'),
  type: creditNoteTypeEnum,
  description: z.string().min(1).max(500),
  fundingSource: z.string().max(200).optional(),
  effectiveDate: dateSchema,
  expiryDate: dateSchema.optional(),
});

export type CreateCreditNoteDto = z.infer<typeof createCreditNoteSchema>;

export const applyCreditNoteSchema = z.object({
  invoiceId: uuidSchema,
  amount: amountSchema.positive('Amount must be greater than 0'),
});

export type ApplyCreditNoteDto = z.infer<typeof applyCreditNoteSchema>;
