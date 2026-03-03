/**
 * Invoice Entity
 *
 * Represents a bill sent to a student/parent.
 * Lifecycle: draft → issued → partially_paid → paid → overdue → cancelled → written_off
 *
 * PK: tenantId
 * SK: INVOICE#{schoolId}#{invoiceId}
 * GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI1SK: INVOICE#{status}#{dueDate}
 * GSI2PK: TENANT#{tid}#STUDENT#{studentId}
 * GSI2SK: INVOICE#{issuedDate}
 * GSI3PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI3SK: INVNUM#{invoiceNumber}
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';
import type { InvoiceStatus } from '@aibrains/shared-types';

export interface InvoiceLineItemData {
  id: string;
  feeStructureId: string;
  description: string;
  amount: number;
  quantity: number;
  discount: number;
  discountReason?: string;
  taxRate: number;
  taxAmount: number;
  total: number;
}

export interface InvoiceEntity extends BaseEntity {
  entityType: 'INVOICE';
  invoiceId: string;
  invoiceNumber: string;
  studentAccountId: string;
  studentId: string;
  studentName: string;
  schoolId: string;
  schoolName: string;
  academicYear: string;
  billingPeriod?: string;
  lineItems: InvoiceLineItemData[];
  subtotal: number;
  taxTotal: number;
  discountTotal: number;
  grandTotal: number;
  amountPaid: number;
  amountDue: number;
  currency: 'NPR';
  dueDate: string;
  issuedDate: string;
  status: InvoiceStatus;
  notes?: string;

  // GSI keys
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
  gsi3pk: string;
  gsi3sk: string;
}

export function createInvoiceEntity(
  tenantId: string,
  schoolId: string,
  data: {
    invoiceNumber: string;
    studentAccountId: string;
    studentId: string;
    studentName: string;
    schoolName: string;
    academicYear: string;
    billingPeriod?: string;
    lineItems: InvoiceLineItemData[];
    subtotal: number;
    taxTotal: number;
    discountTotal: number;
    grandTotal: number;
    dueDate: string;
    issuedDate: string;
    status: InvoiceStatus;
    notes?: string;
  },
  userId: string,
): InvoiceEntity {
  const invoiceId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.invoice(schoolId, invoiceId),
    entityType: 'INVOICE',
    invoiceId,
    invoiceNumber: data.invoiceNumber,
    studentAccountId: data.studentAccountId,
    studentId: data.studentId,
    studentName: data.studentName,
    schoolId,
    schoolName: data.schoolName,
    academicYear: data.academicYear,
    billingPeriod: data.billingPeriod,
    lineItems: data.lineItems,
    subtotal: data.subtotal,
    taxTotal: data.taxTotal,
    discountTotal: data.discountTotal,
    grandTotal: data.grandTotal,
    amountPaid: 0,
    amountDue: data.grandTotal,
    currency: 'NPR',
    dueDate: data.dueDate,
    issuedDate: data.issuedDate,
    status: data.status,
    notes: data.notes,

    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('INVOICE', `${data.status}#${data.dueDate}`),
    gsi2pk: GSIKeyBuilder.studentScope(tenantId, data.studentId),
    gsi2sk: `INVOICE#${data.issuedDate}`,
    gsi3pk: GSIKeyBuilder.invoiceLookup(tenantId, schoolId),
    gsi3sk: GSIKeyBuilder.invoiceNumber(data.invoiceNumber),

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
