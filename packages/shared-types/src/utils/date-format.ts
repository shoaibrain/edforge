/**
 * Calendar-System-Aware Date Formatting
 *
 * Wraps Gregorian and BS formatting under a single API.
 * All dates stored as Gregorian ISO — this formats for display.
 */

import { formatBsDate, parseBsDate, gregorianToBs } from './bikram-sambat';

/**
 * Format an ISO date according to the school's calendar system.
 */
export function formatSchoolDate(
  isoDate: string,
  calendarSystem: string,
  format?: string,
): string {
  if (!isoDate) return '';

  if (calendarSystem === 'bikram_sambat') {
    return formatBsDate(isoDate, format);
  }

  // Gregorian formatting
  const date = new Date(isoDate);
  if (isNaN(date.getTime())) return isoDate;

  if (format === 'long') {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  }
  if (format === 'short') {
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  // Default: YYYY-MM-DD
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Parse a date string back to Gregorian ISO, based on calendar system.
 */
export function parseSchoolDate(dateString: string, calendarSystem: string): string {
  if (calendarSystem === 'bikram_sambat') {
    return parseBsDate(dateString);
  }
  // Already Gregorian
  return dateString;
}

/**
 * Generate an academic year label based on calendar system.
 * Gregorian: "2025-2026", BS: "2082-2083"
 */
export function getAcademicYearLabel(
  startDate: string,
  endDate: string,
  calendarSystem: string,
): string {
  if (calendarSystem === 'bikram_sambat') {
    const startBs = gregorianToBs(startDate);
    const endBs = gregorianToBs(endDate);
    if (startBs.year === endBs.year) return String(startBs.year);
    return `${startBs.year}-${endBs.year}`;
  }

  const startYear = new Date(startDate).getFullYear();
  const endYear = new Date(endDate).getFullYear();
  if (startYear === endYear) return String(startYear);
  return `${startYear}-${endYear}`;
}
