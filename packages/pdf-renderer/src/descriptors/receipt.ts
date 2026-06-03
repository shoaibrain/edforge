/**
 * Receipt descriptor — Sprint C.1.2.
 *
 * Second concrete `TemplateDescriptor` registered with the library; same
 * registration + defaults pattern as the invoice descriptor that shipped in
 * Sprint C.1.1. Importing this file is sufficient to make
 * `getDescriptor('RECEIPT')` work via the top-level `registerDescriptor(...)`
 * side effect at the bottom of the file.
 *
 * Defaults mirror the invoice descriptor's PABSON / GENERIC split:
 *   - PABSON ⇒ BS+AD dual dates, EN+NE labels, south-asian numbers, NPR
 *     symbol, PAN/VAT compliance disclosures on.
 *   - GENERIC ⇒ gregorian, EN-only, western, ISO-code currency, tax-
 *     breakdown disclosures off (still operator-toggleable).
 *
 * `configurableFields[]` is the operator-facing customization surface for
 * the C.2.4 generic editor. 17 fields for V1 — slightly more than invoice
 * (13) because receipts add payment-channel + tax-breakdown sub-sections
 * that invoices don't have.
 */

import {
  ReceiptPdf,
  type ReceiptTemplateConfig,
  type ReceiptDocumentData,
} from '../documents/ReceiptPdf';
import { registerDescriptor } from './registry';
import type {
  Archetype,
  ConfigurableField,
  TemplateDescriptor,
} from './types';

/**
 * Default `ReceiptTemplateConfig` for a freshly-seeded template. PABSON
 * gets the dual-language + tax-compliance bundle; GENERIC + reserved
 * archetypes (`CBSE_IN`, `NAIS_US`, `GEMS_UAE`) fall through to a slim
 * Western default.
 */
function receiptDefaults(archetype: Archetype, _locale: string): ReceiptTemplateConfig {
  const isPabson = archetype === 'PABSON';
  return {
    pageSize: 'A4',
    orientation: 'portrait',
    margins: { top: 15, right: 15, bottom: 15, left: 15 },
    header: {
      showLogo: true,
      showSchoolName: true,
      showSchoolAddress: true,
      showContact: true,
      tagline: isPabson ? 'Education for All' : undefined,
    },
    footer: {
      text: undefined,
      showPageNumbers: true,
      showSignatureLine: false, // receipts traditionally don't need a signature line
      showThankYou: true,
    },
    dateFormat: isPabson ? 'dual' : 'gregorian',
    numberFormat: isPabson ? 'south-asian' : 'western',
    currencyDisplay: 'iso-code',
    labelLanguages: isPabson ? (['en', 'ne'] as const) : (['en'] as const),
    lineItemColumns: {
      description: true,
      amount: true,
      taxAmount: isPabson, // PABSON typically shows VAT per line; GENERIC schools can opt in.
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
      // PABSON tenants register PAN/VAT for VAT compliance — defaults on so
      // the compliance block renders without operator config. GENERIC schools
      // usually don't carry PAN/VAT and can leave these off; the block also
      // gracefully omits at render time when the underlying branding fields
      // are absent (see ReceiptPdf taxEntries).
      showPanNumber: isPabson,
      showVatNumber: isPabson,
    },
  };
}

/**
 * Sample data for the C.2.4 editor preview path. Mirrors a realistic Saraswati
 * receipt for the same invoice the C.1.1 invoiceSampleData uses (so a side-
 * by-side editor preview lines up cleanly between Invoice and Receipt).
 */
function receiptSampleData(archetype: Archetype, _locale: string): ReceiptDocumentData {
  const isPabson = archetype === 'PABSON';
  return {
    receiptNumber: 'RCT-2026-001234',
    paidDate: '2026-03-20',
    invoiceNumber: 'INV-2026-001234',
    transactionId: isPabson ? 'TXN-ESWA-987654321' : 'TXN-STRP-pi_3PqXyz',
    paymentMethod: isPabson ? 'eSewa' : 'Card',
    paidBy: isPabson ? 'सरस्वती शर्मा' : 'Saraswati Sharma',
    studentName: isPabson ? 'सरस्वती शर्मा' : 'Saraswati Sharma',
    studentNumber: 'STU-2025-0042',
    emisStudentId: isPabson ? '1708400128200043' : undefined,
    gradeLevel: '8',
    academicYear: '2025-2026',
    billingPeriod: isPabson ? 'चैत 2082' : 'Q1 2026',
    lineItems: [
      {
        description: isPabson ? 'ट्यूशन शुल्क — कक्षा ८' : 'Tuition Fee — Grade 8',
        amount: 10000,
        taxAmount: 1235,
        total: 10735,
      },
      {
        description: isPabson ? 'पुस्तकालय शुल्क' : 'Library Fee',
        amount: 500,
        taxAmount: 0,
        total: 500,
      },
    ],
    subtotal: 10500,
    taxTotal: 1235,
    discountTotal: 500,
    grandTotal: 11235,
    paidAmount: 11235,
    currency: isPabson ? 'NPR' : 'USD',
    taxableAmount: 10500,
    taxAmount: 1235,
    notes: isPabson
      ? 'कृपया यो रसिद आफ्नो रेकर्डका लागि सुरक्षित राख्नुहोस्।'
      : 'Please keep this receipt for your records.',
    status: 'paid',
  };
}

/**
 * 17 configurable fields surfaced in the C.2.4 editor. Field count is
 * deliberately a tad larger than invoice's 13 because receipts expose
 * payment-channel + tax-breakdown sub-sections that invoices don't have.
 *
 * Field IDs are dot-paths into `ReceiptTemplateConfig`. Editor RHF
 * Controllers register at exactly these paths — see invoice descriptor's
 * configurableFields[] for the matching convention.
 */
const receiptConfigurableFields: readonly ConfigurableField[] = [
  // Header (5)
  { path: 'header.showLogo', type: 'toggle', labelKey: 'field.header.showLogo' },
  { path: 'header.showSchoolName', type: 'toggle', labelKey: 'field.header.showSchoolName' },
  { path: 'header.showSchoolAddress', type: 'toggle', labelKey: 'field.header.showSchoolAddress' },
  { path: 'header.showContact', type: 'toggle', labelKey: 'field.header.showContact' },
  { path: 'header.tagline', type: 'text', labelKey: 'field.header.tagline' },
  // Line items — only taxAmount toggleable (description/amount/total always-on)
  { path: 'lineItemColumns.taxAmount', type: 'toggle', labelKey: 'field.lineItems.taxAmount' },
  // Totals (3 toggleable)
  { path: 'totalsSection.showSubtotal', type: 'toggle', labelKey: 'field.totals.showSubtotal' },
  { path: 'totalsSection.showTaxTotal', type: 'toggle', labelKey: 'field.totals.showTaxTotal' },
  { path: 'totalsSection.showDiscountTotal', type: 'toggle', labelKey: 'field.totals.showDiscountTotal' },
  // Payment details (3 toggleable)
  { path: 'paymentDetails.showPaymentMethod', type: 'toggle', labelKey: 'field.payment.showPaymentMethod' },
  { path: 'paymentDetails.showTransactionId', type: 'toggle', labelKey: 'field.payment.showTransactionId' },
  { path: 'paymentDetails.showPaidBy', type: 'toggle', labelKey: 'field.payment.showPaidBy' },
  // Tax breakdown (2 toggleable)
  { path: 'taxBreakdownSection.showPanNumber', type: 'toggle', labelKey: 'field.tax.showPanNumber' },
  { path: 'taxBreakdownSection.showVatNumber', type: 'toggle', labelKey: 'field.tax.showVatNumber' },
  // Footer (2 toggleable)
  { path: 'footer.showThankYou', type: 'toggle', labelKey: 'field.footer.showThankYou' },
  { path: 'footer.showSignatureLine', type: 'toggle', labelKey: 'field.footer.showSignatureLine' },
  // Localization (1)
  {
    path: 'dateFormat',
    type: 'select',
    labelKey: 'field.dateFormat',
    options: ['gregorian', 'bikram_sambat', 'dual'] as const,
  },
];

export const receiptDescriptor: TemplateDescriptor<ReceiptDocumentData, ReceiptTemplateConfig> = {
  docType: 'RECEIPT',
  i18nNamespace: 'receipt',
  Component: ReceiptPdf,
  defaults: receiptDefaults,
  sampleData: receiptSampleData,
  configurableFields: receiptConfigurableFields,
};

// Self-register at module load — consumers only need
// `import '@aibrains/pdf-renderer/descriptors/receipt'` (or transitive via
// the package index) for `getDescriptor('RECEIPT')` to resolve.
registerDescriptor(receiptDescriptor);
