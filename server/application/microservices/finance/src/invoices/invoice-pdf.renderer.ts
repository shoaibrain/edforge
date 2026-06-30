/**
 * Invoice PDF renderer — Sprint C.1.5.
 *
 * Pure function: `(invoice, branding, urls, templateConfig, locale) → Buffer`.
 * No I/O, no DDB, no S3, no logging. The InvoicesService is responsible for
 * loading the inputs and for emitting the audit log entry; this module's
 * only job is to project them onto the `<InvoicePdf>` React component
 * shipped by `@aibrains/pdf-renderer` and return the rendered PDF buffer.
 *
 * **Why a separate file?** Three reasons:
 *   1. The mapping from finance's `InvoiceEntity` → renderer's
 *      `InvoiceDocumentData` is a non-trivial shape projection (line items,
 *      currency, status mapping); keeping it isolated keeps
 *      `invoices.service.ts` thin and renders the test surface smaller.
 *   2. The renderer is a pure function, so tests don't need any DI scaffolding
 *      — they can call `renderInvoiceToPdfBuffer(...)` directly with fixtures.
 *   3. Sprint C.1.6 will need the analogous `renderReceiptToPdfBuffer(...)`
 *      file mirroring this one; co-locating the projection logic with the
 *      JSX entry point makes that future PR a copy-edit instead of a refactor.
 *
 * **React.createElement vs JSX:** Uses `React.createElement` rather than JSX
 * because the file ships as `.ts` (not `.tsx`) — that keeps the Nest webpack
 * build pipeline configuration untouched (no JSX loader needed in finance's
 * tsconfig). The renderer library itself accepts the same component +
 * props shape either way.
 */

import * as React from 'react';
import {
  Document,
  Page,
  renderToBuffer,
  type DocumentProps,
} from '@react-pdf/renderer';
import {
  InvoicePdf,
  type InvoiceTemplateConfig,
  type InvoiceDocumentData,
  type PdfBranding,
  type PdfLocaleSettings,
} from '@aibrains/pdf-renderer';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type {
  SchoolBrandingResponse,
  BrandingAssetUrls,
} from '../common/services/identity-client.service';

/**
 * Pre-warm `@react-pdf/layout`'s yoga-layout singleton — Sprint F.7 fix-up.
 *
 * @react-pdf/layout@3.13.0 has a race in its module-level yoga loader
 * (node_modules/@react-pdf/layout/lib/index.cjs:633-648):
 *
 *   let instance;
 *   const loadYoga = async () => {
 *     if (!instance) {
 *       instance = await Yoga.loadYoga();  // RACE — two concurrent calls
 *     }                                     // both see !instance, both
 *     const config = instance.Config.create();  // overwrite instance →
 *   };                                          // Config from a stale
 *                                               // yoga instance →
 *                                               // instanceof check
 *                                               // downstream fails with
 *                                               // "Expected null or
 *                                               //  instance of Config,
 *                                               //  got an instance of
 *                                               //  Config"
 *
 * Production symptom (dev-pabson-primary E2E 2026-06-30): F.3 worker's
 * `withConcurrencyLimit(invoiceIds, 40, ...)` parallel loop kicked off
 * multiple `renderToBuffer` calls simultaneously on a cold process — the
 * yoga `instance` module variable hadn't been set yet, the race fired on
 * the very first parallel batch, and every render except the (single)
 * winner failed with the Config instanceof error.
 *
 * Fix: serialize the FIRST render so `instance` is set without contention.
 * All subsequent parallel renders skip the `if (!instance)` branch and
 * reuse the same yoga instance — no race window.
 *
 * The pre-warm renders a trivial empty Document/Page (no text, no fonts,
 * no images) so the cost is minimal — measured at ~50-100 ms on cold
 * boot, single-digit ms after the JIT warms.
 *
 * Idempotent: callers may invoke this at every worker run() without
 * worrying about double-init. The promise is memoized at module scope;
 * subsequent calls return the same already-settled promise instantly.
 *
 * Why here vs. in the worker: the renderer is the only consumer of
 * @react-pdf/renderer in finance, and `renderInvoiceToPdfBuffer` already
 * encapsulates the renderToBuffer invocation. Keeping the pre-warm in
 * the same module pins the fix next to the call that breaks without it.
 */
let prewarmPromise: Promise<void> | null = null;
export function prewarmInvoiceRenderer(): Promise<void> {
  if (prewarmPromise) return prewarmPromise;
  prewarmPromise = (async () => {
    // Minimal element — no text, no fonts, no styles. Just enough to
    // drive @react-pdf/layout's loadYoga path to completion so its
    // module-level `instance` variable is populated.
    const element = React.createElement(
      Document,
      null,
      React.createElement(Page, null),
    );
    await renderToBuffer(element as unknown as React.ReactElement<DocumentProps>);
  })();
  // If pre-warm itself throws, clear the memo so the next call retries.
  // (A persistent failure is the operator's problem; we don't want a
  // transient blip to permanently disable the renderer for this process.)
  prewarmPromise.catch(() => {
    prewarmPromise = null;
  });
  return prewarmPromise;
}

/**
 * Test-only escape hatch — reset the module-level pre-warm memo so each
 * spec gets a clean slate. Production code MUST NOT call this.
 */
export function __resetPrewarmForTest(): void {
  prewarmPromise = null;
}

/**
 * Inputs to `renderInvoiceToPdfBuffer`. Keeping the shape explicit (rather
 * than a positional argument tuple) so additions/changes are typesafe and
 * the call site reads as a structured handoff.
 */
export interface RenderInvoiceInput {
  /** Finance-side persisted invoice — the source of all per-document data. */
  invoice: InvoiceEntity;
  /**
   * Identity-side branding sub-document for the school. `null` is valid
   * — the renderer falls back to `invoice.schoolName` only (no logo, no
   * formalName, etc.). Schools that haven't configured branding yet
   * (most freshly-provisioned tenants) hit this path.
   */
  branding: SchoolBrandingResponse | null;
  /**
   * Short-lived presigned GET URLs for branding S3 assets. `react-pdf` Image
   * primitive fetches the URL at render time, so we rely on the 10-min TTL
   * that identity mints — render happens within a few hundred ms of the
   * IdentityClient fetch, well inside the window.
   */
  urls: BrandingAssetUrls | undefined;
  /** Template config — comes from `IdentityClient.getCurrentTemplate` (C.1.4). */
  templateConfig: InvoiceTemplateConfig;
  /**
   * BCP-47 locale string used by the renderer's `formatCurrency` call.
   * Examples: `'ne-NP'`, `'en-US'`. Passed through from the calling endpoint.
   */
  locale: string;
}

/**
 * Render an invoice to a PDF buffer. Pure function — no I/O.
 *
 * Maps:
 *   - `invoice.lineItems` → `InvoiceDocumentData.lineItems` (one-to-one;
 *     the LineItem shape is structurally compatible)
 *   - `branding + urls` → `PdfBranding` (logoSrc resolves to the
 *     presigned GET URL when present; falls back to undefined otherwise)
 *   - `invoice` totals → `InvoiceDocumentData` totals (one-to-one)
 *   - `invoice.status` → `InvoiceDocumentData.status` (one-to-one; finance
 *     and renderer share the same lifecycle string union)
 *
 * @returns Buffer containing the rendered PDF (`%PDF-` magic bytes; valid
 *   PDF 1.7 output via `@react-pdf/renderer` v3).
 */
export async function renderInvoiceToPdfBuffer(input: RenderInvoiceInput): Promise<Buffer> {
  const { invoice, branding, urls, templateConfig, locale } = input;

  const data: InvoiceDocumentData = {
    invoiceNumber: invoice.invoiceNumber,
    issuedDate: invoice.issuedDate,
    dueDate: invoice.dueDate,
    academicYear: invoice.academicYear,
    billingPeriod: invoice.billingPeriod,
    studentName: invoice.studentName,
    studentId: invoice.studentId,
    gradeLevel: invoice.gradeLevel,
    lineItems: invoice.lineItems.map((li) => ({
      description: li.description,
      quantity: li.quantity,
      amount: li.amount,
      discount: li.discount,
      taxRate: li.taxRate,
      taxAmount: li.taxAmount,
      total: li.total,
    })),
    subtotal: invoice.subtotal,
    taxTotal: invoice.taxTotal,
    discountTotal: invoice.discountTotal,
    grandTotal: invoice.grandTotal,
    amountPaid: invoice.amountPaid,
    amountDue: invoice.amountDue,
    currency: invoice.currency,
    status: invoice.status,
    notes: invoice.notes,
  };

  // PdfBranding cascade — operator-customized branding fields override
  // the persisted School-level fields. When branding is null, the renderer
  // sees only `schoolName: invoice.schoolName` (everything else undefined)
  // and produces a usable but bare-bones PDF; that's the intended UX for
  // tenants that haven't configured branding yet.
  const pdfBranding: PdfBranding = {
    schoolName: invoice.schoolName,
    formalName: branding?.formalName,
    addressLines: branding?.addressLines,
    phone: branding?.phone,
    email: branding?.email,
    panNumber: branding?.panNumber,
    vatNumber: branding?.vatNumber,
    tagline: branding?.tagline,
    primaryColor: branding?.colorPalette?.primary,
    accentColor: branding?.colorPalette?.accent,
    // Asset sources: prefer the signed URL from `urls` (10-min TTL,
    // fetched-at-render-time). Raw S3 keys never reach the renderer.
    logoSrc: urls?.logo,
    principalSignatureSrc: urls?.principalSignature,
    // **V1 letterhead-deferred** (Path E decision 2026-05-27 PM):
    // operator-uploaded letterhead PNGs do not get forwarded to the
    // renderer. Real-world letterheads designed by operators rarely
    // match A4 portrait aspect ratio + rarely keep the central content-
    // safe area clean, so the C.1.8/C.1.9 letterhead-as-page-background
    // path produced unprofessional output regardless of `objectFit`
    // strategy (contain → header lands in middle on landscape-ish
    // sources; cover → text amputated on right edge; either way the
    // operator's center watermark collided with the invoice/receipt
    // data table). V1 ships with `<BrandedHeader>` + `<BrandedFooter>`
    // as the canonical chrome (driven by the 6 existing branding
    // knobs: logo, signature, primary+accent colors, formalName,
    // tagline, addressLines/phone/email). The S3 bucket + presign
    // endpoint stay in place — the upload itself still succeeds and
    // the data row persists — but the rendered PDF ignores it. Custom
    // letterhead support returns in V1.5 alongside the C.2 Template
    // Editor + live preview, which is the infrastructure operators
    // need to design + verify a letterhead before save.
    //
    // The `letterheadBackgroundSrc` field on `PdfBranding` is left in
    // the library's type for forward-compat; `<Page>` still accepts
    // the prop; we just stop wiring it here.
  };

  // PdfLocaleSettings — the renderer reads `defaultLocale` for the
  // `formatCurrency` call inside `<InvoicePdf>`. Other fields are unused
  // by the invoice descriptor in V1 but typed in case future doc types
  // need them. `defaultCalendarSystem` is derived from the template's
  // `dateFormat` (dual or bikram_sambat → BS-aware) for parity.
  const settings: PdfLocaleSettings = {
    defaultLocale: locale,
    defaultCurrency: invoice.currency,
    defaultCalendarSystem:
      templateConfig.dateFormat === 'gregorian' ? 'gregorian' : 'bikram_sambat',
  };

  // React.createElement vs JSX: see file header. Both produce the same
  // ReactElement that `renderToBuffer` consumes.
  const element = React.createElement(InvoicePdf, {
    data,
    template: templateConfig,
    branding: pdfBranding,
    settings,
  });

  // Cast at the boundary: `renderToBuffer` strictly typing demands
  // `ReactElement<DocumentProps>` (a Document-rooted element), but
  // `InvoicePdf` is typed as `React.FC<DocumentComponentProps<...>>`.
  // TypeScript can't follow through the React.FC wrapper to see that
  // InvoicePdf returns `<Document>...</Document>` at runtime. The cast is
  // safe — confirmed by every InvoicePdf render canary in
  // packages/pdf-renderer/src/__tests__/invoice-pdf.spec.tsx.
  return renderToBuffer(element as unknown as React.ReactElement<DocumentProps>);
}
