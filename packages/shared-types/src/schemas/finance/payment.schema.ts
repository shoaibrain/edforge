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
  createdAt: z.string(),
  updatedAt: z.string(),
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
// CURRENCY FORMATTING
// ============================================================================

export const currencyFormatOptionsSchema = z.object({
  locale: z.enum(['en', 'ne']).default('en'),
  showSymbol: z.boolean().default(true),
  decimals: z.number().int().min(0).max(4).default(2),
});

export type CurrencyFormatOptions = z.infer<typeof currencyFormatOptionsSchema>;
