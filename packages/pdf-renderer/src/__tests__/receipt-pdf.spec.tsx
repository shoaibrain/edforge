/**
 * `<ReceiptPdf>` end-to-end render smoke — Sprint C.1.2.
 *
 * Mirrors the invoice-pdf canary matrix: PABSON dual-lang + dual-date,
 * PABSON Nepali-only with BS-only dates, GENERIC AD + EN-only. Adds a
 * VOIDED-status canary to exercise the watermark path (mirrors the DRAFT
 * canary on invoice). Receipts don't have a 'draft' state — 'paid' is the
 * happy path (no watermark) and 'voided' + 'refunded' get a watermark.
 *
 * Same buffer-shape invariants as invoice-pdf — we don't assert byte-
 * identical output across runs (PDFs carry timestamps + doc IDs):
 *   - non-empty Buffer
 *   - starts with PDF magic bytes (`%PDF-`)
 *   - rendering completes within the 30s test timeout
 *
 * The descriptor-registration spec proves the side-effect import in the
 * package index (`import './descriptors/receipt'`) actually fires —
 * without this, `getDescriptor('RECEIPT')` would throw at runtime even
 * though `nest build` succeeds.
 */

import * as React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import {
  ReceiptPdf,
  type ReceiptTemplateConfig,
  type ReceiptDocumentData,
} from '../documents/ReceiptPdf';
import { receiptDescriptor } from '../descriptors/receipt';
import { getDescriptor } from '../descriptors/registry';
import type { PdfBranding, PdfLocaleSettings } from '../descriptors/types';

const PDF_MAGIC = Buffer.from('%PDF-', 'utf-8');

function expectValidPdf(buffer: Buffer): void {
  expect(buffer).toBeInstanceOf(Buffer);
  expect(buffer.length).toBeGreaterThan(500);
  expect(buffer.subarray(0, 5).equals(PDF_MAGIC)).toBe(true);
}

const sampleBranding: PdfBranding = {
  schoolName: 'Saraswati Higher Secondary School',
  formalName: 'सरस्वती माध्यमिक विद्यालय',
  addressLines: ['Ward 7, Bhaktapur', 'Bagmati Province'],
  phone: '+977-1-555-1234',
  email: 'admin@saraswati.edu.np',
  primaryColor: '#1F4E79',
  accentColor: '#FFC000',
  panNumber: '301234567',
  vatNumber: '700123456',
};

const settingsPABSON: PdfLocaleSettings = {
  defaultLocale: 'ne-NP',
  defaultCurrency: 'NPR',
  defaultCalendarSystem: 'bikram_sambat',
  defaultTimeZone: 'Asia/Kathmandu',
};

const settingsGENERIC: PdfLocaleSettings = {
  defaultLocale: 'en-US',
  defaultCurrency: 'USD',
  defaultCalendarSystem: 'gregorian',
  defaultTimeZone: 'America/New_York',
};

describe('<ReceiptPdf> — Sprint C.1.2 render canaries', () => {
  it(
    'renders PABSON dual-date + dual-language receipt (EN+NE, BS+AD, NPR)',
    async () => {
      const template = receiptDescriptor.defaults('PABSON', 'ne-NP');
      const data = receiptDescriptor.sampleData('PABSON', 'ne-NP');

      const buffer = await renderToBuffer(
        <ReceiptPdf
          data={data}
          template={template}
          branding={sampleBranding}
          settings={settingsPABSON}
        />,
      );

      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'renders PABSON Nepali-only with BS-only dates',
    async () => {
      const baseTemplate = receiptDescriptor.defaults('PABSON', 'ne-NP');
      const template: ReceiptTemplateConfig = {
        ...baseTemplate,
        labelLanguages: ['ne'] as const,
        dateFormat: 'bikram_sambat',
      };
      const data = receiptDescriptor.sampleData('PABSON', 'ne-NP');

      const buffer = await renderToBuffer(
        <ReceiptPdf
          data={data}
          template={template}
          branding={sampleBranding}
          settings={settingsPABSON}
        />,
      );

      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'renders GENERIC AD + English-only receipt (USD)',
    async () => {
      const template = receiptDescriptor.defaults('GENERIC', 'en-US');
      const data = receiptDescriptor.sampleData('GENERIC', 'en-US');

      const buffer = await renderToBuffer(
        <ReceiptPdf
          data={data}
          template={template}
          branding={{
            ...sampleBranding,
            formalName: 'Generic Academy',
            addressLines: ['123 Main St', 'Springfield, IL 62701'],
            // Generic schools typically don't carry PAN/VAT
            panNumber: undefined,
            vatNumber: undefined,
          }}
          settings={settingsGENERIC}
        />,
      );

      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'renders the watermark on a VOIDED receipt',
    async () => {
      const template = receiptDescriptor.defaults('PABSON', 'ne-NP');
      const data: ReceiptDocumentData = {
        ...receiptDescriptor.sampleData('PABSON', 'ne-NP'),
        status: 'voided',
      };

      const buffer = await renderToBuffer(
        <ReceiptPdf
          data={data}
          template={template}
          branding={sampleBranding}
          settings={settingsPABSON}
        />,
      );

      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'renders the watermark on a REFUNDED receipt',
    async () => {
      const template = receiptDescriptor.defaults('PABSON', 'ne-NP');
      const data: ReceiptDocumentData = {
        ...receiptDescriptor.sampleData('PABSON', 'ne-NP'),
        status: 'refunded',
      };

      const buffer = await renderToBuffer(
        <ReceiptPdf
          data={data}
          template={template}
          branding={sampleBranding}
          settings={settingsPABSON}
        />,
      );

      expectValidPdf(buffer);
    },
    30_000,
  );
});

describe('receiptDescriptor — registry self-registration', () => {
  it("getDescriptor('RECEIPT') returns the registered receipt descriptor", () => {
    const fromRegistry = getDescriptor('RECEIPT');
    expect(fromRegistry).toBe(receiptDescriptor);
    expect(fromRegistry.docType).toBe('RECEIPT');
    expect(fromRegistry.i18nNamespace).toBe('receipt');
    expect(fromRegistry.Component).toBe(ReceiptPdf);
  });

  it('PABSON defaults set dual-language + dual-date + south-asian numbers + tax disclosure ON', () => {
    const config = receiptDescriptor.defaults('PABSON', 'ne-NP');
    expect(config.labelLanguages).toEqual(['en', 'ne']);
    expect(config.dateFormat).toBe('dual');
    expect(config.numberFormat).toBe('south-asian');
    expect(config.taxBreakdownSection.showPanNumber).toBe(true);
    expect(config.taxBreakdownSection.showVatNumber).toBe(true);
    expect(config.lineItemColumns.taxAmount).toBe(true);
  });

  it('GENERIC defaults narrow to English + gregorian + western numbers + tax disclosure OFF', () => {
    const config = receiptDescriptor.defaults('GENERIC', 'en-US');
    expect(config.labelLanguages).toEqual(['en']);
    expect(config.dateFormat).toBe('gregorian');
    expect(config.numberFormat).toBe('western');
    expect(config.taxBreakdownSection.showPanNumber).toBe(false);
    expect(config.taxBreakdownSection.showVatNumber).toBe(false);
  });

  it('reserved archetypes (CBSE_IN, NAIS_US, GEMS_UAE) fall through to GENERIC profile', () => {
    const cbse = receiptDescriptor.defaults('CBSE_IN', 'en-IN');
    const nais = receiptDescriptor.defaults('NAIS_US', 'en-US');
    const gems = receiptDescriptor.defaults('GEMS_UAE', 'en-AE');
    for (const config of [cbse, nais, gems]) {
      expect(config.labelLanguages).toEqual(['en']);
      expect(config.dateFormat).toBe('gregorian');
      expect(config.taxBreakdownSection.showPanNumber).toBe(false);
    }
  });

  it('declares 17 configurableFields for the C.2.4 editor surface', () => {
    expect(receiptDescriptor.configurableFields.length).toBe(17);
    const paths = receiptDescriptor.configurableFields.map((f) => f.path);
    // Header
    expect(paths).toContain('header.showLogo');
    expect(paths).toContain('header.tagline');
    // Line items
    expect(paths).toContain('lineItemColumns.taxAmount');
    // Totals
    expect(paths).toContain('totalsSection.showSubtotal');
    // Payment details
    expect(paths).toContain('paymentDetails.showPaymentMethod');
    expect(paths).toContain('paymentDetails.showTransactionId');
    expect(paths).toContain('paymentDetails.showPaidBy');
    // Tax breakdown
    expect(paths).toContain('taxBreakdownSection.showPanNumber');
    expect(paths).toContain('taxBreakdownSection.showVatNumber');
    // Footer
    expect(paths).toContain('footer.showThankYou');
    expect(paths).toContain('footer.showSignatureLine');
    // Localization
    expect(paths).toContain('dateFormat');
  });

  it('sampleData renders a non-empty receipt with at least one line item per archetype', () => {
    for (const archetype of ['PABSON', 'GENERIC'] as const) {
      const data = receiptDescriptor.sampleData(archetype, 'en-US');
      expect(data.receiptNumber).toMatch(/^RCT-/);
      expect(data.invoiceNumber).toMatch(/^INV-/);
      expect(data.lineItems.length).toBeGreaterThan(0);
      expect(data.grandTotal).toBeGreaterThan(0);
      expect(data.paidAmount).toBe(data.grandTotal); // Full-pay sample
      expect(data.currency).toMatch(/^[A-Z]{3}$/);
      expect(data.status).toBe('paid');
    }
  });
});
