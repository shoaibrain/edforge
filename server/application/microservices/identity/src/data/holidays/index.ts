/**
 * Holiday Data Loader — Ed-Fi CalendarEvent seed data by locale
 *
 * Provides locale-specific public holiday data for calendar generation.
 * Each holiday maps to Ed-Fi CalendarDate with eventType = 'holiday'.
 *
 * Data files are keyed by locale and academic year range.
 * For V1: Nepal (NP) 2026-2027 is the only supported locale.
 * Post-V1: Add additional locale files and register them in LOCALE_HOLIDAY_MAP.
 */

export interface LocaleHoliday {
  date: string;       // YYYY-MM-DD (Gregorian ISO)
  name: string;       // Human-readable holiday name
  eventType: string;  // Ed-Fi CalendarEventDescriptor — always 'holiday' for public holidays
}

// Use require() for reliable JSON loading in webpack/CommonJS environment.
// ESM `import from '*.json'` can produce { default: [...] } in some webpack configs.
// eslint-disable-next-line @typescript-eslint/no-require-imports -- intentional: ESM JSON import yields { default: … } under some webpack configs (see above)
const npHolidays2026: LocaleHoliday[] = require('./np-2026-2027.json');

/**
 * Registry of available holiday data by locale code.
 * Add new locales here as data files are created.
 */
const LOCALE_HOLIDAY_MAP: Record<string, LocaleHoliday[]> = {
  'np': npHolidays2026,
  'NP': npHolidays2026,
  'ne-NP': npHolidays2026,
};

/**
 * Get holidays for a locale, filtered to a date range.
 *
 * @param locale - Locale code (e.g., 'np', 'NP', 'ne-NP', 'en-US')
 * @param startDate - Range start (inclusive), YYYY-MM-DD
 * @param endDate - Range end (inclusive), YYYY-MM-DD
 * @returns Holidays within the date range, empty array if locale has no data
 */
export function getHolidaysForLocale(
  locale: string,
  startDate: string,
  endDate: string,
): LocaleHoliday[] {
  const holidays = LOCALE_HOLIDAY_MAP[locale] || LOCALE_HOLIDAY_MAP[locale.split('-').pop() || ''];
  if (!holidays) return [];

  return holidays.filter(h => h.date >= startDate && h.date <= endDate);
}

/**
 * Check if a locale has holiday data available.
 */
export function hasHolidayData(locale: string): boolean {
  return !!(LOCALE_HOLIDAY_MAP[locale] || LOCALE_HOLIDAY_MAP[locale.split('-').pop() || '']);
}

/**
 * Get all supported locale codes.
 */
export function getSupportedHolidayLocales(): string[] {
  return [...new Set(Object.keys(LOCALE_HOLIDAY_MAP))];
}
