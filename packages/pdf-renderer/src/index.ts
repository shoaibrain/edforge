/**
 * @aibrains/pdf-renderer — EdForge PDF rendering library.
 *
 * Sprint C.0.2 ships core utilities (theme tokens, i18n helper, date/currency
 * /number format helpers). Bikram Sambat support comes via `@aibrains/shared-types`.
 *
 * Subsequent C.0.* tickets add:
 *   - C.0.3: fonts registration (Noto Sans + Noto Sans Devanagari) + layout
 *            primitives (Document, Page, BrandedHeader, BrandedFooter, Watermark)
 *            + reusable components (KeyValueTable, LineItemTable, TotalsBlock,
 *            SignatureLine) + Devanagari snapshot tests
 *   - C.0.4: TemplateDescriptor<T> generic + per-docType registry
 * Sprint C.1+: <InvoicePdf>, <ReceiptPdf>, <ReportCardPdf>, ...
 *
 * Design source of truth: docs/pilot-greenlight/c-epic-pdf-generation-design.md
 */

export const PDF_RENDERER_PACKAGE_VERSION = '0.4.0';

// Re-export the C.0.2 core API surface + C.0.3 primitives + components
// + C.0.4 descriptor registry.
export * from './core';
export * from './primitives';
export * from './components';
export * from './descriptors';
