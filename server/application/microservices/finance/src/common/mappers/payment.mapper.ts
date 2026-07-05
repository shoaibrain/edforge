import { PaymentEntity } from '../entities/payment.entity';
import type { Payment } from '@aibrains/shared-types';

export function paymentEntityToDto(
  entity: PaymentEntity,
  enrichment?: { studentName?: string; invoiceNumber?: string },
): Payment {
  return {
    id: entity.paymentId,
    // EPIC-FB FB-4.1 — null on multi-target family payments; the response
    // schema's representation matrix ties these scalars to applications[].
    invoiceId: entity.invoiceId,
    studentAccountId: entity.studentAccountId,
    // FB-4.1 — optional family reporting stamp (multi-target only).
    ...(entity.familyId ? { familyId: entity.familyId } : {}),
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
    // Sprint A.2 Codex round-2 — pass both grade-snapshot fields
    // through to the response DTO. Plan A.2 acceptance ("Mapper
    // passes through") was previously not honored on Payment at all;
    // round-2 closes the contract-completeness gap.
    gradeLevel: entity.gradeLevel,
    gradeLevelResolutionStatus: entity.gradeLevelResolutionStatus,
    // Pilot PD.2.1 — per-target allocation breakdown. Sparse on
    // pre-PD and V1-single-invoice payments; populated when
    // recordManualPayment / completePayment chose to record a
    // split (invoice + opening_balance).
    ...(entity.applications ? { applications: entity.applications } : {}),
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
