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
  currency: 'NPR';
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
    gateway: PaymentGateway;
    gatewaySessionId?: string;
    paidBy?: string;
    idempotencyKey?: string;
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
    currency: 'NPR',
    gateway: data.gateway,
    gatewaySessionId: data.gatewaySessionId,
    status: 'pending',
    paidAt: null,
    paidBy: data.paidBy || userId,
    receiptNumber: null,
    metadata: {},
    refunds: [],
    idempotencyKey: data.idempotencyKey,

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
