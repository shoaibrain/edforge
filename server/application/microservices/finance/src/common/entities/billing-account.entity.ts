/**
 * Billing Account Entity
 *
 * One billing account per student per school.
 * Tracks financial ledger: balance, total paid, last payment.
 *
 * PK: tenantId
 * SK: BILLING_ACCOUNT#{schoolId}#{studentId}
 * GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI1SK: BILLING_ACCOUNT#{studentName}
 * GSI2PK: TENANT#{tid}#STUDENT#{studentId}
 * GSI2SK: BILLING_ACCOUNT#{schoolId}
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';

export interface BillingAccountEntity extends BaseEntity {
  entityType: 'BILLING_ACCOUNT';
  accountId: string;
  studentId: string;
  schoolId: string;
  studentName: string;
  balance: number;
  totalPaid: number;
  lastPaymentDate: string | null;

  // GSI keys
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

export function createBillingAccountEntity(
  tenantId: string,
  schoolId: string,
  studentId: string,
  studentName: string,
  userId: string,
): BillingAccountEntity {
  const accountId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.billingAccount(schoolId, studentId),
    entityType: 'BILLING_ACCOUNT',
    accountId,
    studentId,
    schoolId,
    studentName,
    balance: 0,
    totalPaid: 0,
    lastPaymentDate: null,

    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('BILLING_ACCOUNT', studentName.toUpperCase()),
    gsi2pk: GSIKeyBuilder.studentScope(tenantId, studentId),
    gsi2sk: `BILLING_ACCOUNT#${schoolId}`,

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
