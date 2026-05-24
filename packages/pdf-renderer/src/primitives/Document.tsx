/**
 * Document — wraps `@react-pdf/renderer`'s Document and ensures the bundled
 * fonts are registered before the first render.
 *
 * Every consumer document (InvoicePdf, ReceiptPdf, ReportCardPdf, ...) should
 * wrap its `<Page>` children in this Document rather than the raw RPDF one.
 * That makes font registration a render-side invariant rather than a per-caller
 * concern, eliminating an easy gap.
 */

import * as React from 'react';
import { Document as RpdfDocument } from '@react-pdf/renderer';
import { registerFonts } from '../core/fonts';

export interface DocumentProps {
  /** Document title surfaced in PDF metadata. */
  title?: string;
  /** Document author surfaced in PDF metadata. */
  author?: string;
  /** Document subject surfaced in PDF metadata. */
  subject?: string;
  children: React.ReactNode;
}

/**
 * Register fonts on module load (idempotent). Each consumer document still
 * wraps children in `<Document>`, so the registration is also guaranteed by
 * the render path — but pre-registering here means snapshot tests that
 * accidentally render outside `<Document>` still get correct shaping.
 */
registerFonts();

export const Document: React.FC<DocumentProps> = ({
  title,
  author,
  subject,
  children,
}) => {
  // RPDF's Document props don't include children in its TS type — pass via prop.
  return (
    <RpdfDocument title={title} author={author} subject={subject}>
      {children as React.ReactElement}
    </RpdfDocument>
  );
};
