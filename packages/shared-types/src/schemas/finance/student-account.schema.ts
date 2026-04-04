/**
 * Student Account & Ledger Schemas
 *
 * Tracks a student's financial ledger within a school.
 * One account per student per school.
 */

import { z } from 'zod';
import { ledgerEntryTypeEnum } from './common';
import { uuidSchema } from '../common';

// ============================================================================
// STUDENT ACCOUNT RESPONSE
// ============================================================================

export const billingAccountResponseSchema = z.object({
  id: uuidSchema,
  studentId: uuidSchema,
  schoolId: uuidSchema,
  studentName: z.string(),
  balance: z.number(),
  totalPaid: z.number(),
  lastPaymentDate: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type BillingAccount = z.infer<typeof billingAccountResponseSchema>;

// ============================================================================
// STUDENT ACCOUNT FILTER
// ============================================================================

export const studentAccountFilterSchema = z.object({
  studentId: uuidSchema.optional(),
  hasOutstandingBalance: z.coerce.boolean().optional(),
  searchTerm: z.string().max(100).optional(),
});

export type StudentAccountFilterDto = z.infer<typeof studentAccountFilterSchema>;

// ============================================================================
// LEDGER ENTRY
// ============================================================================

export const studentLedgerEntrySchema = z.object({
  id: uuidSchema,
  studentAccountId: uuidSchema,
  entryType: ledgerEntryTypeEnum,
  referenceId: z.string(),
  description: z.string(),
  debit: z.number().min(0),
  credit: z.number().min(0),
  balance: z.number(),
  date: z.string(),
  createdAt: z.string(),
});

export type StudentLedgerEntry = z.infer<typeof studentLedgerEntrySchema>;
