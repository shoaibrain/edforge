/**
 * Currency Formatting Utilities
 *
 * Generic currency formatting with special support for South Asian
 * lakh/crore grouping (NPR, INR) and standard Western grouping.
 * Pure utility functions — NOT in schema files.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface CurrencyFormatOpts {
  locale?: string;
  showSymbol?: boolean;
  decimals?: number;
}

/** Grouping style for digit separation */
type GroupingStyle = 'south_asian' | 'western';

/** Currency metadata for formatting */
interface CurrencyMeta {
  code: string;
  symbol: string;
  symbolNative?: string;
  grouping: GroupingStyle;
}

// ============================================================================
// CURRENCY REGISTRY
// ============================================================================

const CURRENCY_META: Record<string, CurrencyMeta> = {
  NPR: { code: 'NPR', symbol: 'NPR', symbolNative: 'रू', grouping: 'south_asian' },
  INR: { code: 'INR', symbol: 'INR', symbolNative: '₹', grouping: 'south_asian' },
  USD: { code: 'USD', symbol: '$', grouping: 'western' },
  GBP: { code: 'GBP', symbol: '£', grouping: 'western' },
  CAD: { code: 'CAD', symbol: 'CA$', grouping: 'western' },
  AUD: { code: 'AUD', symbol: 'A$', grouping: 'western' },
};

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/**
 * Apply South Asian grouping: last 3 digits, then groups of 2.
 * e.g. 1234567 → "12,34,567"
 */
function groupSouthAsian(intPart: string): string {
  if (intPart.length <= 3) return intPart;
  const last3 = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${pairs},${last3}`;
}

/**
 * Apply Western grouping: groups of 3.
 * e.g. 1234567 → "1,234,567"
 */
function groupWestern(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Generic currency formatter.
 *
 * Picks the correct digit-grouping style (lakh/crore vs. Western)
 * based on the currency code. Falls back to Western grouping for
 * unknown currencies.
 *
 * @param amount   - numeric amount (supports 0 and negatives for credits)
 * @param currency - ISO 4217 currency code (e.g. 'NPR', 'USD')
 * @param options  - formatting overrides
 *
 * Examples:
 *   formatCurrency(0, 'NPR')           → "NPR 0.00"
 *   formatCurrency(150000, 'NPR')      → "NPR 1,50,000.00"
 *   formatCurrency(-500, 'NPR')        → "NPR -500.00"
 *   formatCurrency(1234567, 'USD')      → "$ 1,234,567.00"
 *   formatCurrency(1234567, 'INR')      → "INR 12,34,567.00"
 */
export function formatCurrency(
  amount: number,
  currency: string,
  options: CurrencyFormatOpts = {},
): string {
  const { locale, showSymbol = true, decimals = 2 } = options;

  const meta = CURRENCY_META[currency];
  const grouping: GroupingStyle = meta?.grouping ?? 'western';

  // Handle NaN / undefined defensively
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const isNegative = safeAmount < 0;

  const fixed = Math.abs(safeAmount).toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');

  const grouped = grouping === 'south_asian'
    ? groupSouthAsian(intPart)
    : groupWestern(intPart);

  let formatted = decPart ? `${grouped}.${decPart}` : grouped;

  // Convert digits to Devanagari for Nepali locale
  if (locale === 'ne') {
    formatted = formatted.replace(/[0-9]/g, (d) =>
      String.fromCharCode(0x0966 + Number(d)),
    );
  }

  if (isNegative) formatted = `-${formatted}`;

  if (!showSymbol) return formatted;

  // Pick display symbol
  let symbol: string;
  if (locale === 'ne' && meta?.symbolNative) {
    symbol = meta.symbolNative;
  } else {
    symbol = meta?.symbol ?? currency;
  }

  return `${symbol} ${formatted}`;
}

/**
 * Format an amount as NPR currency string.
 * Convenience wrapper around formatCurrency for Nepali Rupees.
 * Uses Nepal's lakh/crore grouping (##,##,###.##).
 *
 * Examples:
 *   formatNPR(0)           → "NPR 0.00"
 *   formatNPR(12500)       → "NPR 12,500.00"
 *   formatNPR(150000)      → "NPR 1,50,000.00"
 *   formatNPR(-500)        → "NPR -500.00"
 *   formatNPR(12500, { locale: 'ne' }) → "रू १२,५००.००"
 */
export function formatNPR(
  amount: number,
  options: CurrencyFormatOpts = {},
): string {
  return formatCurrency(amount, 'NPR', options);
}
