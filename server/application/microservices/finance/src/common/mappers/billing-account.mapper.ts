import { BillingAccountEntity } from '../entities/billing-account.entity';
import type { BillingAccount } from '@aibrains/shared-types';

export function billingAccountEntityToDto(entity: BillingAccountEntity): BillingAccount {
  return {
    id: entity.accountId,
    studentId: entity.studentId,
    schoolId: entity.schoolId,
    studentName: entity.studentName,
    balance: entity.balance,
    totalPaid: entity.totalPaid,
    lastPaymentDate: entity.lastPaymentDate,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
