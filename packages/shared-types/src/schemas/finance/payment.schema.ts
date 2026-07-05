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
 * EPIC-FB FB-4.2 invariants (widened from PD.2's single-invoice contract
 * so one payment can settle multiple siblings' invoices; enforced by the
 * response superRefine below):
 *   - applications.length ≥ 1 (when present at all)
 *   - 0..20 'invoice' entries, each referencing a DISTINCT invoice
 *     (20 = DDB transactWrite ceiling, ~3 transact items per target)
 *   - at most 1 'opening_balance' entry
 *   - every invoice entry appears BEFORE the opening_balance entry
 *     (ledger ordering contract: invoice debt first, opening balance last)
 *   - sum invariant (±0.01 tolerance)
 *   - top-level `invoiceId`/`studentAccountId` mirror the applications —
 *     representation consistency, FB-4.1 (see superRefine)
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
  /**
   * EPIC-FB FB-4.1 — was required; now nullable so a multi-target family
   * payment (≥2 invoice applications) has a representable identity. The
   * scalar remains populated on single-invoice payments for back-compat
   * with pre-FB readers; the superRefine below ties its presence to the
   * shape of `applications[]`.
   */
  invoiceId: uuidSchema.optional().nullable(),
  /**
   * EPIC-FB FB-4.1 — nullable ⟺ multi-target (a family payment belongs to
   * no single student account; per-student visibility flows through ledger
   * entries, the per-student system of record). Present on single-invoice
   * and opening-balance-only payments.
   */
  studentAccountId: uuidSchema.optional().nullable(),
  /**
   * EPIC-FB FB-4.1 — optional reporting stamp: the academics FamilyGroup a
   * multi-target payment was recorded against. Display/rollup convenience
   * only — never used for money movement.
   */
  familyId: uuidSchema.optional(),
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
  // EPIC-FB FB-4.1/FB-4.2 schema-level application invariants.
  //
  // Pre-Phase-C these were enforced ONLY by
  // `PaymentsService.recordManualPayment`'s pre-allocation math; PD.2
  // codified them at the deserialization boundary with a single-invoice
  // cap. FB-4 widens the contract to multi-invoice family payments (one
  // cheque settles several siblings' invoices) — any caller, DDB row, or
  // replayed payload that bypasses the service path is still caught here
  // before downstream readers (mapper, PDF renderer, dashboard,
  // void/refund) can produce inconsistent numbers.
  //
  // The invariants are codified in the JSDoc on `paymentApplicationSchema`
  // + the entity-side `PaymentEntity.applications`.
  if (!p.applications || p.applications.length === 0) return;

  const isAbsent = (v: string | null | undefined): boolean => v === null || v === undefined;

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

  // FB-4.2 #1 — at most 20 'invoice' entries (DDB transactWrite ceiling:
  // payment put + per-invoice update + ledger entries + account updates
  // ≈ 3 items per target against the 100-item limit).
  const invoiceApps = p.applications.filter(a => a.targetType === 'invoice');
  if (invoiceApps.length > 20) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applications'],
      message:
        `At most 20 'invoice' applications are supported; got ${invoiceApps.length}. `
        + `DDB transactWrite ceiling (FB-4.2).`,
    });
  }

  // FB-4.2 #2 — invoice entries reference DISTINCT invoices.
  const invoiceTargetIds = invoiceApps.map(a => a.invoiceId);
  if (new Set(invoiceTargetIds).size !== invoiceTargetIds.length) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applications'],
      message: `'invoice' applications must reference distinct invoiceIds.`,
    });
  }

  // FB-4.2 #3 — at most ONE 'opening_balance' entry (an opening balance
  // belongs to exactly one billing account).
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

  // FB-4.2 #4 — ordering: every 'invoice' entry appears BEFORE the
  // 'opening_balance' entry (generalizes PD.2.3's "invoice first" rule;
  // ledger ordering contract: invoice debt settled first, opening
  // balance last).
  const firstOpeningIdx = p.applications.findIndex(a => a.targetType === 'opening_balance');
  if (
    firstOpeningIdx !== -1
    && p.applications.slice(firstOpeningIdx + 1).some(a => a.targetType === 'invoice')
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['applications'],
      message:
        `Every 'invoice' application must appear BEFORE the 'opening_balance' `
        + `entry. Codified ledger ordering contract (PD.2.3, generalized by FB-4.2).`,
    });
  }

  // FB-4.1 — representation consistency between the top-level scalars and
  // applications[]. The top-level `invoiceId`/`studentAccountId` exist for
  // back-compat with pre-FB single-target readers and must never lie:
  //   - exactly 1 invoice entry → single-target payment: top-level
  //     invoiceId MUST equal it AND studentAccountId MUST be present.
  //   - ≥2 invoice entries → multi-target family payment: the row belongs
  //     to no single invoice/account — BOTH scalars MUST be null/undefined
  //     (per-student visibility flows through ledger entries).
  //   - 0 invoice entries (opening-balance-only) → invoiceId MUST be
  //     null/undefined; studentAccountId MUST be present.
  if (invoiceApps.length === 1) {
    if (isAbsent(p.invoiceId) || invoiceApps[0].invoiceId !== p.invoiceId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['invoiceId'],
        message:
          `Single-invoice payment: top-level invoiceId (${p.invoiceId}) must equal `
          + `the sole 'invoice' application's invoiceId (${invoiceApps[0].invoiceId}).`,
      });
    }
    if (isAbsent(p.studentAccountId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['studentAccountId'],
        message: `Single-invoice payment: studentAccountId must be present.`,
      });
    }
  } else if (invoiceApps.length >= 2) {
    if (!isAbsent(p.invoiceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['invoiceId'],
        message:
          `Multi-invoice payment (${invoiceApps.length} invoice applications): `
          + `top-level invoiceId must be null/undefined.`,
      });
    }
    if (!isAbsent(p.studentAccountId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['studentAccountId'],
        message:
          `Multi-invoice payment (${invoiceApps.length} invoice applications): `
          + `top-level studentAccountId must be null/undefined.`,
      });
    }
  } else {
    if (!isAbsent(p.invoiceId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['invoiceId'],
        message: `Opening-balance-only payment: top-level invoiceId must be null/undefined.`,
      });
    }
    if (isAbsent(p.studentAccountId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['studentAccountId'],
        message:
          `Opening-balance-only payment: studentAccountId must be present `
          + `(an opening balance belongs to exactly one account).`,
      });
    }
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

/**
 * Request-side allocation entry for a multi-target manual payment: pays
 * part (or all) of ONE invoice. Distinct from `paymentApplicationSchema`
 * (the response-side breakdown) — clients never target opening balance
 * directly; the service allocates any remainder there per the existing
 * single-target rule.
 */
export const manualPaymentApplicationInputSchema = z.object({
  invoiceId: uuidSchema,
  amount: z.number().positive().max(10_000_000),
});

export type ManualPaymentApplicationInput = z.infer<typeof manualPaymentApplicationInputSchema>;

/**
 * Record an offline payment (cash, bank_transfer, cheque). Two shapes:
 *
 *   - SINGLE-TARGET (pre-FB shape, valid unchanged): `invoiceId` set,
 *     `applications` absent. Service allocates min(amount, amountDue) to
 *     the invoice and any remainder to the account's opening balance;
 *     unallocatable leftover rejected (`PAYMENT_EXCEEDS_ALLOCATABLE`).
 *
 *   - MULTI-TARGET (EPIC-FB FB-4.1 — one cheque settles several siblings'
 *     invoices): `applications` set (1..20 entries, DISTINCT invoices;
 *     same school + currency enforced service-side), `invoiceId` absent.
 *     `familyId` may stamp the family for reporting. Σ(applications)
 *     must not exceed `amount`; remainder handling follows the same
 *     no-credit-memo rule as single-target.
 *
 * Exactly ONE of `invoiceId` / `applications` must be provided
 * (superRefine below).
 */
export const recordManualPaymentSchema = z.object({
  /** Single-target shape. Mutually exclusive with `applications`. */
  invoiceId: uuidSchema.optional(),
  /**
   * Multi-target shape (FB-4.1). Mutually exclusive with `invoiceId`.
   * Min 2: a one-target payment MUST use the single `invoiceId` shape —
   * a 1-entry multi row would violate the response representation matrix
   * (1 invoice application => top-level scalars present) and every
   * consumer's `length >= 2` multi discrimination (review P1-1).
   */
  applications: z.array(manualPaymentApplicationInputSchema).min(2).max(20).optional(),
  /** EPIC-FB FB-4.1 — optional family stamp for reporting/rollups. */
  familyId: uuidSchema.optional(),
  gateway: z.enum(['cash', 'bank_transfer', 'cheque']),
  amount: z.number().positive().max(10_000_000),
  /**
   * Optional. Always inherited from the referenced invoice(s); when
   * supplied, MUST match `invoice.currency` or backend rejects with
   * `PAYMENT_CURRENCY_MISMATCH` (Sprint C2.T2).
   */
  currency: currencyEnum.optional(),
  referenceNumber: z.string().max(100).optional(),
  notes: z.string().max(500).optional(),
  paidDate: z.string().optional(),
  idempotencyKey: z.string().uuid().optional(),
}).superRefine((dto, ctx) => {
  const hasSingle = dto.invoiceId !== undefined;
  const hasMulti = dto.applications !== undefined;

  if (hasSingle === hasMulti) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['invoiceId'],
      message:
        `Provide exactly one of 'invoiceId' (single-target) or 'applications' `
        + `(multi-target); got ${hasSingle ? 'both' : 'neither'}.`,
    });
    return;
  }

  if (dto.applications) {
    const targetIds = dto.applications.map(a => a.invoiceId);
    if (new Set(targetIds).size !== targetIds.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applications'],
        message: `applications[] must reference distinct invoiceIds.`,
      });
    }

    // Over-allocation is always invalid. Under-allocation is left to the
    // service (remainder → opening balance, or PAYMENT_EXCEEDS_ALLOCATABLE).
    // Same ±0.01 tolerance as the response-side sum invariant (SPEC-14).
    const allocated = dto.applications.reduce((s, a) => s + a.amount, 0);
    if (allocated - dto.amount > 0.01) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['applications'],
        message:
          `Sum of applications[].amount (${allocated}) cannot exceed the payment `
          + `amount (${dto.amount}).`,
      });
    }
  }
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
