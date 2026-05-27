/**
 * Page — wraps `@react-pdf/renderer`'s Page with EdForge defaults.
 *
 * Margins come from template config (`PdfTemplateConfig.margins`); pageSize
 * from `template.pageSize`. The default values mirror the design doc § 4.2
 * (A4 portrait, 15mm margins on all sides) which suit a printable invoice in
 * Nepal pilot defaults.
 *
 * Sprint C.1.8 — optional `letterheadBackgroundSrc` renders an absolutely-
 * positioned `<Image fixed>` behind page content. Closes the gap surfaced by
 * M3 phase 2 branding asset uploads (the descriptor type promised the field
 * but no primitive consumed it). Letterhead `fixed` so it repeats on
 * multi-page documents. Z-order: react-pdf renders children in DOM order, so
 * the absolutely-positioned letterhead `View` declared FIRST sits beneath
 * subsequent content (BrandedHeader, body, etc.).
 *
 * Sprint C.1.9 — letterhead-aware layout follow-up:
 *   - Default `objectFit` is `'contain'` (was `'cover'` in C.1.8) so the
 *     operator's letterhead design is preserved end-to-end, not cropped to
 *     the page bounds. Operators with intentionally full-bleed pattern
 *     letterheads can opt-in to `'cover'` via the new `letterheadFit` prop.
 *   - The document components (InvoicePdf + ReceiptPdf) now suppress their
 *     own `<BrandedHeader>` + `<BrandedFooter>` when a letterhead is
 *     provided, and use safe-area margins so content sits in the typical
 *     letterhead-safe band. Those decisions live in the document layer,
 *     not in this primitive — Page stays semantically dumb.
 */

import * as React from 'react';
import { Page as RpdfPage, Image as RpdfImage, View, StyleSheet } from '@react-pdf/renderer';
import { DEFAULT_MARGINS_MM, DEFAULT_COLORS, DEFAULT_FONT_SIZE } from '../core/theme';
import { FONT_FAMILY_LATIN, type ImageSource } from '../core/fonts';

export type PageSize = 'A4' | 'A5' | 'LETTER';
export type Orientation = 'portrait' | 'landscape';
/**
 * How the letterhead background `<Image>` is scaled to fit the page bounds.
 *
 *  - `'contain'` (default since C.1.9): preserves the operator's letterhead
 *    design end-to-end. If the letterhead's aspect ratio doesn't match the
 *    page, it's letterboxed (visible page-color bars on the short side).
 *  - `'cover'`: fills the page bounds, cropping whatever doesn't fit. Use
 *    only when the letterhead is an intentional full-bleed pattern (e.g.,
 *    a tiled watermark). `'cover'` was the C.1.8 default; it silently
 *    amputated operator letterhead text on aspect mismatch.
 */
export type LetterheadFit = 'contain' | 'cover';

export interface PageProps {
  /** Defaults to A4. */
  size?: PageSize;
  /** Defaults to portrait. */
  orientation?: Orientation;
  /** Margins in millimetres; defaults to 15mm on all sides. */
  margins?: { top: number; right: number; bottom: number; left: number };
  /**
   * Sprint C.1.8 — optional letterhead background image.
   *
   * Rendered as a `fixed` (repeats per page), absolutely-positioned
   * `<Image>` covering the full page bounds, behind page content. Page-content
   * margins still apply on top.
   *
   * Pass `branding.letterheadBackgroundSrc` from the document component.
   * Only raster image formats supported by `@react-pdf/renderer@^3.4.5`
   * (`image/png`, `image/jpeg`) render correctly here; PDF letterheads from
   * the M3 phase 2 upload allowlist must be filtered out at the projection
   * layer (see finance `invoice-pdf.renderer.ts` / `receipt-pdf.renderer.ts`).
   */
  letterheadBackgroundSrc?: ImageSource;
  /**
   * Sprint C.1.9 — how the letterhead scales to fit the page. Defaults to
   * `'contain'`. See `LetterheadFit` for details.
   */
  letterheadFit?: LetterheadFit;
  children: React.ReactNode;
}

const mm = (value: number) => `${value}mm`;

// react-pdf does NOT support CSS-style font-fallback chains. The page default
// is Latin; Devanagari text runs MUST explicitly set fontFamily to
// 'Noto Sans Devanagari' (use `pickFontFamily(text)` helper from core/fonts).
const baseStyles = StyleSheet.create({
  page: {
    fontFamily: FONT_FAMILY_LATIN,
    fontSize: DEFAULT_FONT_SIZE.md,
    color: DEFAULT_COLORS.text,
    backgroundColor: DEFAULT_COLORS.background,
  },
  letterheadContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // No zIndex needed — render order alone determines stacking in react-pdf
    // (later siblings paint on top of earlier ones).
  },
  letterheadImage: {
    width: '100%',
    height: '100%',
  },
});

export const Page: React.FC<PageProps> = ({
  size = 'A4',
  orientation = 'portrait',
  margins = DEFAULT_MARGINS_MM,
  letterheadBackgroundSrc,
  letterheadFit = 'contain',
  children,
}) => {
  return (
    <RpdfPage
      size={size}
      orientation={orientation}
      style={[
        baseStyles.page,
        {
          paddingTop: mm(margins.top),
          paddingRight: mm(margins.right),
          paddingBottom: mm(margins.bottom),
          paddingLeft: mm(margins.left),
        },
      ]}
    >
      {letterheadBackgroundSrc && (
        <View style={baseStyles.letterheadContainer} fixed>
          <RpdfImage
            style={[baseStyles.letterheadImage, { objectFit: letterheadFit }]}
            src={letterheadBackgroundSrc}
          />
        </View>
      )}
      {children as React.ReactElement}
    </RpdfPage>
  );
};
