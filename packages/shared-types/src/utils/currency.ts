/**
 * Currency Formatting Utilities
 *
 * NPR formatting with Nepal-style lakh/crore grouping.
 * Pure utility functions — NOT in schema files.
 */

interface CurrencyFormatOpts {
  locale?: 'en' | 'ne';
  showSymbol?: boolean;
  decimals?: number;
}

/**
 * Format an amount as NPR currency string.
 * Uses Nepal's number formatting (commas at lakh/crore positions).
 *
 * Examples:
 *   formatNPR(12500)      → "NPR 12,500.00"
 *   formatNPR(12500, { locale: 'ne', showSymbol: true }) → "रू १२,५००.००"
 *   formatNPR(150000)     → "NPR 1,50,000.00" (lakh grouping)
 */
export function formatNPR(
  amount: number,
  options: CurrencyFormatOpts = {}
): string {
  const { locale = 'en', showSymbol = true, decimals = 2 } = options;

  // Format with Nepal-style grouping (##,##,###.##)
  const fixed = Math.abs(amount).toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');

  // Apply lakh/crore grouping: last 3 digits, then groups of 2
  let grouped: string;
  if (intPart.length <= 3) {
    grouped = intPart;
  } else {
    const last3 = intPart.slice(-3);
    const rest = intPart.slice(0, -3);
    const pairs = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
    grouped = `${pairs},${last3}`;
  }

  // Convert digits to Devanagari for Nepali locale
  let formatted = decPart ? `${grouped}.${decPart}` : grouped;
  if (locale === 'ne') {
    formatted = formatted.replace(/[0-9]/g, (d) =>
      String.fromCharCode(0x0966 + Number(d))
    );
  }

  if (amount < 0) formatted = `-${formatted}`;

  const symbol = locale === 'ne' ? 'रू' : 'NPR';
  return showSymbol ? `${symbol} ${formatted}` : formatted;
}
