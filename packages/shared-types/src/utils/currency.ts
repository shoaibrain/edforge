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
  /** Compact mode: "NPR 4.9L", "$150K" */
  compact?: boolean;
  /** Short mode: "NPR 1.5 lakh", "USD 150,000" */
  short?: boolean;
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
  EUR: { code: 'EUR', symbol: '€', grouping: 'western' },
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
// COMPACT / SHORT HELPERS
// ============================================================================

/** Compact format for South Asian currencies: L (lakh), Cr (crore) */
function compactSouthAsian(amount: number, symbol: string): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${symbol} ${(abs / 1e7).toFixed(1)}Cr`;
  if (abs >= 1e5) return `${sign}${symbol} ${(abs / 1e5).toFixed(1)}L`;
  if (abs >= 1e3) return `${sign}${symbol} ${groupSouthAsian(Math.round(abs).toString())}`;
  return `${sign}${symbol} ${Math.round(abs)}`;
}

/** Compact format for Western currencies: K, M, B */
function compactWestern(amount: number, symbol: string): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1e9) return `${sign}${symbol}${(abs / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `${sign}${symbol}${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}${symbol}${(abs / 1e3).toFixed(1)}K`;
  return `${sign}${symbol}${Math.round(abs)}`;
}

/** Short format for South Asian: "NPR 1.5 lakh", "NPR 1.0 crore" */
function shortSouthAsian(amount: number, symbol: string): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  if (abs >= 1e7) return `${sign}${symbol} ${(abs / 1e7).toFixed(1)} crore`;
  if (abs >= 1e5) return `${sign}${symbol} ${(abs / 1e5).toFixed(1)} lakh`;
  return `${sign}${symbol} ${groupSouthAsian(Math.round(abs).toString())}`;
}

/** Short format for Western: uses standard grouping, no decimals */
function shortWestern(amount: number, symbol: string): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? '-' : '';
  return `${sign}${symbol} ${groupWestern(Math.round(abs).toString())}`;
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
  const { locale, showSymbol = true, decimals = 2, compact, short } = options;

  const meta = CURRENCY_META[currency];
  const grouping: GroupingStyle = meta?.grouping ?? 'western';

  // Handle NaN / undefined defensively
  const safeAmount = Number.isFinite(amount) ? amount : 0;

  // Pick display symbol for compact/short modes
  const displaySymbol = (locale === 'ne' && meta?.symbolNative)
    ? meta.symbolNative
    : (meta?.symbol ?? currency);

  // Compact mode: "NPR 4.9L", "$150K"
  if (compact) {
    return grouping === 'south_asian'
      ? compactSouthAsian(safeAmount, displaySymbol)
      : compactWestern(safeAmount, displaySymbol);
  }

  // Short mode: "NPR 1.5 lakh", "USD 150,000"
  if (short) {
    return grouping === 'south_asian'
      ? shortSouthAsian(safeAmount, displaySymbol)
      : shortWestern(safeAmount, displaySymbol);
  }

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
