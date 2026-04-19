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
   * ISO-4217 currency code. Project Midnight Lockin P0.12 widened this from
   * literal `'NPR'` to `string` so non-Nepal archetypes can store their own
   * currency. Should equal `WorkspaceSettings.regional.defaultCurrency` at
   * the tenant level — assert this at create-time in the invoice service.
   *
   * TODO(P1-a, Midnight Lockin follow-up — tracked in
   * docs/MIDNIGHT_LOCKIN_IMPLEMENTATION_REVIEW.md §4 "P1-a"):
   * `createInvoiceEntity` (below) still defaults to `'NPR'`, and
   * `createInvoice` in invoices.service.ts does not yet inject
   * `TenantSettingsResolver.getSettings(tenantId).regional.defaultCurrency`.
   * For Saraswati V1 (PABSON/NPR) this is acceptable — the literal resolves
   * to the right value. For any non-Nepal tenant the default is wrong.
   * Resolution: inject the resolver at each invoice/payment create site and
   * assert `dto.currency === tenantCurrency`. Accepted by Shoaib as a V1
   * known-limitation; must close before the second archetype ships.
   */
  currency: string;
  dueDate: string;
  issuedDate: string;
  status: InvoiceStatus;
  notes?: string;
  taxSummary?: TaxSummaryItem[];

  // MVP fields — enrollment traceability & audit
  enrollmentId?: string;
  gradeLevel?: string;
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
    statusHistory?: StatusHistoryEntry[];
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
    taxSummary: data.taxSummary,
    enrollmentId: data.enrollmentId,
    gradeLevel: data.gradeLevel,
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
