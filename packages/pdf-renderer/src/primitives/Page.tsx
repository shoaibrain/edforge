/**
 * Page — wraps `@react-pdf/renderer`'s Page with EdForge defaults.
 *
 * Margins come from template config (`PdfTemplateConfig.margins`); pageSize
 * from `template.pageSize`. The default values mirror the design doc § 4.2
 * (A4 portrait, 15mm margins on all sides) which suit a printable invoice in
 * Nepal pilot defaults.
 */

import * as React from 'react';
import { Page as RpdfPage, StyleSheet } from '@react-pdf/renderer';
import { DEFAULT_MARGINS_MM, DEFAULT_COLORS, DEFAULT_FONT_SIZE } from '../core/theme';
import { FONT_FAMILY_LATIN } from '../core/fonts';

export type PageSize = 'A4' | 'A5' | 'LETTER';
export type Orientation = 'portrait' | 'landscape';

export interface PageProps {
  /** Defaults to A4. */
  size?: PageSize;
  /** Defaults to portrait. */
  orientation?: Orientation;
  /** Margins in millimetres; defaults to 15mm on all sides. */
  margins?: { top: number; right: number; bottom: number; left: number };
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
});

export const Page: React.FC<PageProps> = ({
  size = 'A4',
  orientation = 'portrait',
  margins = DEFAULT_MARGINS_MM,
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
      {children as React.ReactElement}
    </RpdfPage>
  );
};
