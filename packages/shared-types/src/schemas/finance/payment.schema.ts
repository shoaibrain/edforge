/**
 * Payment & Receipt Schemas
 *
 * Gateway-agnostic payment types supporting eSewa, Khalti, and manual methods.
 * The frontend NEVER handles gateway credentials — all secrets stay server-side.
 *
 * Payment lifecycle: pending → processing → completed | failed | cancelled → refunded
 */

import { z } from 'zod';
import { paymentStatusEnum, paymentGatewayEnum, currencyEnum } from './common';
import { uuidSchema } from '../common';

// ============================================================================
// REFUND
// ============================================================================

export const refundResponseSchema = z.object({
  id: uuidSchema,
  paymentId: uuidSchema,
  amount: z.number().positive(),
  reason: z.string(),
  gatewayRefundId: z.string().optional(),
  status: z.enum(['pending', 'completed', 'failed']),
  refundedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type Refund = z.infer<typeof refundResponseSchema>;

// ============================================================================
// PAYMENT RESPONSE
// ============================================================================

/**
 * Pilot Onboarding Hardening Sprint PD.2.1 — per-target allocation
 * breakdown. Discriminated union: an invoice application carries an
 * invoiceId; an opening-balance application doesn't. Sum of
 * `applications[].amount` MUST equal the parent payment's `amount`.
 *
 * V1 invariants (see entity-side JSDoc on `PaymentApplication` for
 * the full contract):
 *   - applications.length ≥ 1
 *   - at most 1 of each targetType
 *   - invoice entry, if present, appears FIRST (ledger ordering)
 *   - sum invariant
 *
 * Pre-PD payments omit `applications` entirely.
 */
export const paymentApplicationSchema = z.discriminatedUnion('targetType', [
  z.object({
    targetType: z.literal('invoice'),
    invoiceId: uuidSchema,
    amount: z.number().positive().max(10_000_000),
  }),
  z.object({
    targetType: z.literal('opening_balance'),
    amount: z.number().positive().max(10_000_000),
  }),
]);

export type PaymentApplication = z.infer<typeof paymentApplicationSchema>;

export const paymentResponseSchema = z.object({
  id: uuidSchema,
  invoiceId: uuidSchema,
  studentAccountId: uuidSchema,
  schoolId: uuidSchema,
  amount: z.number().positive(),
  currency: currencyEnum,
  gateway: paymentGatewayEnum,
  gatewayTransactionId: z.string().optional(),
  gatewaySessionId: z.string().optional(),
  status: paymentStatusEnum,
  paidAt: z.string().nullable(),
  paidBy: z.string().nullable(),
  receiptNumber: z.string().nullable(),
  metadata: z.record(z.unknown()).default({}),
  refunds: z.array(refundResponseSchema).default([]),
  studentName: z.string().optional(),
  invoiceNumber: z.string().optional(),
  /**
   * Sprint A.2 — snapshot from parent invoice's gradeLevel at
   * payment-creation time. Denormalized so list-by-grade queries
   * (Sprint B.2) hit GSI14 without joining back to the invoice row
   * on every read. Snapshot semantics — never updated on student
   * promotion, same as invoice.gradeLevel.
   */
  gradeLevel: z.string().optional(),
  /**
   * Sprint A.2 — companion to `gradeLevel`. Same semantics as on
   * Invoice (resolved | unresolved | undefined-for-pre-A.2-rows).
   */
  gradeLevelResolutionStatus: z.enum(['resolved', 'unresolved']).optional(),
  /**
   * Pilot PD.2.1 — per-target allocation breakdown (invoice + opening).
   * Sparse: pre-PD payments + V1 single-invoice payments may omit.
   */
  applications: z.array(paymentApplicationSchema).optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).superRefine((p, ctx) => {
  // Pilot PD.2 schema-level application invariants.
  //
  // Pre-Phase-C the invariants below were enforced ONLY by
  // `PaymentsService.recordManualPayment`'s pre-allocation math. Any
  // future caller, DDB row, or replayed payload that bypassed that
  // path could violate them silently — downstream readers (mapper,
  // PDF renderer, finance dashboard, void/refund paths) would then
  // produce inconsistent numbers, mis-attribute receipts, or fail
  // to settle the right invoice portion on void.
  //
  // The four invariants are codified in the entity-side JSDoc on
  // `PaymentApplication` + `PaymentEntity.applications`. This guard
  // catches violations at the deserialization boundary.
  if (!p.applications || p.applications.length === 0) return;

  // SPEC-14 — Σ(applications.amount) === payment.amount.
  // 1-cent tolerance for minor float-precision drift on integer-NPR
  // pilot amounts; tighten to exact equality if/when amounts adopt a
  // decimal type.
  const sum = p.applications.reduce((s, a) => s + a.amount, 0);
  if (Math.abs(sum - p.amount) > 0.01) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applications'],
      message:
        `Sum of applications[].amount (${sum}) must equal payment.amount (${p.amount}). `
        + `Difference: ${Math.abs(sum - p.amount).toFixed(2)}.`,
    });
  }

  // P2.2 #1 — at most ONE 'invoice' entry.
  const invoiceApps = p.applications.filter(a => a.targetType === 'invoice');
  if (invoiceApps.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applications'],
      message:
        `At most one 'invoice' application is supported in V1; `
        + `got ${invoiceApps.length}. Multi-invoice splits are V1.5 scope.`,
    });
  }

  // P2.2 #2 — at most ONE 'opening_balance' entry.
  const openingApps = p.applications.filter(a => a.targetType === 'opening_balance');
  if (openingApps.length > 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applications'],
      message:
        `At most one 'opening_balance' application is supported; `
        + `got ${openingApps.length}.`,
    });
  }

  // P2.2 #3 — invoice entry, if present, MUST appear FIRST (ledger
  // ordering contract: older debt settled first).
  if (invoiceApps.length === 1 && p.applications[0].targetType !== 'invoice') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applications'],
      message:
        `'invoice' application MUST appear first in applications[]. `
        + `Got ${p.applications[0].targetType} at index 0. `
        + `Codified ledger ordering contract per Sprint PD.2.3.`,
    });
  }

  // P2.2 #4 — top-level `payment.invoiceId` must match the FIRST
  // 'invoice' application's invoiceId. Pre-PD payments and opening-
  // only payments (deferred to V1.5) are exempt; the V1 valid shapes
  // always have an invoice application AND a populated top-level
  // invoiceId, so they MUST agree.
  if (invoiceApps.length === 1 && invoiceApps[0].invoiceId !== p.invoiceId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applications', 0, 'invoiceId'],
      message:
        `applications[0].invoiceId (${invoiceApps[0].invoiceId}) must match `
        + `payment.invoiceId (${p.invoiceId}). The top-level scalar exists `
        + `for back-compat with pre-PD readers and must mirror the first `
        + `invoice application.`,
    });
  }
});

export type Payment = z.infer<typeof paymentResponseSchema>;

// ============================================================================
// INITIATE PAYMENT (gateway redirect flow)
// ============================================================================

/**
 * Frontend sends this to initiate a gateway payment.
 *
 * `currency` is optional. The backend always copies the currency from the
 * referenced invoice (the invariant source of truth — invoice currency was
 * set from `WorkspaceSettings.regional.defaultCurrency` at invoice create
 * time). If the client passes `currency`, it MUST match the invoice's;
 * otherwise the backend rejects with `PAYMENT_CURRENCY_MISMATCH` (Sprint
 * C2.T2). Most clients should omit it.
 */
export const initiatePaymentSchema = z.object({
  invoiceId: uuidSchema,
  gateway: paymentGatewayEnum,
  amount: z.number().positive().max(10_000_000),
  currency: currencyEnum.optional(),
  returnUrl: z.string().url(),
  cancelUrl: z.string().url(),
});

export type InitiatePaymentRequest = z.infer<typeof initiatePaymentSchema>;

/** Backend responds with redirect URL to gateway payment page */
export const initiatePaymentResponseSchema = z.object({
  paymentSessionId: z.string(),
  redirectUrl: z.string(),
  expiresAt: z.string(),
  /** For form_post gateways (eSewa), the form fields to auto-submit */
  formData: z.record(z.string()).optional(),
  /** 'redirect' for simple URL redirect, 'form_post' for hidden form auto-submit */
  method: z.enum(['redirect', 'form_post']).default('redirect'),
});

export type InitiatePaymentResponse = z.infer<typeof initiatePaymentResponseSchema>;

// ============================================================================
// RECORD MANUAL PAYMENT (cash, bank_transfer, cheque)
// ============================================================================

export const recordManualPaymentSchema = z.object({
  invoiceId: uuidSchema,
  /** Future: pay multiple invoices in a single payment */
  invoiceIds: z.array(uuidSchema).max(20).optional(),
  gateway: z.enum(['cash', 'bank_transfer', 'cheque']),
  amount: z.number().positive().max(10_000_000),
  /**
   * Optional. Always inherited from the referenced invoice; when supplied,
   * MUST match `invoice.currency` or backend rejects with
   * `PAYMENT_CURRENCY_MISMATCH` (Sprint C2.T2).
   */
  currency: currencyEnum.optional(),
  referenceNumber: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  paidDate: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
});

export type RecordManualPaymentDto = z.infer<typeof recordManualPaymentSchema>;

// ============================================================================
// VERIFY PAYMENT (gateway callback)
// ============================================================================

export const verifyPaymentResponseSchema = z.object({
  payment: paymentResponseSchema,
  invoice: z.object({
    id: uuidSchema,
    invoiceNumber: z.string(),
    status: z.string(),
    amountDue: z.number(),
    grandTotal: z.number(),
  }),
  receipt: z.lazy(() => receiptSchema).nullable(),
  status: z.enum(['completed', 'failed', 'cancelled']),
});

export type VerifyPaymentResponse = z.infer<typeof verifyPaymentResponseSchema>;

// ============================================================================
// VOID PAYMENT
// ============================================================================

export const voidPaymentSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type VoidPaymentDto = z.infer<typeof voidPaymentSchema>;

// ============================================================================
// REFUND REQUEST
// ============================================================================

export const createRefundSchema = z.object({
  amount: z.number().positive().max(10_000_000),
  reason: z.string().min(1).max(500),
});

export type CreateRefundDto = z.infer<typeof createRefundSchema>;

// ============================================================================
// RECEIPT
// ============================================================================

export const receiptLineItemSchema = z.object({
  description: z.string(),
  amount: z.number(),
  taxAmount: z.number(),
  total: z.number(),
});

export const receiptSchema = z.object({
  receiptNumber: z.string(),
  paymentId: uuidSchema,
  invoiceNumber: z.string(),
  transactionId: z.string(),
  studentName: z.string(),
  studentId: uuidSchema,
  studentNumber: z.string().optional(),
  emisStudentId: z.string().optional(),
  schoolName: z.string(),
  schoolAddress: z.string().optional(),
  schoolPhone: z.string().optional(),
  paidDate: z.string(),
  amount: z.number(),
  currency: currencyEnum,
  gateway: paymentGatewayEnum,
  gatewayDisplayName: z.string(),
  lineItems: z.array(receiptLineItemSchema),
  subtotal: z.number(),
  taxTotal: z.number(),
  discountTotal: z.number(),
  grandTotal: z.number(),
  taxBreakdown: z.object({
    panNumber: z.string().optional(),
    vatNumber: z.string().optional(),
    taxableAmount: z.number(),
    taxAmount: z.number(),
  }),
  paidBy: z.string(),
  notes: z.string().optional(),
});

export type Receipt = z.infer<typeof receiptSchema>;

// ============================================================================
// PAYMENT FILTER
// ============================================================================

export const paymentFilterSchema = z.object({
  status: z.union([paymentStatusEnum, z.array(paymentStatusEnum)]).optional(),
  gateway: paymentGatewayEnum.optional(),
  invoiceId: uuidSchema.optional(),
  studentId: uuidSchema.optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
});

export type PaymentFilterDto = z.infer<typeof paymentFilterSchema>;

// ============================================================================
// BULK RECEIPT PDF EXPORT — Sprint G.3
// ============================================================================

/**
 * Sprint G.3 request body for `POST /finance/schools/:schoolId/payments/bulk-pdf-export`.
 * Mirror of `bulkPdfExportSchema` (F.4 invoice-side) with `paymentIds`
 * instead of `invoiceIds`. Dedup applied at the schema boundary; the
 * controller enforces the workload cap separately per `BULK_EXPORT_CAPS.zip`.
 *
 * F.4 P2 review lesson (kept for the receipt-side too): NO `.max(N)` on the
 * array here. That would reject oversized inputs as 400 (Zod) BEFORE the
 * controller's 413 `PayloadTooLargeException` envelope can fire — hiding
 * the intended error shape from operators. The cap enforcement lives in
 * the controller.
 */
export const bulkReceiptPdfExportSchema = z.object({
  paymentIds: z
    .array(uuidSchema)
    .min(1, 'paymentIds must contain at least 1 payment')
    .transform((arr) => Array.from(new Set(arr))),
  format: z.enum(['zip', 'merged_pdf']),
});

export type BulkReceiptPdfExportDto = z.infer<typeof bulkReceiptPdfExportSchema>;

// ============================================================================
// CURRENCY FORMATTING
// ============================================================================

export const currencyFormatOptionsSchema = z.object({
  locale: z.enum(['en', 'ne']).default('en'),
  showSymbol: z.boolean().default(true),
  decimals: z.number().int().min(0).max(4).default(2),
});

export type CurrencyFormatOptions = z.infer<typeof currencyFormatOptionsSchema>;
