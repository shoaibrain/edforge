/**
 * Invoice descriptor — Sprint C.1.1.
 *
 * The first concrete `TemplateDescriptor` registered with the library.
 * Registers itself at module load via the top-level `registerDescriptor(...)`
 * call below — importing this file is sufficient to make
 * `getDescriptor('INVOICE')` work.
 *
 * Defaults are split between PABSON and GENERIC archetypes per the design
 * doc §1: PABSON ⇒ BS+AD dual dates + EN+NE labels + south-asian numbers +
 * NPR symbol; GENERIC ⇒ gregorian + EN-only + western + ISO-code currency.
 *
 * `configurableFields[]` is the operator-facing customization surface that
 * the C.2.4 generic editor renders form sections from. 13 fields for V1.
 */

import { InvoicePdf, type InvoiceTemplateConfig, type InvoiceDocumentData } from '../documents/InvoicePdf';
import { registerDescriptor } from './registry';
import type {
  Archetype,
  ConfigurableField,
  TemplateDescriptor,
} from './types';

/**
 * The default `InvoiceTemplateConfig` for a freshly-seeded template.
 * Returns PABSON-flavor when the tenant archetype is `'PABSON'`, GENERIC
 * for everything else. Reserved archetypes (`CBSE_IN`, `NAIS_US`,
 * `GEMS_UAE`) fall through to GENERIC per the design doc § 1.
 */
function invoiceDefaults(archetype: Archetype, _locale: string): InvoiceTemplateConfig {
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
      showSignatureLine: true,
    },
    dateFormat: isPabson ? 'dual' : 'gregorian',
    numberFormat: isPabson ? 'south-asian' : 'western',
    currencyDisplay: 'iso-code',
    labelLanguages: isPabson ? (['en', 'ne'] as const) : (['en'] as const),
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

/**
 * Sample data for the C.2.4 editor's "default mock" preview path. The shape
 * mirrors a realistic Saraswati Q1 invoice — one tuition fee + one library fee,
 * with a discount + VAT row to exercise every line-item column.
 */
function invoiceSampleData(archetype: Archetype, _locale: string): InvoiceDocumentData {
  const isPabson = archetype === 'PABSON';
  return {
    invoiceNumber: 'INV-2026-001234',
    issuedDate: '2026-03-15',
    dueDate: '2026-04-28',
    academicYear: '2025-2026',
    billingPeriod: isPabson ? 'चैत 2082' : 'Q1 2026',
    studentName: isPabson ? 'सरस्वती शर्मा' : 'Saraswati Sharma',
    studentId: 'STU-2025-0042',
    gradeLevel: '8',
    lineItems: [
      {
        description: isPabson ? 'ट्यूशन शुल्क — कक्षा ८' : 'Tuition Fee — Grade 8',
        quantity: 1,
        amount: 10000,
        discount: 500,
        taxRate: 13,
        taxAmount: 1235,
        total: 10735,
      },
      {
        description: isPabson ? 'पुस्तकालय शुल्क' : 'Library Fee',
        quantity: 1,
        amount: 500,
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
    currency: isPabson ? 'NPR' : 'USD',
    status: 'issued',
    notes: isPabson
      ? 'कृपया भुक्तानी मिति भित्र भुक्तानी गर्नुहोला।'
      : 'Please pay by the due date to avoid late fees.',
  };
}

/**
 * 13 configurable fields surfaced in the C.2.4 editor. Adding a field here =
 * one more form section appears in the editor, no editor code change required.
 *
 * Field IDs are dot-paths into `InvoiceTemplateConfig`. Editor RHF Controllers
 * register at exactly these paths so the form state shape matches the config
 * shape — `Object.assign(template, formState)` is a one-line apply on save.
 */
const invoiceConfigurableFields: readonly ConfigurableField[] = [
  // Header (5 fields)
  { path: 'header.showLogo', type: 'toggle', labelKey: 'field.header.showLogo' },
  { path: 'header.showSchoolName', type: 'toggle', labelKey: 'field.header.showSchoolName' },
  { path: 'header.showSchoolAddress', type: 'toggle', labelKey: 'field.header.showSchoolAddress' },
  { path: 'header.showContact', type: 'toggle', labelKey: 'field.header.showContact' },
  { path: 'header.tagline', type: 'text', labelKey: 'field.header.tagline' },
  // Line item columns (3 toggleable; description/amount/total always-on)
  { path: 'lineItemColumns.quantity', type: 'toggle', labelKey: 'field.lineItems.quantity' },
  { path: 'lineItemColumns.discount', type: 'toggle', labelKey: 'field.lineItems.discount' },
  { path: 'lineItemColumns.taxRate', type: 'toggle', labelKey: 'field.lineItems.taxRate' },
  { path: 'lineItemColumns.taxAmount', type: 'toggle', labelKey: 'field.lineItems.taxAmount' },
  // Totals (3 toggleable)
  { path: 'totalsSection.showSubtotal', type: 'toggle', labelKey: 'field.totals.showSubtotal' },
  { path: 'totalsSection.showTaxTotal', type: 'toggle', labelKey: 'field.totals.showTaxTotal' },
  { path: 'totalsSection.showDiscountTotal', type: 'toggle', labelKey: 'field.totals.showDiscountTotal' },
  // Localization (2)
  {
    path: 'dateFormat',
    type: 'select',
    labelKey: 'field.dateFormat',
    options: ['gregorian', 'bikram_sambat', 'dual'] as const,
  },
];

export const invoiceDescriptor: TemplateDescriptor<InvoiceDocumentData, InvoiceTemplateConfig> = {
  docType: 'INVOICE',
  i18nNamespace: 'invoice',
  Component: InvoicePdf,
  defaults: invoiceDefaults,
  sampleData: invoiceSampleData,
  configurableFields: invoiceConfigurableFields,
};

// Self-register at module load. Consumers only need
// `import '@aibrains/pdf-renderer/descriptors/invoice'` (or transitive via
// the package index) for `getDescriptor('INVOICE')` to resolve.
registerDescriptor(invoiceDescriptor);
