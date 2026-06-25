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
  feeStructureVersion?: number;
  description: string;
  amount: number;
  quantity: number;
  discount: number;
  discountReason?: string;
  taxRate: number;
  taxType?: string;
  taxAmount: number;
  total: number;
  feeType?: string;
}

export interface TaxSummaryItem {
  taxType: string;
  taxableAmount: number;
  taxRate: number;
  taxAmount: number;
}

export interface StatusHistoryEntry {
  from: string;
  to: string;
  changedAt: string;
  changedBy: string;
  reason?: string;
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
  /**
   * ISO-4217 currency code, sourced from `WorkspaceSettings.regional.defaultCurrency`.
   * Sprint C2.T1 closed the prior `'NPR'` default — `createInvoiceEntity` now
   * requires the caller to pass `currency` explicitly, and the service call
   * sites resolve it via `TenantSettingsService.getCurrency(context)`.
   */
  currency: string;
  dueDate: string;
  issuedDate: string;
  status: InvoiceStatus;
  notes?: string;
  taxSummary?: TaxSummaryItem[];

  // MVP fields — enrollment traceability & audit
  enrollmentId?: string;
  /**
   * Sprint A.1 — snapshot grade level at issue time.
   *
   * Populated by `InvoicesService.generate()` from one of:
   *   1. `dto.gradeLevel` (admin override path — wins if supplied)
   *   2. `studentInfo.gradeLevel` (default — captured from the student's
   *      current grade at the moment of invoice creation; survives
   *      promotion so historical filtering stays stable for accounting)
   *
   * Snapshot semantics: written once on `generate()`, NEVER updated when
   * the student promotes. The pair `gradeLevelResolutionStatus` records
   * whether resolution succeeded so the listing UI can surface
   * unresolved rows in a separate "Unknown" bucket (Sprint B.1+).
   */
  gradeLevel?: string;
  /**
   * Sprint A.1 — companion to `gradeLevel`.
   *
   *   - `'resolved'`   — gradeLevel snapshot succeeded (dto or studentInfo)
   *   - `'unresolved'` — both sources empty; gradeLevel undefined; row
   *                      is sparse on the upcoming GSI14 (Sprint A.3)
   *                      and visible only via the "Unknown" UI bucket
   *
   * Older rows (pre-A.1) carry neither field; the backfill script in
   * Sprint A.5 fills both in lockstep.
   */
  gradeLevelResolutionStatus?: 'resolved' | 'unresolved';
  statusHistory?: StatusHistoryEntry[];

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
    taxSummary?: TaxSummaryItem[];
    enrollmentId?: string;
    gradeLevel?: string;
    gradeLevelResolutionStatus?: 'resolved' | 'unresolved';
    statusHistory?: StatusHistoryEntry[];
    currency: string;
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
    currency: data.currency,
    dueDate: data.dueDate,
    issuedDate: data.issuedDate,
    status: data.status,
    notes: data.notes,
    taxSummary: data.taxSummary,
    enrollmentId: data.enrollmentId,
    gradeLevel: data.gradeLevel,
    gradeLevelResolutionStatus: data.gradeLevelResolutionStatus,
    statusHistory: data.statusHistory ?? [],

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
