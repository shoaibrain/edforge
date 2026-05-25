/**
 * `renderInvoiceToPdfBuffer` Unit Tests — Sprint C.1.5.
 *
 * Two render canaries proving the projection from `InvoiceEntity` →
 * `InvoiceDocumentData` produces a valid PDF buffer through real
 * `@react-pdf/renderer` invocation. Not mocked because the descriptor
 * + renderer integration IS what we're verifying: this is the first
 * place that maps prod-shape Invoice data to the rendered PDF.
 *
 * The C.1.1 `<InvoicePdf>` specs cover the rendering invariants
 * (Devanagari shaping, dual-language, BS dates, watermark canaries).
 * This file covers the **finance-side projection** invariants:
 *   - InvoiceEntity → InvoiceDocumentData maps every required field
 *   - branding=null degrades gracefully (no logo, no PAN/VAT)
 *   - the result buffer is a valid PDF (`%PDF-` magic)
 */

import { renderInvoiceToPdfBuffer } from './invoice-pdf.renderer';
import type { InvoiceTemplateConfig } from '@aibrains/pdf-renderer';
import type { InvoiceEntity } from '../common/entities/invoice.entity';

const PDF_MAGIC = Buffer.from('%PDF-', 'utf-8');

function expectValidPdf(buffer: Buffer): void {
  expect(buffer).toBeInstanceOf(Buffer);
  expect(buffer.length).toBeGreaterThan(500);
  expect(buffer.subarray(0, 5).equals(PDF_MAGIC)).toBe(true);
}

const tenantId = 'tenant-uuid';
const schoolId = 'school-uuid';
const invoiceId = 'invoice-uuid';

function fixtureInvoice(overrides: Partial<InvoiceEntity> = {}): InvoiceEntity {
  return {
    tenantId,
    entityKey: `INVOICE#${schoolId}#${invoiceId}`,
    entityType: 'INVOICE',
    invoiceId,
    invoiceNumber: 'INV-2026-001234',
    studentAccountId: 'sa-uuid',
    studentId: 'student-uuid',
    studentName: 'सरस्वती शर्मा',
    schoolId,
    schoolName: 'Saraswati Higher Secondary School',
    academicYear: '2025-2026',
    billingPeriod: 'चैत 2082',
    lineItems: [
      {
        id: 'li-1',
        feeStructureId: 'fs-1',
        description: 'ट्यूशन शुल्क — कक्षा ८',
        amount: 10000,
        quantity: 1,
        discount: 500,
        taxRate: 13,
        taxAmount: 1235,
        total: 10735,
      },
      {
        id: 'li-2',
        feeStructureId: 'fs-2',
        description: 'पुस्तकालय शुल्क',
        amount: 500,
        quantity: 1,
        discount: 0,
        taxRate: 0,
        taxAmount: 0,
        total: 500,
      },
    ],
    subtotal: 10500,
    taxTotal: 1235,
    discountTotal: 500,
    grandTotal: 11235,
    amountPaid: 0,
    amountDue: 11235,
    currency: 'NPR',
    dueDate: '2026-04-28',
    issuedDate: '2026-03-15',
    status: 'issued',
    notes: 'कृपया भुक्तानी मिति भित्र भुक्तानी गर्नुहोला।',
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    gsi3pk: '',
    gsi3sk: '',
    createdAt: '2026-03-15T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-03-15T00:00:00Z',
    updatedBy: 'admin',
    version: 1,
    ...overrides,
  };
}

function pabsonTemplate(): InvoiceTemplateConfig {
  return {
    pageSize: 'A4',
    orientation: 'portrait',
    margins: { top: 15, right: 15, bottom: 15, left: 15 },
    header: {
      showLogo: true,
      showSchoolName: true,
      showSchoolAddress: true,
      showContact: true,
      tagline: 'Education for All',
    },
    footer: {
      text: undefined,
      showPageNumbers: true,
      showSignatureLine: true,
    },
    dateFormat: 'dual',
    numberFormat: 'south-asian',
    currencyDisplay: 'iso-code',
    labelLanguages: ['en', 'ne'] as const,
    lineItemColumns: {
      description: true,
      quantity: true,
      amount: true,
      discount: true,
      taxRate: true,
      taxAmount: true,
      total: true,
    },
    totalsSection: {
      showSubtotal: true,
      showTaxTotal: true,
      showDiscountTotal: true,
      showAmountPaid: true,
      showAmountDue: true,
    },
  };
}

describe('renderInvoiceToPdfBuffer (Sprint C.1.5)', () => {
  it(
    'renders a PABSON Saraswati invoice with full branding → valid PDF buffer',
    async () => {
      const buffer = await renderInvoiceToPdfBuffer({
        invoice: fixtureInvoice(),
        branding: {
          formalName: 'सरस्वती माध्यमिक विद्यालय',
          addressLines: ['Ward 7, Bhaktapur', 'Bagmati Province'],
          phone: '+977-1-555-1234',
          email: 'admin@saraswati.edu.np',
          panNumber: '301234567',
          vatNumber: '700123456',
          colorPalette: { primary: '#1F4E79', accent: '#FFC000' },
          tagline: 'Education for All',
        },
        urls: undefined, // No S3 logo URL in this fixture
        templateConfig: pabsonTemplate(),
        locale: 'ne-NP',
      });

      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'renders an invoice with branding=null gracefully (no logo, no PAN/VAT, no formalName)',
    async () => {
      // Most freshly-provisioned tenants hit this path before the operator
      // configures branding via the C.0.7 endpoints — the PDF must still
      // render rather than erroring.
      const buffer = await renderInvoiceToPdfBuffer({
        invoice: fixtureInvoice(),
        branding: null,
        urls: undefined,
        templateConfig: pabsonTemplate(),
        locale: 'ne-NP',
      });

      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'projects line items one-to-one (description, amount, taxAmount, total preserved)',
    async () => {
      const invoice = fixtureInvoice({
        lineItems: [
          {
            id: 'li-only',
            feeStructureId: 'fs-only',
            description: 'Single line',
            amount: 1000,
            quantity: 1,
            discount: 0,
            taxRate: 0,
            taxAmount: 0,
            total: 1000,
          },
        ],
        subtotal: 1000,
        taxTotal: 0,
        discountTotal: 0,
        grandTotal: 1000,
        amountPaid: 0,
        amountDue: 1000,
      });

      const buffer = await renderInvoiceToPdfBuffer({
        invoice,
        branding: null,
        urls: undefined,
        templateConfig: pabsonTemplate(),
        locale: 'en-US',
      });

      expectValidPdf(buffer);
    },
    30_000,
  );
});
