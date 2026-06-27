/**
 * Student Account & Ledger Schemas
 *
 * Tracks a student's financial ledger within a school.
 * One account per student per school.
 *
 * Pilot Onboarding Hardening Sprint PD.0.4 — added optional
 * opening-balance fields (carry-forward of money owed prior to
 * EdForge) + `setOpeningBalanceSchema` request DTO. All new fields
 * are optional → pre-PD consumers parse unchanged (back-compat).
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

  // ──────────────────────────────────────────────────────────────────────────
  // Pilot Onboarding Hardening Sprint PD — opening-balance snapshot
  // ──────────────────────────────────────────────────────────────────────────
  // All four are sparse: pre-PD accounts omit them entirely. The
  // entity stores only the CURRENT effective opening balance; the
  // FULL revision history is reconstructible from the audit trail
  // (`finance.opening_balance.*` events). `openingBalanceRemaining`
  // is server-computed = openingBalance − Σ(payment allocations
  // against opening balance) so consumers don't reinvent the math.
  /** Current effective opening balance (after any revisions). NPR or tenant currency. */
  openingBalance: z.number().nonnegative().optional(),
  /** AD `YYYY-MM-DD` — operator's stated "as of" date. */
  openingBalanceAsOf: z.string().optional(),
  /** Operator-supplied free text (≤ 500 chars). */
  openingBalanceNote: z.string().max(500).optional(),
  /** Server-computed: openingBalance − settledAgainstOpening. */
  openingBalanceRemaining: z.number().nonnegative().optional(),
});

export type BillingAccount = z.infer<typeof billingAccountResponseSchema>;

// ============================================================================
// SET OPENING BALANCE — PUT request DTO (PD.1.5)
// ============================================================================

/**
 * Request body for `PUT /finance/schools/:schoolId/billing-accounts/:accountId/opening-balance`.
 *
 * IMPORTANT (CLAUDE.md zod-pin rule): use `z.string().date()` here. The
 * `z.iso.date()` API is v4-only and this repo is pinned to zod 3.24.4
 * for AdminWeb webpack-bundle reasons. Do NOT "modernize" to z.iso.
 *
 * Validation:
 *   - amount must be non-negative (V1; advance credits use credit-note flow)
 *   - asOf must parse as YYYY-MM-DD AND be ≤ today (operator can't set
 *     a future "as of" date)
 *   - note ≤ 500 chars
 */
export const setOpeningBalanceSchema = z
  .object({
    amount: z.number().nonnegative().max(10_000_000),
    asOf: z.string().date(),
    note: z.string().max(500).optional(),
  })
  .superRefine((dto, ctx) => {
    // asOf must be <= today (operator cannot project opening balance
    // into the future — that's not how a carry-forward works).
    const today = new Date().toISOString().slice(0, 10);
    if (dto.asOf > today) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['asOf'],
        message: `asOf must be on or before today (${today}); got ${dto.asOf}`,
      });
    }
  });

export type SetOpeningBalanceDto = z.infer<typeof setOpeningBalanceSchema>;

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
