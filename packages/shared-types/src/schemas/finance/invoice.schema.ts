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
// STATUS HISTORY
// ============================================================================

export const statusHistoryEntrySchema = z.object({
  from: z.string(),
  to: z.string(),
  changedAt: z.string(),
  changedBy: z.string(),
  reason: z.string().optional(),
});

export type StatusHistoryEntry = z.infer<typeof statusHistoryEntrySchema>;

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
  enrollmentId: uuidSchema.optional(),
  /**
   * Sprint A.1 — snapshot grade level at issue time. Populated from
   * `dto.gradeLevel` (admin override) → `studentInfo.gradeLevel`
   * (default). Survives student promotion so historical accounting
   * filtering stays stable.
   *
   * Undefined when the snapshot resolution failed; consumers can
   * inspect `gradeLevelResolutionStatus` to distinguish "snapshot
   * tried and student had no grade" from "pre-A.1 row with no
   * snapshot attempt."
   */
  gradeLevel: z.string().optional(),
  /**
   * Sprint A.1 — companion to `gradeLevel`.
   *   - `'resolved'`   — gradeLevel snapshot succeeded (dto OR studentInfo)
   *   - `'unresolved'` — both sources empty; gradeLevel undefined; row
   *                      surfaces in the upcoming "Unknown" filter
   *                      bucket (Sprint B.1)
   *   - undefined      — pre-A.1 row; not yet backfilled
   */
  gradeLevelResolutionStatus: z.enum(['resolved', 'unresolved']).optional(),
  statusHistory: z.array(statusHistoryEntrySchema).optional(),
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
  autoIssue: z.boolean().optional(),
  issuedDate: dateSchema.optional(),
  enrollmentId: z.string().optional(),
  gradeLevel: z.string().optional(),
});

export type GenerateInvoiceDto = z.infer<typeof generateInvoiceSchema>;

// ============================================================================
// BULK GENERATE
// ============================================================================

// Bulk Ops Sprint C.1 — discriminated union over `selectionMode`. Backward-
// compatible with the legacy flat `studentIds` shape (no discriminator)
// via a 3-way z.union, so existing clients keep working while new clients
// migrate to the tagged shapes.
//
// Two operator-facing modes:
//   - `students` — flat studentIds[]. Existing wizard "By Student" tab.
//   - `grades` — gradeLevels[] (or ['ALL']) → resolved server-side to
//     studentIds via the academics API (Sprint C.3 helper). Powers the
//     new wizard "By Grade" tab.
const bulkBaseFields = {
  academicYear: z.string().min(1).max(20),
  billingPeriod: z.string().max(50).optional(),
  feeStructureIds: z.array(uuidSchema).min(1),
  dueDate: dateSchema,
  notes: z.string().max(500).optional(),
};

const bulkByStudentsSchema = z.object({
  selectionMode: z.literal('students'),
  studentIds: z.array(uuidSchema).min(1).max(5000),
  ...bulkBaseFields,
});

const bulkByGradesSchema = z.object({
  selectionMode: z.literal('grades'),
  /**
   * Either canonical grade codes (e.g. ['4','5']) or the single
   * literal `['ALL']` meaning "every grade level enabled at this
   * school". Resolved at the service boundary (Sprint C.3).
   */
  gradeLevels: z.array(z.string().min(1).max(20)).min(1),
  ...bulkBaseFields,
});

const bulkLegacyFlatSchema = z.object({
  // No `selectionMode` discriminator — pre-Sprint-C shape. Accepted
  // for backward compatibility; the service normalizes to
  // `selectionMode: 'students'` on receipt. New frontends should send
  // the tagged shape directly.
  studentIds: z.array(uuidSchema).min(1).max(500),
  ...bulkBaseFields,
});

export const bulkGenerateInvoiceSchema = z.union([
  bulkByStudentsSchema,
  bulkByGradesSchema,
  bulkLegacyFlatSchema,
]);

export type BulkGenerateInvoiceDto = z.infer<typeof bulkGenerateInvoiceSchema>;
export type BulkGenerateByStudentsDto = z.infer<typeof bulkByStudentsSchema>;
export type BulkGenerateByGradesDto = z.infer<typeof bulkByGradesSchema>;

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
