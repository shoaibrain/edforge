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
    lineItems: entity.lineItems.map(li => ({
      id: li.id,
      feeStructureId: li.feeStructureId,
      description: li.description,
      amount: li.amount,
      quantity: li.quantity,
      discount: li.discount,
      discountReason: li.discountReason,
      taxRate: li.taxRate,
      taxAmount: li.taxAmount,
      total: li.total,
    })),
    subtotal: entity.subtotal,
    taxTotal: entity.taxTotal,
    discountTotal: entity.discountTotal,
    grandTotal: entity.grandTotal,
    amountPaid: entity.amountPaid,
    amountDue: entity.amountDue,
    currency: entity.currency,
    dueDate: entity.dueDate,
    issuedDate: entity.issuedDate,
    status: entity.status,
    notes: entity.notes,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
