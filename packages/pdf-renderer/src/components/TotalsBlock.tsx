/**
 * TotalsBlock — right-aligned summary block stacking subtotal / tax / discount
 * / grand total / amount paid / amount due.
 *
 * Lines are conditional via the template's `totalsSection` config — same
 * pattern as LineItemTable columns. The grand-total row gets visual emphasis
 * (bold + larger font) to anchor the eye.
 */

import * as React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { DEFAULT_COLORS, DEFAULT_FONT_SIZE, DEFAULT_SPACING } from '../core/theme';
import { pickFontFamily } from '../core/fonts';

export interface TotalsBlockEntries {
  subtotal?: number;
  taxTotal?: number;
  discountTotal?: number;
  grandTotal: number;
  amountPaid?: number;
  amountDue?: number;
}

export interface TotalsBlockVisibility {
  showSubtotal?: boolean;
  showTaxTotal?: boolean;
  showDiscountTotal?: boolean;
  showAmountPaid?: boolean;
  showAmountDue?: boolean;
}

export interface TotalsBlockLabels {
  subtotal: string;
  taxTotal: string;
  discountTotal: string;
  grandTotal: string;
  amountPaid: string;
  amountDue: string;
}

export interface TotalsBlockProps {
  entries: TotalsBlockEntries;
  visibility?: TotalsBlockVisibility;
  labels: TotalsBlockLabels;
  /** Caller-provided currency formatter; the block is currency-agnostic. */
  renderCurrency: (value: number) => string;
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'column',
    alignSelf: 'flex-end',
    width: '50%',
    marginBottom: DEFAULT_SPACING.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 2,
    borderBottomWidth: 0.5,
    borderBottomColor: DEFAULT_COLORS.border,
  },
  rowGrand: {
    paddingVertical: 4,
    borderTopWidth: 1,
    borderTopColor: DEFAULT_COLORS.text,
    borderBottomWidth: 1,
    borderBottomColor: DEFAULT_COLORS.text,
    marginTop: DEFAULT_SPACING.xs,
  },
  label: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    color: DEFAULT_COLORS.textMuted,
  },
  labelGrand: {
    fontSize: DEFAULT_FONT_SIZE.md,
    fontWeight: 'bold',
    color: DEFAULT_COLORS.text,
  },
  value: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    color: DEFAULT_COLORS.text,
  },
  valueGrand: {
    fontSize: DEFAULT_FONT_SIZE.md,
    fontWeight: 'bold',
    color: DEFAULT_COLORS.text,
  },
  valueDanger: {
    color: DEFAULT_COLORS.danger,
  },
});

export const TotalsBlock: React.FC<TotalsBlockProps> = ({
  entries,
  visibility = {},
  labels,
  renderCurrency,
}) => {
  const {
    showSubtotal = true,
    showTaxTotal = true,
    showDiscountTotal = true,
    showAmountPaid = true,
    showAmountDue = true,
  } = visibility;

  // Labels are localized strings — pick family per label.
  // Values come from the caller's currency formatter; assume Latin numerals.
  return (
    <View style={styles.container}>
      {showSubtotal && entries.subtotal !== undefined && (
        <View style={styles.row}>
          <Text style={[styles.label, { fontFamily: pickFontFamily(labels.subtotal) }]}>{labels.subtotal}</Text>
          <Text style={styles.value}>{renderCurrency(entries.subtotal)}</Text>
        </View>
      )}
      {showDiscountTotal && entries.discountTotal !== undefined && entries.discountTotal > 0 && (
        <View style={styles.row}>
          <Text style={[styles.label, { fontFamily: pickFontFamily(labels.discountTotal) }]}>{labels.discountTotal}</Text>
          <Text style={styles.value}>−{renderCurrency(entries.discountTotal)}</Text>
        </View>
      )}
      {showTaxTotal && entries.taxTotal !== undefined && entries.taxTotal > 0 && (
        <View style={styles.row}>
          <Text style={[styles.label, { fontFamily: pickFontFamily(labels.taxTotal) }]}>{labels.taxTotal}</Text>
          <Text style={styles.value}>{renderCurrency(entries.taxTotal)}</Text>
        </View>
      )}
      {/* Grand total — always rendered, visually emphasized. */}
      <View style={[styles.row, styles.rowGrand]}>
        <Text style={[styles.labelGrand, { fontFamily: pickFontFamily(labels.grandTotal) }]}>{labels.grandTotal}</Text>
        <Text style={styles.valueGrand}>{renderCurrency(entries.grandTotal)}</Text>
      </View>
      {showAmountPaid && entries.amountPaid !== undefined && (
        <View style={styles.row}>
          <Text style={[styles.label, { fontFamily: pickFontFamily(labels.amountPaid) }]}>{labels.amountPaid}</Text>
          <Text style={styles.value}>{renderCurrency(entries.amountPaid)}</Text>
        </View>
      )}
      {showAmountDue && entries.amountDue !== undefined && (
        <View style={styles.row}>
          <Text style={[styles.label, { fontFamily: pickFontFamily(labels.amountDue) }]}>{labels.amountDue}</Text>
          <Text
            style={[styles.value, entries.amountDue > 0 ? styles.valueDanger : {}]}
          >
            {renderCurrency(entries.amountDue)}
          </Text>
        </View>
      )}
    </View>
  );
};
