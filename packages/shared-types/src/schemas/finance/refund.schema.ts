/**
 * Refund Request Schemas
 *
 * Governed refund workflow: requested → pending_approval → approved → processing → completed | rejected
 */

import { z } from 'zod';
import { amountSchema, currencyEnum } from './common';
import { uuidSchema } from '../common';

export const refundStatusEnum = z.enum([
  'requested', 'pending_approval', 'approved', 'processing', 'completed', 'rejected',
]);
export type RefundStatus = z.infer<typeof refundStatusEnum>;

export const refundRequestResponseSchema = z.object({
  id: uuidSchema,
  paymentId: uuidSchema,
  invoiceId: uuidSchema,
  studentId: uuidSchema,
  schoolId: uuidSchema,
  amount: amountSchema,
  currency: currencyEnum,
  reason: z.string(),
  requestedBy: z.string(),
  requestedAt: z.string(),
  status: refundStatusEnum,
  approvedBy: z.string().optional().nullable(),
  approvedAt: z.string().optional().nullable(),
  rejectedReason: z.string().optional().nullable(),
  processedAt: z.string().optional().nullable(),
  gatewayRefundId: z.string().optional().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type RefundRequest = z.infer<typeof refundRequestResponseSchema>;

export const createRefundRequestSchema = z.object({
  paymentId: uuidSchema,
  invoiceId: uuidSchema,
  amount: amountSchema.positive('Refund amount must be greater than 0'),
  reason: z.string().min(1).max(500),
});

export type CreateRefundRequestDto = z.infer<typeof createRefundRequestSchema>;

export const approveRefundSchema = z.object({
  notes: z.string().max(500).optional(),
});

export type ApproveRefundDto = z.infer<typeof approveRefundSchema>;

export const rejectRefundSchema = z.object({
  reason: z.string().min(1).max(500),
});

export type RejectRefundDto = z.infer<typeof rejectRefundSchema>;
