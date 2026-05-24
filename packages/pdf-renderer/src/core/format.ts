/**
 * Date / currency / number formatting helpers for PDF documents.
 *
 * Wraps utilities from `@aibrains/shared-types`:
 *   - `gregorianToBs` for Bikram Sambat conversion (BS 2000-2090)
 *   - `formatCurrency` for archetype-aware currency rendering
 *
 * Three date modes per the design (§5.1):
 *   - `gregorian`: AD only, ISO-style "YYYY-MM-DD"
 *   - `bikram_sambat`: BS only, "B.S. YYYY-MM-DD"
 *   - `dual`: BS first, AD in parens — "B.S. YYYY-MM-DD (YYYY-MM-DD)"
 *
 * Locale parameter is accepted for future expansion (e.g., long-form month
 * names per locale), but V1 outputs are locale-independent format strings.
 */

import { gregorianToBs } from '@aibrains/shared-types';

export type DateFormat = 'gregorian' | 'bikram_sambat' | 'dual';

/**
 * Format an ISO-8601 date string for display in a PDF.
 *
 * @example
 *   formatDate('2026-04-28T00:00:00Z', 'gregorian', 'en-US')  // '2026-04-28'
 *   formatDate('2026-04-28T00:00:00Z', 'bikram_sambat', 'ne-NP')  // 'B.S. 2083-01-15'
 *   formatDate('2026-04-28T00:00:00Z', 'dual', 'ne-NP')  // 'B.S. 2083-01-15 (2026-04-28)'
 */
export function formatDate(
  isoDate: string,
  format: DateFormat,
  // locale reserved for V1.5 long-form months; suppress unused warning explicitly
  _locale: string = 'en-US',
): string {
  // Normalize any ISO form (date-only or datetime, with or without TZ) to
  // YYYY-MM-DD before BS conversion. Document dates (dueDate, issuedDate,
  // etc.) are calendrical, not precise instants — and the shared-types BS
  // converter has different behavior for date-only vs `T00:00:00Z` strings
  // (date-only anchors to noon-local; datetime hits UTC interpretation and
  // can be off-by-one in non-UTC timezones). Slicing first removes ambiguity.
  const dateOnly = normalizeToDateOnly(isoDate);
  if (format === 'gregorian') return dateOnly;

  const bs = gregorianToBs(dateOnly);
  const bsStr = `B.S. ${bs.year}-${pad2(bs.month)}-${pad2(bs.day)}`;
  if (format === 'bikram_sambat') return bsStr;

  // dual: BS first, AD in parens
  return `${bsStr} (${dateOnly})`;
}

/**
 * Format a number with locale-aware grouping. V1 supports south-asian
 * (lakh / crore grouping) and western (thousands grouping) styles.
 *
 * Currency formatting that respects the archetype workspace setting lives
 * in `@aibrains/shared-types/utils/currency::formatCurrency`. Re-exported
 * from this module for convenience so document components have one import.
 *
 * @example
 *   formatNumber(1234567, 'south-asian')  // '12,34,567'
 *   formatNumber(1234567, 'western')      // '1,234,567'
 */
export type NumberGrouping = 'south-asian' | 'western';

export function formatNumber(
  value: number,
  grouping: NumberGrouping,
): string {
  if (!Number.isFinite(value)) return '0';
  if (grouping === 'western') {
    return Math.trunc(value).toLocaleString('en-US');
  }
  // South-asian: last 3 digits, then groups of 2 (Indian-style lakh/crore)
  return formatSouthAsian(value);
}

// Re-export the canonical currency formatter so consumers have one import path
// for all formatting helpers.
export { formatCurrency } from '@aibrains/shared-types';

// --- internals ---

const YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Extract YYYY-MM-DD from any ISO-8601 input. Works for both date-only
 * (`'2026-04-28'`) and full datetime (`'2026-04-28T17:30:00Z'`) — slices the
 * first 10 chars when the prefix is well-formed, falls back to UTC-component
 * parsing otherwise. Returns the raw input verbatim if both paths fail
 * (PDF rendering must never crash on a malformed date — surface it instead).
 */
function normalizeToDateOnly(iso: string): string {
  const slice = iso.slice(0, 10);
  if (YMD_PATTERN.test(slice)) return slice;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getUTCFullYear();
  const mm = pad2(d.getUTCMonth() + 1);
  const dd = pad2(d.getUTCDate());
  return `${yyyy}-${mm}-${dd}`;
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

function formatSouthAsian(value: number): string {
  const isNegative = value < 0;
  const abs = Math.trunc(Math.abs(value)).toString();
  if (abs.length <= 3) return isNegative ? `-${abs}` : abs;

  const lastThree = abs.slice(-3);
  const rest = abs.slice(0, -3);
  // Group rest into pairs from the right.
  const grouped = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  const formatted = `${grouped},${lastThree}`;
  return isNegative ? `-${formatted}` : formatted;
}
