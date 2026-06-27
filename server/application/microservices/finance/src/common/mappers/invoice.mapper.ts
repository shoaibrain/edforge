import { InvoiceEntity } from '../entities/invoice.entity';
import type { Invoice } from '@aibrains/shared-types';

export function invoiceEntityToDto(entity: InvoiceEntity): Invoice {
  return {
    id: entity.invoiceId,
    invoiceNumber: entity.invoiceNumber,
    studentAccountId: entity.studentAccountId,
    studentId: entity.studentId,
    studentName: entity.studentName,
    schoolId: entity.schoolId,
    schoolName: entity.schoolName,
    academicYear: entity.academicYear,
    billingPeriod: entity.billingPeriod,
    lineItems: (entity.lineItems ?? []).map(li => ({
      id: li.id,
      feeStructureId: li.feeStructureId,
      feeStructureVersion: li.feeStructureVersion,
      description: li.description,
      amount: li.amount,
      quantity: li.quantity,
      discount: li.discount,
      discountReason: li.discountReason,
      taxRate: li.taxRate,
      taxType: li.taxType,
      taxAmount: li.taxAmount,
      total: li.total,
    })),
    subtotal: entity.subtotal,
    taxTotal: entity.taxTotal,
    discountTotal: entity.discountTotal,
    grandTotal: entity.grandTotal,
    amountPaid: entity.amountPaid,
    amountDue: entity.amountDue,
    // P0.12: entity.currency is `string` (widened); DTO `currencyEnum`
    // restricts to NPR/USD/INR/GBP/AUD/CAD. Cast is safe because writes
    // flow through the Zod-validated Create DTO path — anything other than
    // the enum could not have been stored.
    currency: entity.currency as 'NPR' | 'USD' | 'INR' | 'GBP' | 'AUD' | 'CAD',
    dueDate: entity.dueDate,
    issuedDate: entity.issuedDate,
    status: entity.status,
    notes: entity.notes,
    taxSummary: entity.taxSummary,
    enrollmentId: entity.enrollmentId,
    gradeLevel: entity.gradeLevel,
    // Sprint A.1 Codex round-2 — also pass `gradeLevelResolutionStatus`.
    // Originally I held this back per CLAUDE.md `[P1d]` (mirror of
    // `isActive` as an internal-only flag), reasoning that the
    // "Unknown" UI bucket reads via a backend filter (`__UNRESOLVED__`
    // magic value) so the frontend never needs to know the status.
    // Codex reviewer surfaced this as a contract-completeness gap;
    // the runtime cost of an optional 11-byte enum field is zero
    // and exposing it removes ambiguity for any future consumer
    // that wants to render an "unresolved" badge without making a
    // second filter call.
    gradeLevelResolutionStatus: entity.gradeLevelResolutionStatus,
    statusHistory: entity.statusHistory,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
