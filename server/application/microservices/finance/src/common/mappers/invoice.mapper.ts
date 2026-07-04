import { InvoiceEntity } from '../entities/invoice.entity';
import type { Invoice } from '@aibrains/shared-types';

/**
 * EPIC-FB FB-0.1 — statuses exempt from the derived overdue flag. Everything
 * else (draft, issued, partially_paid, overdue) counts as overdue exposure
 * once past due, per the invoiceResponseSchema.isOverdue contract.
 */
const OVERDUE_EXEMPT_STATUSES = new Set(['paid', 'cancelled', 'written_off']);

export function todayIsoDate(): string {
  return new Date().toISOString().split('T')[0];
}

/**
 * EPIC-FB FB-0.1 — derived read-side overdue predicate, NEVER stored.
 * `dueDate < today && status ∉ {paid, cancelled, written_off}`. The overdue
 * sweep only transitions `issued → overdue`, so a past-due `partially_paid`
 * invoice keeps its partial-payment signal in `status` and surfaces its
 * past-due signal through this flag instead. Dates compare lexicographically
 * (both are ISO YYYY-MM-DD, matching the sweep's `dueDate < :today`).
 */
export function isInvoiceOverdue(
  invoice: Pick<InvoiceEntity, 'dueDate' | 'status'>,
  today: string = todayIsoDate(),
): boolean {
  return invoice.dueDate < today && !OVERDUE_EXEMPT_STATUSES.has(invoice.status);
}

export interface InvoiceDtoOptions {
  /**
   * EPIC-FB FB-0.2 — the school's CURRENT display name, resolved at read
   * time by the caller (identity lookup). When set, it replaces the stored
   * at-issuance snapshot in the response; null/undefined falls back to the
   * stored value (graceful degradation when the lookup fails).
   */
  currentSchoolName?: string | null;
}

export function invoiceEntityToDto(entity: InvoiceEntity, options?: InvoiceDtoOptions): Invoice {
  return {
    id: entity.invoiceId,
    invoiceNumber: entity.invoiceNumber,
    studentAccountId: entity.studentAccountId,
    studentId: entity.studentId,
    studentName: entity.studentName,
    schoolId: entity.schoolId,
    schoolName: options?.currentSchoolName || entity.schoolName,
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
      isCustom: li.isCustom,
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
    isOverdue: isInvoiceOverdue(entity),
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
