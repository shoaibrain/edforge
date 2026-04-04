/**
 * Credit Note Entity
 *
 * Scholarships, grants, refund credits, fee waivers.
 *
 * PK: tenantId
 * SK: CREDIT_NOTE#{schoolId}#{creditNoteId}
 * GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI1SK: CREDIT_NOTE#{status}#{effectiveDate}
 * GSI2PK: TENANT#{tid}#STUDENT#{studentId}
 * GSI2SK: CREDIT_NOTE#{effectiveDate}
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, GSIKeyBuilder } from './base.entity';

export type CreditNoteType = 'scholarship' | 'grant' | 'refund' | 'adjustment' | 'fee_waiver';
export type CreditNoteStatus = 'active' | 'applied' | 'expired' | 'cancelled';

export interface CreditNoteApplication {
  invoiceId: string;
  amount: number;
  appliedAt: string;
}

export interface CreditNoteEntity extends BaseEntity {
  entityType: 'CREDIT_NOTE';
  creditNoteId: string;
  studentAccountId: string;
  studentId: string;
  schoolId: string;
  amount: number;
  remainingAmount: number;
  currency: string;
  type: CreditNoteType;
  description: string;
  fundingSource?: string;
  appliedToInvoices: CreditNoteApplication[];
  status: CreditNoteStatus;
  effectiveDate: string;
  expiryDate?: string;
  approvedBy: string;
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

export function createCreditNoteEntity(
  tenantId: string,
  schoolId: string,
  data: {
    studentAccountId: string;
    studentId: string;
    amount: number;
    currency?: string;
    type: CreditNoteType;
    description: string;
    fundingSource?: string;
    effectiveDate: string;
    expiryDate?: string;
  },
  userId: string,
): CreditNoteEntity {
  const creditNoteId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: `CREDIT_NOTE#${schoolId}#${creditNoteId}`,
    entityType: 'CREDIT_NOTE' as any,
    creditNoteId,
    studentAccountId: data.studentAccountId,
    studentId: data.studentId,
    schoolId,
    amount: data.amount,
    remainingAmount: data.amount,
    currency: data.currency || 'NPR',
    type: data.type,
    description: data.description,
    fundingSource: data.fundingSource,
    appliedToInvoices: [],
    status: 'active',
    effectiveDate: data.effectiveDate,
    expiryDate: data.expiryDate,
    approvedBy: userId,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `CREDIT_NOTE#active#${data.effectiveDate}`,
    gsi2pk: GSIKeyBuilder.studentScope(tenantId, data.studentId),
    gsi2sk: `CREDIT_NOTE#${data.effectiveDate}`,
    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
