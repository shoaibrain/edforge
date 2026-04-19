import { PaymentEntity } from '../entities/payment.entity';
import type { Payment } from '@aibrains/shared-types';

export function paymentEntityToDto(
  entity: PaymentEntity,
  enrichment?: { studentName?: string; invoiceNumber?: string },
): Payment {
  return {
    id: entity.paymentId,
    invoiceId: entity.invoiceId,
    studentAccountId: entity.studentAccountId,
    schoolId: entity.schoolId,
    amount: entity.amount,
    // P0.12: entity.currency widened to `string`; DTO keeps enum. Safe cast.
    currency: entity.currency as 'NPR' | 'USD' | 'INR' | 'GBP' | 'AUD' | 'CAD',
    gateway: entity.gateway,
    gatewayTransactionId: entity.gatewayTransactionId,
    gatewaySessionId: entity.gatewaySessionId,
    status: entity.status,
    paidAt: entity.paidAt,
    paidBy: entity.paidBy,
    receiptNumber: entity.receiptNumber,
    metadata: entity.metadata,
    refunds: (entity.refunds ?? []).map(r => ({
      id: r.id,
      paymentId: r.paymentId,
      amount: r.amount,
      reason: r.reason,
      gatewayRefundId: r.gatewayRefundId,
      status: r.status,
      refundedAt: r.refundedAt,
      createdAt: r.createdAt,
    })),
    ...(enrichment?.studentName ? { studentName: enrichment.studentName } : {}),
    ...(enrichment?.invoiceNumber ? { invoiceNumber: enrichment.invoiceNumber } : {}),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
