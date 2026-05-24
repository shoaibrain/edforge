/**
 * Reusable components — composed from primitives, consumed by documents.
 *
 * Sprint C.0.3:
 *   - KeyValueTable — 2-col label/value grid (invoice metadata, student info)
 *   - LineItemTable — configurable-column tabular block (invoice line items)
 *   - TotalsBlock — right-aligned subtotal/tax/grand-total/paid/due stack
 *   - SignatureLine — horizontal rule + caption (signed-by markers)
 *
 * GradeTable / StudentPhotoFrame / BarcodeQR ship later (C.3 / C.5).
 */

export { KeyValueTable } from './KeyValueTable';
export type { KeyValueTableProps, KeyValueEntry } from './KeyValueTable';

export { LineItemTable } from './LineItemTable';
export type {
  LineItemTableProps,
  LineItem,
  LineItemColumns,
} from './LineItemTable';

export { TotalsBlock } from './TotalsBlock';
export type {
  TotalsBlockProps,
  TotalsBlockEntries,
  TotalsBlockVisibility,
  TotalsBlockLabels,
} from './TotalsBlock';

export { SignatureLine } from './SignatureLine';
export type { SignatureLineProps } from './SignatureLine';
