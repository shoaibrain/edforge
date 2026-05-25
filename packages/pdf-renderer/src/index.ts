/**
 * @aibrains/pdf-renderer — EdForge PDF rendering library.
 *
 * Sprint C.0.2 ships core utilities (theme tokens, i18n helper, date/currency
 * /number format helpers). Bikram Sambat support comes via `@aibrains/shared-types`.
 *
 * Shipped:
 *   - C.0.2: core utilities (fonts + theme + i18n + format)
 *   - C.0.3: layout primitives + reusable components + Devanagari R45 canary
 *   - C.0.4: TemplateDescriptor<T> generic + per-docType registry
 *   - C.1.1: <InvoicePdf> document + invoice descriptor + invoice i18n
 *
 * Sprint C.1.2+: <ReceiptPdf>, <ReportCardPdf>, …
 *
 * Design source of truth: docs/pilot-greenlight/c-epic-pdf-generation-design.md
 */

export const PDF_RENDERER_PACKAGE_VERSION = '0.5.0';

// Core + primitives + components + descriptor registry from Sprint C.0.
export * from './core';
export * from './primitives';
export * from './components';
export * from './descriptors';

// C.1.1 — first concrete document. Importing this module's descriptor file
// has the side-effect of self-registering it with the registry. Consumers
// that only `import '@aibrains/pdf-renderer'` (the package root) get
// `getDescriptor('INVOICE')` working transitively.
import './descriptors/invoice';
export { InvoicePdf } from './documents/InvoicePdf';
export type { InvoiceTemplateConfig, InvoiceDocumentData } from './documents/InvoicePdf';
export { invoiceDescriptor } from './descriptors/invoice';
