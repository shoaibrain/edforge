import { CreditNoteEntity } from '../entities/credit-note.entity';
import type { CreditNote } from '@aibrains/shared-types';

export function creditNoteEntityToDto(entity: CreditNoteEntity): CreditNote {
  return {
    id: entity.creditNoteId,
    studentAccountId: entity.studentAccountId,
    studentId: entity.studentId,
    schoolId: entity.schoolId,
    amount: entity.amount,
    remainingAmount: entity.remainingAmount,
    currency: entity.currency as any,
    type: entity.type,
    description: entity.description,
    fundingSource: entity.fundingSource,
    appliedToInvoices: entity.appliedToInvoices,
    status: entity.status,
    effectiveDate: entity.effectiveDate,
    expiryDate: entity.expiryDate,
    approvedBy: entity.approvedBy,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
