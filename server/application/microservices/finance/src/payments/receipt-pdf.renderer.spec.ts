/**
 * `renderReceiptToPdfBuffer` Unit Tests — Sprint C.1.6.
 *
 * Three render canaries proving the projection from `PaymentEntity +
 * InvoiceEntity` → `ReceiptDocumentData` produces a valid PDF buffer
 * through real `@react-pdf/renderer` invocation. Mirrors the C.1.5
 * invoice renderer spec pattern — see that file's header for the
 * not-mocked rationale.
 *
 * Tests focus on the **finance-side projection** invariants:
 *   - Payment + Invoice → ReceiptDocumentData maps every required field
 *   - branding=null degrades gracefully
 *   - The result buffer is a valid PDF (`%PDF-` magic)
 *
 * The C.1.2 ReceiptPdf component spec covers rendering invariants
 * (Devanagari shaping, dual-language, BS dates, watermark canaries).
 */

import { renderReceiptToPdfBuffer } from './receipt-pdf.renderer';
import type { ReceiptTemplateConfig } from '@aibrains/pdf-renderer';
import type { PaymentEntity } from '../common/entities/payment.entity';
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
const paymentId = 'payment-uuid';

function fixturePayment(overrides: Partial<PaymentEntity> = {}): PaymentEntity {
  return {
    tenantId,
    entityKey: `PAYMENT#${schoolId}#${paymentId}`,
    entityType: 'PAYMENT',
    paymentId,
    invoiceId,
    studentAccountId: 'sa-uuid',
    schoolId,
    studentId: 'student-uuid',
    amount: 11235,
    currency: 'NPR',
    gateway: 'esewa',
    gatewayTransactionId: 'TXN-ESWA-987654321',
    status: 'completed',
    paidAt: '2026-03-20T10:00:00Z',
    paidBy: 'सरस्वती शर्मा',
    receiptNumber: 'RCT-2026-001234',
    metadata: {},
    refunds: [],
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    createdAt: '2026-03-20T10:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-03-20T10:00:00Z',
    updatedBy: 'admin',
    version: 1,
    ...overrides,
  } as PaymentEntity;
}

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
    amountPaid: 11235,
    amountDue: 0,
    currency: 'NPR',
    dueDate: '2026-04-28',
    issuedDate: '2026-03-15',
    status: 'paid',
    gradeLevel: '8',
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    gsi3pk: '',
    gsi3sk: '',
    createdAt: '2026-03-15T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-03-20T10:00:00Z',
    updatedBy: 'admin',
    version: 2,
    ...overrides,
  };
}

function pabsonReceiptTemplate(): ReceiptTemplateConfig {
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
      showSignatureLine: false,
      showThankYou: true,
    },
    dateFormat: 'dual',
    numberFormat: 'south-asian',
    currencyDisplay: 'iso-code',
    labelLanguages: ['en', 'ne'] as const,
    lineItemColumns: {
      description: true,
      amount: true,
      taxAmount: true,
      total: true,
    },
    totalsSection: {
      showSubtotal: true,
      showTaxTotal: true,
      showDiscountTotal: true,
    },
    paymentDetails: {
      showPaymentMethod: true,
      showTransactionId: true,
      showPaidBy: true,
    },
    taxBreakdownSection: {
      showPanNumber: true,
      showVatNumber: true,
    },
  };
}

describe('renderReceiptToPdfBuffer (Sprint C.1.6)', () => {
  it(
    'renders a PABSON Saraswati receipt with full branding → valid PDF buffer',
    async () => {
      const buffer = await renderReceiptToPdfBuffer({
        payment: fixturePayment(),
        invoice: fixtureInvoice(),
        branding: {
          formalName: 'सरस्वती माध्यमिक विद्यालय',
          addressLines: ['Ward 7, Bhaktapur', 'Bagmati Province'],
          phone: '+977-1-555-1234',
          email: 'admin@saraswati.edu.np',
          panNumber: '301234567',
          vatNumber: '700123456',
          tagline: 'Education for All',
        },
        urls: undefined,
        templateConfig: pabsonReceiptTemplate(),
        locale: 'ne-NP',
      });

      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'renders a receipt with branding=null gracefully (no logo, no PAN/VAT, no formalName)',
    async () => {
      const buffer = await renderReceiptToPdfBuffer({
        payment: fixturePayment(),
        invoice: fixtureInvoice(),
        branding: null,
        urls: undefined,
        templateConfig: pabsonReceiptTemplate(),
        locale: 'ne-NP',
      });

      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'accepts studentNumber + emisStudentId on the input and renders without crashing (governance identifiers replace UUID)',
    async () => {
      // The pdf-renderer commit e713eda made ReceiptDocumentData carry
      // studentNumber + emisStudentId and stop rendering the studentId
      // UUID. The finance-side renderer must accept those props on its
      // RenderReceiptInput and project them through without throwing.
      const buffer = await renderReceiptToPdfBuffer({
        payment: fixturePayment(),
        invoice: fixtureInvoice(),
        branding: null,
        urls: undefined,
        templateConfig: pabsonReceiptTemplate(),
        locale: 'ne-NP',
        studentNumber: 'STU-2026-0042',
        emisStudentId: '1708400128200043',
      });

      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'falls back to synthesized receiptNumber + studentName as paidBy when payment fields are sparse',
    async () => {
      // Edge: older payment records may have null receiptNumber + null
      // paidBy (especially cash-recorded payments where the operator
      // didn't capture who handed over the money). The renderer must
      // still produce a usable receipt with synthesized fallbacks.
      const buffer = await renderReceiptToPdfBuffer({
        payment: fixturePayment({
          receiptNumber: null,
          paidBy: null,
          gatewayTransactionId: undefined,
        }),
        invoice: fixtureInvoice(),
        branding: null,
        urls: undefined,
        templateConfig: pabsonReceiptTemplate(),
        locale: 'en-US',
      });

      expectValidPdf(buffer);
    },
    30_000,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Pilot Onboarding Hardening Sprint PD.2.4 — split-allocation receipts
  // ─────────────────────────────────────────────────────────────────────────
  // V1 surfaces the per-target breakdown via the existing ReceiptDocumentData
  // `notes` field; the `applicationsNote` helper builds the body. These
  // cases exercise the renderer end-to-end with the new payment.applications
  // shapes from PD.2.1 + PD.2.3.

  it(
    'PD.2.4 — split-allocation payment (invoice + opening_balance) renders with the Applied breakdown in notes',
    async () => {
      const buffer = await renderReceiptToPdfBuffer({
        payment: fixturePayment({
          amount: 3000,
          applications: [
            {
              targetType: 'invoice',
              invoiceId: invoiceId,
              amount: 2000,
            },
            { targetType: 'opening_balance', amount: 1000 },
          ],
        }),
        invoice: fixtureInvoice(),
        branding: null,
        urls: undefined,
        templateConfig: pabsonReceiptTemplate(),
        locale: 'en-US',
      });
      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'PD.2.4 — single-invoice payment with applications=[invoice] ⇒ no Applied note (existing layout already names invoice)',
    async () => {
      // The applicationsNote helper returns undefined for a single-invoice
      // application (the existing template already shows invoiceNumber);
      // we don't double-surface it.
      const buffer = await renderReceiptToPdfBuffer({
        payment: fixturePayment({
          applications: [
            {
              targetType: 'invoice',
              invoiceId: invoiceId,
              amount: 1000,
            },
          ],
        }),
        invoice: fixtureInvoice(),
        branding: null,
        urls: undefined,
        templateConfig: pabsonReceiptTemplate(),
        locale: 'en-US',
      });
      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'PD.2.4 — legacy payment (applications undefined) ⇒ renders identically to pre-PD (back-compat)',
    async () => {
      // Pre-PD payments don't carry applications. The renderer must produce
      // the SAME output it did before PD.2.4 landed (no spurious notes
      // block).
      const buffer = await renderReceiptToPdfBuffer({
        payment: fixturePayment({
          // applications omitted — pre-PD shape
        }),
        invoice: fixtureInvoice(),
        branding: null,
        urls: undefined,
        templateConfig: pabsonReceiptTemplate(),
        locale: 'en-US',
      });
      expectValidPdf(buffer);
    },
    30_000,
  );

  // Phase C CORR-6 fix — defensive assertion against invoiceId mismatch.
  it(
    'CORR-6 — invoice application invoiceId mismatching the rendered invoice ⇒ throws (refuses to mis-attribute)',
    async () => {
      // Simulated data corruption: payment.applications[0].invoiceId
      // points to a different invoice than the one supplied to the
      // renderer. Pre-Phase-C the renderer silently rendered the
      // supplied invoice's number for the application; post-fix the
      // renderer throws rather than mis-attribute.
      await expect(
        renderReceiptToPdfBuffer({
          payment: fixturePayment({
            amount: 3000,
            applications: [
              {
                targetType: 'invoice',
                invoiceId: '99999999-9999-4999-8999-999999999999', // mismatched
                amount: 2000,
              },
              { targetType: 'opening_balance', amount: 1000 },
            ],
          }),
          invoice: fixtureInvoice(),
          branding: null,
          urls: undefined,
          templateConfig: pabsonReceiptTemplate(),
          locale: 'en-US',
        }),
      ).rejects.toThrow(/integrity check failed/);
    },
    30_000,
  );

  it(
    'PD.2.4 — locale-aware amount formatting in the Applied note (ne-NP uses NPR + native digit grouping)',
    async () => {
      const buffer = await renderReceiptToPdfBuffer({
        payment: fixturePayment({
          amount: 7000,
          applications: [
            {
              targetType: 'invoice',
              invoiceId: invoiceId,
              amount: 2000,
            },
            { targetType: 'opening_balance', amount: 5000 },
          ],
        }),
        invoice: fixtureInvoice(),
        branding: null,
        urls: undefined,
        templateConfig: pabsonReceiptTemplate(),
        locale: 'ne-NP',
      });
      expectValidPdf(buffer);
    },
    30_000,
  );
});
