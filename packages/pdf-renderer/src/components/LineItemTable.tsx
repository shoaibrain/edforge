/**
 * LineItemTable — configurable-column tabular block.
 *
 * The columns visible in any render are driven by template config. The full
 * set: description / quantity / amount / discount / taxRate / taxAmount / total.
 * Description, amount, and total are always shown (per design § 2.1 invariant);
 * the rest toggle.
 *
 * Used by Invoice, Receipt, and (post-V1) Fee Statement.
 */

import * as React from 'react';
import { View, Text, StyleSheet } from '@react-pdf/renderer';
import { DEFAULT_COLORS, DEFAULT_FONT_SIZE, DEFAULT_SPACING } from '../core/theme';
import { pickFontFamily } from '../core/fonts';

export interface LineItem {
  description: string;
  quantity?: number;
  amount: number;
  discount?: number;
  taxRate?: number;
  taxAmount?: number;
  total: number;
}

export interface LineItemColumns {
  /** Always shown — kept in shape for symmetry. */
  description: boolean;
  quantity: boolean;
  /** Always shown — kept in shape for symmetry. */
  amount: boolean;
  discount: boolean;
  taxRate: boolean;
  taxAmount: boolean;
  /** Always shown — kept in shape for symmetry. */
  total: boolean;
}

export interface LineItemTableProps {
  items: LineItem[];
  columns: LineItemColumns;
  /** Map of header-label keys to display strings. Caller passes localized values. */
  headers: {
    description: string;
    quantity: string;
    amount: string;
    discount: string;
    taxRate: string;
    taxAmount: string;
    total: string;
  };
  /** Render numeric values. Caller passes `formatNumber` or `formatCurrency` bound function. */
  renderNumber: (value: number | undefined) => string;
}

const styles = StyleSheet.create({
  table: {
    flexDirection: 'column',
    marginBottom: DEFAULT_SPACING.md,
  },
  headerRow: {
    flexDirection: 'row',
    backgroundColor: DEFAULT_COLORS.border,
    paddingVertical: DEFAULT_SPACING.xs,
    paddingHorizontal: DEFAULT_SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: DEFAULT_COLORS.textMuted,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: DEFAULT_SPACING.xs,
    paddingHorizontal: DEFAULT_SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: DEFAULT_COLORS.border,
  },
  headerCell: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    fontWeight: 'bold',
    color: DEFAULT_COLORS.text,
  },
  cell: {
    fontSize: DEFAULT_FONT_SIZE.sm,
    color: DEFAULT_COLORS.text,
  },
  numericCell: {
    textAlign: 'right',
  },
});

// Each column has a flex ratio when visible. Description gets the biggest share.
const COLUMN_FLEX: Record<keyof LineItemColumns, number> = {
  description: 4,
  quantity: 1,
  amount: 2,
  discount: 1.5,
  taxRate: 1,
  taxAmount: 1.5,
  total: 2,
};

export const LineItemTable: React.FC<LineItemTableProps> = ({
  items,
  columns,
  headers,
  renderNumber,
}) => {
  const visibleKeys = (Object.keys(columns) as (keyof LineItemColumns)[]).filter(
    (k) => columns[k],
  );

  return (
    <View style={styles.table}>
      {/* Header row */}
      <View style={styles.headerRow}>
        {visibleKeys.map((key) => (
          <Text
            key={key}
            style={[
              styles.headerCell,
              { flex: COLUMN_FLEX[key], fontFamily: pickFontFamily(headers[key]) },
              key !== 'description' ? styles.numericCell : {},
            ]}
          >
            {headers[key]}
          </Text>
        ))}
      </View>
      {/* Data rows */}
      {items.map((item, idx) => (
        <View key={idx} style={styles.row}>
          {visibleKeys.map((key) => {
            const flex = COLUMN_FLEX[key];
            if (key === 'description') {
              return (
                <Text key={key} style={[styles.cell, { flex, fontFamily: pickFontFamily(item.description) }]}>
                  {item.description}
                </Text>
              );
            }
            const rawValue =
              key === 'quantity'
                ? item.quantity
                : key === 'amount'
                  ? item.amount
                  : key === 'discount'
                    ? item.discount
                    : key === 'taxRate'
                      ? item.taxRate
                      : key === 'taxAmount'
                        ? item.taxAmount
                        : item.total;
            const display =
              key === 'taxRate' && rawValue !== undefined
                ? `${rawValue}%`
                : renderNumber(rawValue);
            // Numeric cells use Latin family for digits (Latin Arabic numerals
            // render fine in either font, but Latin is the canonical home).
            return (
              <Text key={key} style={[styles.cell, styles.numericCell, { flex }]}>
                {display}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
};
