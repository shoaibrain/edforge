/**
 * `<InvoicePdf>` end-to-end render smoke — Sprint C.1.1.
 *
 * Three sample configurations exercise the full Latin / Devanagari / dual-
 * language matrix from the design doc §1:
 *   1. PABSON dual-date + EN+NE labels + NPR + south-asian numbers
 *   2. PABSON BS-only + NE-only labels + south-asian numbers
 *   3. GENERIC AD + EN-only + USD + western numbers
 *
 * We do NOT assert byte-identical output across runs (PDFs include timestamps,
 * doc IDs, and float-pixel positioning that can vary non-meaningfully). Each
 * spec asserts the same invariants as render-smoke.spec.tsx:
 *   - the renderer returns a non-empty Buffer
 *   - the buffer starts with the PDF magic bytes (`%PDF-`)
 *   - rendering completes within a reasonable timeout
 *
 * The descriptor-registration spec proves the side-effect import in the
 * package index (`import './descriptors/invoice'`) actually fires and
 * registers the descriptor — without this, `getDescriptor('INVOICE')` would
 * throw at runtime even though `nest build` succeeds.
 */

import * as React from 'react';
import { renderToBuffer } from '@react-pdf/renderer';
import { InvoicePdf, type InvoiceTemplateConfig, type InvoiceDocumentData } from '../documents/InvoicePdf';
import { invoiceDescriptor } from '../descriptors/invoice';
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

describe('<InvoicePdf> — Sprint C.1.1 render canaries', () => {
  it(
    'renders PABSON dual-date + dual-language invoice (EN+NE, BS+AD, NPR)',
    async () => {
      const template = invoiceDescriptor.defaults('PABSON', 'ne-NP');
      const data = invoiceDescriptor.sampleData('PABSON', 'ne-NP');

      const buffer = await renderToBuffer(
        <InvoicePdf
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
      // Take the PABSON default and narrow to single-language + single-calendar
      const baseTemplate = invoiceDescriptor.defaults('PABSON', 'ne-NP');
      const template: InvoiceTemplateConfig = {
        ...baseTemplate,
        labelLanguages: ['ne'] as const,
        dateFormat: 'bikram_sambat',
      };
      const data = invoiceDescriptor.sampleData('PABSON', 'ne-NP');

      const buffer = await renderToBuffer(
        <InvoicePdf
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
    'renders GENERIC AD + English-only invoice (USD)',
    async () => {
      const template = invoiceDescriptor.defaults('GENERIC', 'en-US');
      const data = invoiceDescriptor.sampleData('GENERIC', 'en-US');

      const buffer = await renderToBuffer(
        <InvoicePdf
          data={data}
          template={template}
          branding={{
            ...sampleBranding,
            // Generic doesn't surface Nepali branding fields
            formalName: 'Generic Academy',
            addressLines: ['123 Main St', 'Springfield, IL 62701'],
          }}
          settings={settingsGENERIC}
        />,
      );

      expectValidPdf(buffer);
    },
    30_000,
  );

  it(
    'renders the watermark on a DRAFT invoice',
    async () => {
      const template = invoiceDescriptor.defaults('PABSON', 'ne-NP');
      const data: InvoiceDocumentData = {
        ...invoiceDescriptor.sampleData('PABSON', 'ne-NP'),
        status: 'draft',
      };

      const buffer = await renderToBuffer(
        <InvoicePdf
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

describe('invoiceDescriptor — registry self-registration', () => {
  it("getDescriptor('INVOICE') returns the registered invoice descriptor", () => {
    const fromRegistry = getDescriptor('INVOICE');
    expect(fromRegistry).toBe(invoiceDescriptor);
    expect(fromRegistry.docType).toBe('INVOICE');
    expect(fromRegistry.i18nNamespace).toBe('invoice');
    expect(fromRegistry.Component).toBe(InvoicePdf);
  });

  it('PABSON defaults set dual-language + dual-date + south-asian numbers', () => {
    const config = invoiceDescriptor.defaults('PABSON', 'ne-NP');
    expect(config.labelLanguages).toEqual(['en', 'ne']);
    expect(config.dateFormat).toBe('dual');
    expect(config.numberFormat).toBe('south-asian');
  });

  it('GENERIC defaults narrow to English + gregorian + western numbers', () => {
    const config = invoiceDescriptor.defaults('GENERIC', 'en-US');
    expect(config.labelLanguages).toEqual(['en']);
    expect(config.dateFormat).toBe('gregorian');
    expect(config.numberFormat).toBe('western');
  });

  it('reserved archetypes (CBSE_IN, NAIS_US, GEMS_UAE) fall through to GENERIC profile', () => {
    const cbse = invoiceDescriptor.defaults('CBSE_IN', 'en-IN');
    const nais = invoiceDescriptor.defaults('NAIS_US', 'en-US');
    const gems = invoiceDescriptor.defaults('GEMS_UAE', 'en-AE');
    for (const config of [cbse, nais, gems]) {
      expect(config.labelLanguages).toEqual(['en']);
      expect(config.dateFormat).toBe('gregorian');
    }
  });

  it('declares 13 configurableFields for the C.2.4 editor surface', () => {
    expect(invoiceDescriptor.configurableFields.length).toBe(13);
    // Spot-check the expected categories without coupling to exact order
    const paths = invoiceDescriptor.configurableFields.map(f => f.path);
    expect(paths).toContain('header.showLogo');
    expect(paths).toContain('header.tagline');
    expect(paths).toContain('lineItemColumns.discount');
    expect(paths).toContain('totalsSection.showSubtotal');
    expect(paths).toContain('dateFormat');
  });

  it('sampleData renders a non-empty invoice with at least one line item per archetype', () => {
    for (const archetype of ['PABSON', 'GENERIC'] as const) {
      const data = invoiceDescriptor.sampleData(archetype, 'en-US');
      expect(data.invoiceNumber).toMatch(/^INV-/);
      expect(data.lineItems.length).toBeGreaterThan(0);
      expect(data.grandTotal).toBeGreaterThan(0);
      expect(data.currency).toMatch(/^[A-Z]{3}$/);
    }
  });
});
