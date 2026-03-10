import { RefundRequestEntity } from '../entities/refund-request.entity';
import type { RefundRequest } from '@aibrains/shared-types';

export function refundRequestEntityToDto(entity: RefundRequestEntity): RefundRequest {
  return {
    id: entity.refundId,
    paymentId: entity.paymentId,
    invoiceId: entity.invoiceId,
    studentId: entity.studentId,
    schoolId: entity.schoolId,
    amount: entity.amount,
    currency: entity.currency as any,
    reason: entity.reason,
    requestedBy: entity.requestedBy,
    requestedAt: entity.requestedAt,
    status: entity.status,
    approvedBy: entity.approvedBy,
    approvedAt: entity.approvedAt,
    rejectedReason: entity.rejectedReason,
    processedAt: entity.processedAt,
    gatewayRefundId: entity.gatewayRefundId,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
