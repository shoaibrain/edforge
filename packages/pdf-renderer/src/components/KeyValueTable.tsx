/**
 * KeyValueTable — two-column label/value grid.
 *
 * Used for invoice/receipt metadata blocks (student name, due date, invoice
 * number, etc.) and for student-info on report cards and admit cards.
 *
 * Caller passes a flat `entries` array. Empty values are skipped automatically
 * (so a missing email doesn't render a blank row).
 */

import * as React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { DEFAULT_COLORS, DEFAULT_FONT_SIZE, DEFAULT_SPACING } from '../core/theme';
import { pickFontFamily } from '../core/fonts';

export interface KeyValueEntry {
  label: string;
  value: string | number | null | undefined;
}

export interface KeyValueTableProps {
  entries: KeyValueEntry[];
  /** Column widths as Flex ratios. Defaults to [1, 2] (label gets 1/3 of width). */
  columnRatios?: [number, number];
  /** Hide empty / null / undefined values rather than rendering blank rows. Default true. */
  skipEmpty?: boolean;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    marginBottom: DEFAULT_SPACING.md,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 2,
  },
  label: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    color: DEFAULT_COLORS.textMuted,
    fontWeight: 'bold',
  },
  value: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    color: DEFAULT_COLORS.text,
  },
});

const isEmpty = (v: KeyValueEntry['value']): boolean =>
  v === null || v === undefined || (typeof v === 'string' && v.trim() === '');

export const KeyValueTable: React.FC<KeyValueTableProps> = ({
  entries,
  columnRatios = [1, 2],
  skipEmpty = true,
}) => {
  const visible = skipEmpty ? entries.filter((e) => !isEmpty(e.value)) : entries;
  const [labelFlex, valueFlex] = columnRatios;

  return (
    <View style={styles.container}>
      {visible.map((entry, idx) => {
        const valueStr =
          entry.value === null || entry.value === undefined ? '' : String(entry.value);
        return (
          <View key={idx} style={styles.row}>
            <Text style={[styles.label, { flex: labelFlex, fontFamily: pickFontFamily(entry.label) }]}>
              {entry.label}
            </Text>
            <Text style={[styles.value, { flex: valueFlex, fontFamily: pickFontFamily(valueStr) }]}>
              {valueStr}
            </Text>
          </View>
        );
      })}
    </View>
  );
};
