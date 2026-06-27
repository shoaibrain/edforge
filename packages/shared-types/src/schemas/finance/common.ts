/**
 * Finance Domain — Common Enums & Base Types
 *
 * Shared across fee-structure, invoice, payment, student-account,
 * and payment-gateway schemas.
 */

import { z } from 'zod';

// ============================================================================
// FEE ENUMS
// ============================================================================

/** Fee categories aligned with Nepal school fee taxonomy */
export const feeTypeEnum = z.enum([
  'tuition',
  'admission',
  'exam',
  'transport',
  'library',
  'lab',
  'hostel',
  'uniform',
  'miscellaneous',
  'custom',
]);
export type FeeType = z.infer<typeof feeTypeEnum>;

/** How often the fee is charged */
export const feeFrequencyEnum = z.enum([
  'one_time',
  'monthly',
  'quarterly',
  'annual',
]);
export type FeeFrequency = z.infer<typeof feeFrequencyEnum>;

// ============================================================================
// ENROLLMENT ENUMS
// ============================================================================

/** Enrollment types for fee applicability filtering */
export const enrollmentTypeEnum = z.enum(['new_admission', 'transfer', 'returning', 're_enrollment']);
export type FeeEnrollmentType = z.infer<typeof enrollmentTypeEnum>;

// ============================================================================
// TAX ENUMS
// ============================================================================

/** Nepal tax registration types */
export const taxTypeEnum = z.enum(['PAN', 'VAT', 'none']);
export type TaxType = z.infer<typeof taxTypeEnum>;

// ============================================================================
// INVOICE ENUMS
// ============================================================================

/** Invoice lifecycle: draft → issued → partially_paid → paid → overdue → cancelled → written_off */
export const invoiceStatusEnum = z.enum([
  'draft',
  'issued',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
  'written_off',
]);
export type InvoiceStatus = z.infer<typeof invoiceStatusEnum>;

// ============================================================================
// PAYMENT ENUMS
// ============================================================================

/** Payment lifecycle: pending → processing → completed | failed | cancelled → refunded */
export const paymentStatusEnum = z.enum([
  'pending',
  'processing',
  'completed',
  'failed',
  'cancelled',
  'refunded',
  'partially_refunded',
]);
export type PaymentStatus = z.infer<typeof paymentStatusEnum>;

/** Supported payment gateways */
export const paymentGatewayEnum = z.enum([
  'esewa',
  'khalti',
  'fonepay',
  'connectips',
  'stripe',
  'cash',
  'bank_transfer',
  'cheque',
]);
export type PaymentGateway = z.infer<typeof paymentGatewayEnum>;

/** Manual (offline) payment methods that don't require gateway redirect */
export const OFFLINE_GATEWAYS: ReadonlySet<PaymentGateway> = new Set([
  'cash',
  'bank_transfer',
  'cheque',
]);

// ============================================================================
// LEDGER ENUMS
// ============================================================================

/**
 * `opening_balance` — carry-forward of money owed prior to EdForge.
 * Set once via `StudentAccountsService.setOpeningBalance` at BillingAccount
 * setup (Pilot Onboarding Hardening Sprint PD.1). Revisions emit `'adjustment'`
 * entries; never overwritten. Preserves append-only ledger semantics.
 */
export const ledgerEntryTypeEnum = z.enum([
  'invoice',
  'payment',
  'refund',
  'adjustment',
  'write_off',
  'opening_balance',
]);
export type LedgerEntryType = z.infer<typeof ledgerEntryTypeEnum>;

// ============================================================================
// CURRENCY
// ============================================================================

/** Supported currencies (extensible without breaking change) */
export const currencyEnum = z.enum(['NPR', 'USD', 'INR', 'GBP', 'AUD', 'CAD']);
export type Currency = z.infer<typeof currencyEnum>;

/** Positive monetary amount (NPR, max 10 million) */
export const amountSchema = z.number().min(0).max(10_000_000);

/** Monetary amount that can be zero (max 10 million) */
export const amountOrZeroSchema = z.number().min(0).max(10_000_000);

/** Tax rate as percentage (0–100) */
export const taxRateSchema = z.number().min(0).max(100).default(0);

/** Discount amount (non-negative, max 10 million) */
export const discountAmountSchema = z.number().min(0).max(10_000_000).default(0);
