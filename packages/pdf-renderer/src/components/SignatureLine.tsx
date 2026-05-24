/**
 * SignatureLine — a horizontal rule with a caption underneath.
 *
 * Used at the bottom of receipts, certificates, admit cards. Caller supplies
 * the caption (localized) — the component is layout-only. Optional
 * pre-rendered signature image source rendered above the line.
 */

import * as React from 'react';
import { View, Text, Image, StyleSheet } from '@react-pdf/renderer';
import { DEFAULT_COLORS, DEFAULT_FONT_SIZE, DEFAULT_SPACING } from '../core/theme';
import { pickFontFamily, type ImageSource } from '../core/fonts';

export interface SignatureLineProps {
  caption: string;
  /**
   * Optional signature image rendered above the line. Accepts URL string,
   * Buffer, or react-pdf SourceObject literal — see `ImageSource` in
   * `core/fonts.ts`.
   */
  signatureSrc?: ImageSource;
  /** Width of the signature block as % of container. Defaults to 40%. */
  width?: string;
  /** Stack alignment. Defaults to left. */
  align?: 'left' | 'right';
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    marginTop: DEFAULT_SPACING.lg,
  },
  signature: {
    height: 32,
    objectFit: 'contain',
    marginBottom: 2,
  },
  line: {
    borderBottomWidth: 1,
    borderBottomColor: DEFAULT_COLORS.text,
    marginBottom: 2,
    minHeight: 24,
  },
  caption: {
    fontSize: DEFAULT_FONT_SIZE.xs,
    color: DEFAULT_COLORS.textMuted,
    textAlign: 'center',
  },
});

export const SignatureLine: React.FC<SignatureLineProps> = ({
  caption,
  signatureSrc,
  width = '40%',
  align = 'left',
}) => {
  return (
    <View style={[styles.container, { width, alignSelf: align === 'right' ? 'flex-end' : 'flex-start' }]}>
      {signatureSrc && <Image style={styles.signature} src={signatureSrc} />}
      <View style={styles.line} />
      <Text style={[styles.caption, { fontFamily: pickFontFamily(caption) }]}>{caption}</Text>
    </View>
  );
};
