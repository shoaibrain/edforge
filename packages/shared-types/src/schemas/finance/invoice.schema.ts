/**
 * Invoice Schemas
 *
 * Invoices represent bills sent to students/parents.
 * Lifecycle: draft → issued → partially_paid → paid → overdue → cancelled → written_off
 */

import { z } from 'zod';
import { invoiceStatusEnum, currencyEnum, amountOrZeroSchema, taxRateSchema } from './common';
import { uuidSchema, dateSchema } from '../common';

// ============================================================================
// LINE ITEM
// ============================================================================

export const invoiceLineItemSchema = z.object({
  id: uuidSchema,
  feeStructureId: uuidSchema,
  feeStructureVersion: z.number().int().optional(),
  description: z.string(),
  amount: z.number().min(0),
  quantity: z.number().int().min(1).default(1),
  discount: z.number().min(0).default(0),
  discountReason: z.string().optional(),
  taxRate: z.number().min(0).max(100),
  taxType: z.string().optional(),
  taxAmount: z.number().min(0),
  total: z.number(),
});

export const taxSummaryItemSchema = z.object({
  taxType: z.string(),
  taxableAmount: z.number(),
  taxRate: z.number(),
  taxAmount: z.number(),
});

export type InvoiceLineItem = z.infer<typeof invoiceLineItemSchema>;

// ============================================================================
// RESPONSE
// ============================================================================

export const invoiceResponseSchema = z.object({
  id: uuidSchema,
  invoiceNumber: z.string(),
  studentAccountId: uuidSchema,
  studentId: uuidSchema,
  studentName: z.string(),
  schoolId: uuidSchema,
  schoolName: z.string(),
  academicYear: z.string(),
  billingPeriod: z.string().optional(),
  lineItems: z.array(invoiceLineItemSchema),
  subtotal: z.number(),
  taxTotal: z.number(),
  discountTotal: z.number(),
  grandTotal: z.number(),
  amountPaid: z.number(),
  amountDue: z.number(),
  currency: currencyEnum,
  dueDate: z.string(),
  issuedDate: z.string(),
  status: invoiceStatusEnum,
  notes: z.string().optional(),
  taxSummary: z.array(taxSummaryItemSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type Invoice = z.infer<typeof invoiceResponseSchema>;

// ============================================================================
// GENERATE (CREATE)
// ============================================================================

export const generateInvoiceSchema = z.object({
  studentId: uuidSchema,
  academicYear: z.string().min(1).max(20),
  billingPeriod: z.string().max(50).optional(),
  feeStructureIds: z.array(uuidSchema).min(1, 'At least one fee structure required'),
  dueDate: dateSchema,
  notes: z.string().max(500).optional(),
  discounts: z.array(z.object({
    feeStructureId: uuidSchema,
    amount: z.number().positive(),
    reason: z.string().max(200).optional(),
  })).optional(),
});

export type GenerateInvoiceDto = z.infer<typeof generateInvoiceSchema>;

// ============================================================================
// BULK GENERATE
// ============================================================================

export const bulkGenerateInvoiceSchema = z.object({
  studentIds: z.array(uuidSchema).min(1).max(500),
  academicYear: z.string().min(1).max(20),
  billingPeriod: z.string().max(50).optional(),
  feeStructureIds: z.array(uuidSchema).min(1),
  dueDate: dateSchema,
  notes: z.string().max(500).optional(),
});

export type BulkGenerateInvoiceDto = z.infer<typeof bulkGenerateInvoiceSchema>;

// ============================================================================
// UPDATE
// ============================================================================

export const updateInvoiceSchema = z.object({
  status: invoiceStatusEnum.optional(),
  notes: z.string().max(500).optional(),
  dueDate: dateSchema.optional(),
  discounts: z.array(z.object({
    lineItemId: uuidSchema,
    amount: z.number().positive(),
    reason: z.string().max(200).optional(),
  })).optional(),
});

export type UpdateInvoiceDto = z.infer<typeof updateInvoiceSchema>;

// ============================================================================
// FILTER
// ============================================================================

export const invoiceFilterSchema = z.object({
  status: z.union([invoiceStatusEnum, z.array(invoiceStatusEnum)]).optional(),
  studentId: uuidSchema.optional(),
  academicYear: z.string().optional(),
  dueDateFrom: dateSchema.optional(),
  dueDateTo: dateSchema.optional(),
  searchTerm: z.string().max(100).optional(),
});

export type InvoiceFilterDto = z.infer<typeof invoiceFilterSchema>;
