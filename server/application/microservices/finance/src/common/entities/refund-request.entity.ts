/**
 * Refund Request Entity
 *
 * Governed refund workflow with approval.
 *
 * PK: tenantId
 * SK: REFUND#${schoolId}#${refundId}
 * GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI1SK: REFUND#${status}#${requestedAt}
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, GSIKeyBuilder } from './base.entity';

export type RefundStatus = 'requested' | 'pending_approval' | 'approved' | 'processing' | 'completed' | 'rejected';

export interface RefundRequestEntity extends BaseEntity {
  entityType: 'REFUND_REQUEST';
  refundId: string;
  paymentId: string;
  invoiceId: string;
  studentId: string;
  schoolId: string;
  amount: number;
  currency: string;
  reason: string;
  requestedBy: string;
  requestedAt: string;
  status: RefundStatus;
  approvedBy?: string;
  approvedAt?: string;
  rejectedReason?: string;
  processedAt?: string;
  gatewayRefundId?: string;
  gsi1pk: string;
  gsi1sk: string;
}

export function createRefundRequestEntity(
  tenantId: string,
  schoolId: string,
  data: {
    paymentId: string;
    invoiceId: string;
    studentId: string;
    amount: number;
    currency?: string;
    reason: string;
  },
  userId: string,
): RefundRequestEntity {
  const refundId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: `REFUND#${schoolId}#${refundId}`,
    entityType: 'REFUND_REQUEST' as any,
    refundId,
    paymentId: data.paymentId,
    invoiceId: data.invoiceId,
    studentId: data.studentId,
    schoolId,
    amount: data.amount,
    currency: data.currency || 'NPR',
    reason: data.reason,
    requestedBy: userId,
    requestedAt: now,
    status: 'pending_approval',
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `REFUND#pending_approval#${now}`,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
