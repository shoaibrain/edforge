/**
 * BrandedFooter — fixed-bottom page footer with optional text + page number.
 *
 * Sits on every page via `fixed` (a @react-pdf/renderer flag that pins the
 * element across pagination). Pages without the footer can simply omit it.
 */

import * as React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { DEFAULT_COLORS, DEFAULT_FONT_SIZE, DEFAULT_SPACING } from '../core/theme';
import { t, type Lang } from '../core/i18n';
import { pickFontFamily, FONT_FAMILY_DEVANAGARI, FONT_FAMILY_LATIN } from '../core/fonts';

export interface BrandedFooterConfig {
  /** Custom footer text (e.g., school slogan, terms reference, etc.) */
  text?: string;
  /** Show "Page X of Y" — defaults to true. */
  showPageNumbers?: boolean;
  /** Language for the page-number label (defaults to 'en'). */
  lang?: Lang;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 8,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: DEFAULT_SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: DEFAULT_COLORS.border,
    paddingHorizontal: 24,
  },
  text: {
    fontSize: DEFAULT_FONT_SIZE.xs,
    color: DEFAULT_COLORS.textMuted,
  },
});

export const BrandedFooter: React.FC<BrandedFooterConfig> = ({
  text,
  showPageNumbers = true,
  lang = 'en',
}) => {
  // Page-number label uses the localized "Page X of Y" — pick the matching font
  // based on the language (ne → Devanagari, else → Latin).
  const pageNumberFontFamily = lang === 'ne' ? FONT_FAMILY_DEVANAGARI : FONT_FAMILY_LATIN;
  return (
    <View style={styles.container} fixed>
      <Text style={[styles.text, { fontFamily: pickFontFamily(text) }]}>{text ?? ''}</Text>
      {showPageNumbers && (
        <Text
          style={[styles.text, { fontFamily: pageNumberFontFamily }]}
          render={({ pageNumber, totalPages }) =>
            t('common', 'pageOf', lang, { page: pageNumber, total: totalPages })
          }
        />
      )}
    </View>
  );
};
