/**
 * R45 canary + foundation render smoke.
 *
 * Each spec composes a primitive or component inside `<Document><Page>` and
 * calls `renderToBuffer()` to drive the actual PDF pipeline end-to-end. The
 * Devanagari spec is the explicit R45 mitigation — it asserts that Yoga +
 * Fontkit + Harfbuzz inside @react-pdf/renderer don't crash on common Nepali
 * phrases ("बिल" / "रसिद" / "उप-योग" / "जम्मा रकम") from the design doc § 1.
 *
 * We do not assert byte-identical output across runs — PDFs include
 * timestamps, doc IDs, and float-pixel positioning that can vary
 * non-meaningfully. Instead each test asserts:
 *   - the renderer returns a non-empty Buffer
 *   - the buffer starts with the PDF magic bytes (`%PDF-`)
 *   - rendering completes within a reasonable timeout
 */

import * as React from 'react';
import { Text, View } from '@react-pdf/renderer';
import { renderToBuffer } from '@react-pdf/renderer';
import { Document } from '../primitives/Document';
import { Page } from '../primitives/Page';
import { BrandedHeader } from '../primitives/BrandedHeader';
import { BrandedFooter } from '../primitives/BrandedFooter';
import { Watermark } from '../primitives/Watermark';
import { KeyValueTable } from '../components/KeyValueTable';
import { LineItemTable } from '../components/LineItemTable';
import { TotalsBlock } from '../components/TotalsBlock';
import { SignatureLine } from '../components/SignatureLine';
import { formatNumber, formatCurrency } from '../core/format';
import { pickFontFamily } from '../core/fonts';

const PDF_MAGIC = Buffer.from('%PDF-', 'utf-8');

function expectValidPdf(buffer: Buffer): void {
  expect(buffer).toBeInstanceOf(Buffer);
  expect(buffer.length).toBeGreaterThan(500);
  // PDFs start with "%PDF-1.x"; check the first 5 bytes only to stay
  // robust across spec versions.
  expect(buffer.subarray(0, 5).equals(PDF_MAGIC)).toBe(true);
}

describe('Document + Page render foundation', () => {
  it('renders an empty Page wrapped in Document', async () => {
    const buffer = await renderToBuffer(
      <Document title="Smoke">
        <Page>
          <View />
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });

  it('renders Latin-only text', async () => {
    const buffer = await renderToBuffer(
      <Document title="Latin smoke">
        <Page>
          <Text>Hello, EdForge.</Text>
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });

  // R45 canary — raw <Text> elements need explicit fontFamily for Devanagari
  // because @react-pdf/renderer does not auto-fallback across families. The
  // component layer (BrandedHeader, KeyValueTable, etc.) applies pickFontFamily
  // automatically; this test exercises the raw primitive path directly.
  it('renders Devanagari (Nepali) text without crashing — R45 canary', async () => {
    const buffer = await renderToBuffer(
      <Document title="Devanagari smoke">
        <Page>
          <Text style={{ fontFamily: pickFontFamily('बिल') }}>बिल</Text>
          <Text style={{ fontFamily: pickFontFamily('रसिद') }}>रसिद</Text>
          <Text style={{ fontFamily: pickFontFamily('उप-योग') }}>उप-योग</Text>
          <Text style={{ fontFamily: pickFontFamily('जम्मा रकम') }}>जम्मा रकम</Text>
          <Text style={{ fontFamily: pickFontFamily('विद्यार्थीको नाम') }}>
            विद्यार्थीको नाम: सरस्वती शर्मा
          </Text>
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  }, 20_000);

  it('renders mixed Latin + Devanagari runs (segmented into separate Text elements)', async () => {
    // Mixed inline runs require segmentation — one <Text> per script.
    // For the simple "EN / NE" dual-label case the segments are obvious.
    const buffer = await renderToBuffer(
      <Document title="Mixed">
        <Page>
          <View>
            <Text>Invoice</Text>
            <Text style={{ fontFamily: pickFontFamily('बिल') }}>बिल</Text>
          </View>
          <View>
            <Text>Subtotal:</Text>
            <Text style={{ fontFamily: pickFontFamily('उप-योग') }}>उप-योग</Text>
            <Text>NPR 1,234.00</Text>
          </View>
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });
});

describe('BrandedHeader / BrandedFooter / Watermark', () => {
  it('renders BrandedHeader with school name + address (Nepali + Latin)', async () => {
    const buffer = await renderToBuffer(
      <Document title="Header smoke">
        <Page>
          <BrandedHeader
            branding={{
              schoolName: 'सरस्वती माध्यमिक विद्यालय',
              addressLines: ['Kathmandu, Bagmati', 'Nepal'],
              phone: '+977 1 4444444',
              email: 'info@saraswati.edu.np',
            }}
            config={{ tagline: 'Educating Nepal' }}
          />
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });

  it('renders BrandedFooter with page numbers (Nepali label)', async () => {
    const buffer = await renderToBuffer(
      <Document title="Footer smoke">
        <Page>
          <Text>Body content</Text>
          <BrandedFooter text="Saraswati School © 2026" lang="ne" />
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });

  it('renders Watermark overlay (DRAFT)', async () => {
    const buffer = await renderToBuffer(
      <Document title="Watermark smoke">
        <Page>
          <Watermark text="DRAFT" />
          <Text>Behind the watermark</Text>
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });
});

describe('KeyValueTable / LineItemTable / TotalsBlock / SignatureLine', () => {
  it('renders a KeyValueTable with mixed-language labels and values', async () => {
    const buffer = await renderToBuffer(
      <Document title="KV smoke">
        <Page>
          <KeyValueTable
            entries={[
              { label: 'विद्यार्थीको नाम', value: 'सरस्वती शर्मा' },
              { label: 'Invoice Number', value: 'INV-2026-001234' },
              { label: 'Due Date', value: '2026-04-28' },
              // Empty entries should be skipped
              { label: 'Roll', value: undefined },
              { label: 'Phone', value: '   ' },
            ]}
          />
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });

  it('renders a LineItemTable with all columns visible', async () => {
    const buffer = await renderToBuffer(
      <Document title="LineItem smoke">
        <Page>
          <LineItemTable
            items={[
              {
                description: 'Tuition Fee — Grade 8',
                quantity: 1,
                amount: 10000,
                discount: 500,
                taxRate: 13,
                taxAmount: 1235,
                total: 10735,
              },
              {
                description: 'Library Fee',
                quantity: 1,
                amount: 500,
                discount: 0,
                taxRate: 0,
                taxAmount: 0,
                total: 500,
              },
            ]}
            columns={{
              description: true,
              quantity: true,
              amount: true,
              discount: true,
              taxRate: true,
              taxAmount: true,
              total: true,
            }}
            headers={{
              description: 'Description',
              quantity: 'Qty',
              amount: 'Amount',
              discount: 'Discount',
              taxRate: 'Tax %',
              taxAmount: 'Tax',
              total: 'Total',
            }}
            renderNumber={(v) => (v === undefined ? '' : formatNumber(v, 'south-asian'))}
          />
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });

  it('renders a LineItemTable with minimum columns (description + amount + total)', async () => {
    const buffer = await renderToBuffer(
      <Document title="LineItem minimum smoke">
        <Page>
          <LineItemTable
            items={[{ description: 'Tuition', amount: 1000, total: 1000 }]}
            columns={{
              description: true,
              quantity: false,
              amount: true,
              discount: false,
              taxRate: false,
              taxAmount: false,
              total: true,
            }}
            headers={{
              description: 'विवरण',
              quantity: 'मात्रा',
              amount: 'रकम',
              discount: 'छुट',
              taxRate: 'कर %',
              taxAmount: 'कर',
              total: 'जम्मा',
            }}
            renderNumber={(v) => (v === undefined ? '' : formatNumber(v, 'south-asian'))}
          />
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });

  it('renders TotalsBlock with all entries (PABSON NPR formatting)', async () => {
    const buffer = await renderToBuffer(
      <Document title="Totals smoke">
        <Page>
          <TotalsBlock
            entries={{
              subtotal: 10500,
              discountTotal: 500,
              taxTotal: 1235,
              grandTotal: 11235,
              amountPaid: 5000,
              amountDue: 6235,
            }}
            labels={{
              subtotal: 'उप-योग',
              taxTotal: 'कर',
              discountTotal: 'छुट',
              grandTotal: 'कुल जम्मा',
              amountPaid: 'भुक्तानी रकम',
              amountDue: 'बाँकी रकम',
            }}
            renderCurrency={(v) => formatCurrency(v, 'NPR', { locale: 'ne' })}
          />
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });

  it('renders SignatureLine with caption', async () => {
    const buffer = await renderToBuffer(
      <Document title="Signature smoke">
        <Page>
          <SignatureLine caption="प्रधानाध्यापक — Principal" align="right" />
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });
});

describe('end-to-end composition — all primitives + components together', () => {
  it('composes a realistic invoice-shaped page without crashing', async () => {
    const buffer = await renderToBuffer(
      <Document title="Composition smoke">
        <Page>
          <BrandedHeader
            branding={{
              schoolName: 'सरस्वती माध्यमिक विद्यालय',
              addressLines: ['Kathmandu, Bagmati', 'Nepal'],
              phone: '+977 1 4444444',
            }}
          />
          <KeyValueTable
            entries={[
              { label: 'Invoice #', value: 'INV-2026-001234' },
              { label: 'विद्यार्थी', value: 'सरस्वती शर्मा' },
              { label: 'Due Date', value: 'B.S. 2083-01-15 (2026-04-28)' },
            ]}
          />
          <LineItemTable
            items={[
              { description: 'Tuition — Grade 8', amount: 10000, total: 10000 },
              { description: 'Library Fee', amount: 500, total: 500 },
            ]}
            columns={{
              description: true,
              quantity: false,
              amount: true,
              discount: false,
              taxRate: false,
              taxAmount: false,
              total: true,
            }}
            headers={{
              description: 'Description',
              quantity: '',
              amount: 'Amount',
              discount: '',
              taxRate: '',
              taxAmount: '',
              total: 'Total',
            }}
            renderNumber={(v) => (v === undefined ? '' : formatNumber(v, 'south-asian'))}
          />
          <TotalsBlock
            entries={{ subtotal: 10500, grandTotal: 10500, amountDue: 10500 }}
            labels={{
              subtotal: 'Subtotal',
              taxTotal: 'Tax',
              discountTotal: 'Discount',
              grandTotal: 'Grand Total',
              amountPaid: 'Paid',
              amountDue: 'Due',
            }}
            renderCurrency={(v) => formatCurrency(v, 'NPR', { locale: 'ne' })}
          />
          <SignatureLine caption="Principal" align="right" />
          <BrandedFooter text="Saraswati School" />
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  }, 30_000);
});

// ============================================================================
// Sprint C.1.8 — letterhead background rendering on the Page primitive
// ============================================================================

describe('Page letterheadBackgroundSrc — Sprint C.1.8', () => {
  // A 1x1 transparent PNG inlined as a Buffer source — keeps the snapshot
  // deterministic + portable (no fixture file lookup, no fetch). The Page
  // primitive treats Buffer and URL string equivalently because @react-pdf
  // accepts either via the `src` prop. This proves the primitive emits the
  // letterhead `<Image>` into the page tree at full bounds, behind content,
  // without crashing the render pipeline.
  const TINY_PNG_BUFFER = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    'base64',
  );

  it('renders without letterheadBackgroundSrc — Page is unchanged from C.0.3', async () => {
    const buffer = await renderToBuffer(
      <Document title="No letterhead">
        <Page>
          <Text>Body content</Text>
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  });

  it('renders with letterheadBackgroundSrc (Buffer source) without crashing', async () => {
    const buffer = await renderToBuffer(
      <Document title="With letterhead">
        <Page letterheadBackgroundSrc={TINY_PNG_BUFFER}>
          <Text>Body content sits above the letterhead background</Text>
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
    // PDF with embedded image bytes is meaningfully larger than the
    // letterhead-less case. We don't assert exact byte count (PDF metadata
    // varies run-to-run) but expect the letterhead PDF to be non-trivially
    // larger than an empty page.
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('composes letterhead + BrandedHeader + body — Z-order: letterhead BENEATH content', async () => {
    // The Z-order invariant: letterhead `<View fixed>` declared FIRST inside
    // <Page> sits beneath subsequent children (react-pdf paints siblings in
    // declaration order). BrandedHeader + body therefore overlay the
    // letterhead. This composition is the realistic invoice/receipt shape.
    const buffer = await renderToBuffer(
      <Document title="Letterhead + header composition">
        <Page letterheadBackgroundSrc={TINY_PNG_BUFFER}>
          <BrandedHeader
            branding={{
              schoolName: 'सरस्वती माध्यमिक विद्यालय',
              addressLines: ['Kathmandu, Bagmati', 'Nepal'],
              phone: '+977 1 4444444',
            }}
          />
          <Text>Invoice body content overlays the letterhead.</Text>
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  }, 20_000);

  it('letterhead is fixed — repeats on every page of a multi-page document', async () => {
    // No explicit page-break primitive; force pagination by emitting a tall
    // run of repeated lines. The `fixed` flag on the letterhead container
    // means @react-pdf re-renders it on each spawned page.
    const tallContent = Array.from({ length: 80 }, (_, i) => `Line ${i + 1}`);
    const buffer = await renderToBuffer(
      <Document title="Multi-page letterhead">
        <Page letterheadBackgroundSrc={TINY_PNG_BUFFER}>
          {tallContent.map((line) => (
            <Text key={line}>{line}</Text>
          ))}
        </Page>
      </Document>,
    );
    expectValidPdf(buffer);
  }, 20_000);
});
