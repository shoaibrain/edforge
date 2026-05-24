/**
 * Watermark — diagonal translucent text overlay.
 *
 * Common cases:
 *   - "DRAFT" on a not-yet-issued invoice preview
 *   - "PAID" on a settled invoice
 *   - "CANCELLED" on a voided invoice or refunded receipt
 *
 * Positioned absolutely, rotated 45deg. Use sparingly — it bleeds through to
 * the body content visually.
 */

import * as React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { DEFAULT_COLORS } from '../core/theme';
import { pickFontFamily } from '../core/fonts';

export interface WatermarkProps {
  text: string;
  /** 0.0–1.0. Defaults to 0.10 (faint). */
  opacity?: number;
  /** Rotation in degrees. Defaults to -45 (bottom-left to top-right). */
  rotation?: number;
  /** Hex color. Defaults to theme danger. */
  color?: string;
  /** Font size in pt. Defaults to 96. */
  fontSize?: number;
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: '40%',
    left: 0,
    right: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    fontWeight: 'bold',
    letterSpacing: 8,
  },
});

export const Watermark: React.FC<WatermarkProps> = ({
  text,
  opacity = 0.1,
  rotation = -45,
  color = DEFAULT_COLORS.danger,
  fontSize = 96,
}) => {
  return (
    <View style={styles.container} fixed>
      <Text
        style={[
          styles.text,
          {
            color,
            opacity,
            fontSize,
            fontFamily: pickFontFamily(text),
            transform: `rotate(${rotation}deg)`,
          },
        ]}
      >
        {text}
      </Text>
    </View>
  );
};
