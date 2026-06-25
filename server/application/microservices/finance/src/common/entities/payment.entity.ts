/**
 * Payment Entity
 *
 * Records payments against invoices. Supports both gateway and manual payments.
 *
 * PK: tenantId
 * SK: PAYMENT#{schoolId}#{paymentId}
 * GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI1SK: PAYMENT#{status}#{paidAt}
 * GSI2PK: TENANT#{tid}#STUDENT#{studentId} (via account lookup)
 * GSI2SK: PAYMENT#{createdAt}
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';
import type { PaymentStatus, PaymentGateway } from '@aibrains/shared-types';

export interface RefundData {
  id: string;
  paymentId: string;
  amount: number;
  reason: string;
  gatewayRefundId?: string;
  status: 'pending' | 'completed' | 'failed';
  refundedAt: string | null;
  createdAt: string;
}

export interface PaymentEntity extends BaseEntity {
  entityType: 'PAYMENT';
  paymentId: string;
  invoiceId: string;
  studentAccountId: string;
  schoolId: string;
  studentId: string;
  amount: number;
  /**
   * ISO-4217 currency code, copied from the invoice this payment belongs to
   * (so it always matches `invoice.currency` — Sprint C2.T2 enforces this
   * at recording time, refusing payments whose `currency` mismatches the
   * referenced invoice).
   */
  currency: string;
  gateway: PaymentGateway;
  gatewayTransactionId?: string;
  gatewaySessionId?: string;
  status: PaymentStatus;
  paidAt: string | null;
  paidBy: string | null;
  receiptNumber: string | null;
  metadata: Record<string, unknown>;
  refunds: RefundData[];
  idempotencyKey?: string;

  /**
   * Sprint A.2 — denormalized snapshot from the parent invoice's
   * `gradeLevel` at payment-creation time. Lets the upcoming GSI14
   * (Sprint A.3) answer "all Grade 4 payments for school X this
   * period" with a single Query, without a JOIN against invoice rows
   * on every read. Snapshot semantics — never updated on student
   * promotion, just like `InvoiceEntity.gradeLevel`.
   *
   * Undefined when the parent invoice's gradeLevel is unresolved
   * (post-A.1 invoices) OR when the invoice predates A.1 entirely
   * (backfill case — Sprint A.5 fills both invoice + payment
   * snapshots in lockstep).
   */
  gradeLevel?: string;
  /**
   * Sprint A.2 — companion to `gradeLevel`. Same `'resolved' | 'unresolved'`
   * semantics as on InvoiceEntity. Internal-only per CLAUDE.md `[P1d]`
   * — never emitted on the response DTO; only consumed by backend
   * filter logic and the "Unknown" UI bucket (Sprint B.2).
   */
  gradeLevelResolutionStatus?: 'resolved' | 'unresolved';

  // GSI keys
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

export function createPaymentEntity(
  tenantId: string,
  schoolId: string,
  data: {
    invoiceId: string;
    studentAccountId: string;
    studentId: string;
    amount: number;
    currency: string;
    gateway: PaymentGateway;
    gatewaySessionId?: string;
    paidBy?: string;
    idempotencyKey?: string;
    /** Sprint A.2 — snapshot from parent invoice's gradeLevel. */
    gradeLevel?: string;
    /** Sprint A.2 — companion status. */
    gradeLevelResolutionStatus?: 'resolved' | 'unresolved';
  },
  userId: string,
): PaymentEntity {
  const paymentId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.payment(schoolId, paymentId),
    entityType: 'PAYMENT',
    paymentId,
    invoiceId: data.invoiceId,
    studentAccountId: data.studentAccountId,
    schoolId,
    studentId: data.studentId,
    amount: data.amount,
    currency: data.currency,
    gateway: data.gateway,
    gatewaySessionId: data.gatewaySessionId,
    status: 'pending',
    paidAt: null,
    paidBy: data.paidBy || userId,
    receiptNumber: null,
    metadata: {},
    refunds: [],
    idempotencyKey: data.idempotencyKey,
    gradeLevel: data.gradeLevel,
    gradeLevelResolutionStatus: data.gradeLevelResolutionStatus,

    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('PAYMENT', `pending#${now}`),
    gsi2pk: GSIKeyBuilder.studentScope(tenantId, data.studentId),
    gsi2sk: `PAYMENT#${now}`,

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
