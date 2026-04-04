/**
 * Bikram Sambat (BS) ↔ Gregorian (AD) Date Conversion
 *
 * Nepal's official calendar. BS year ~57 years ahead of AD.
 * Months have variable days (29-32). All dates stored as Gregorian ISO;
 * conversion happens at display/input layer only.
 *
 * Data table covers BS years 2000-2090 (sufficient for next 60+ years).
 */

// ============================================================================
// BS CALENDAR DATA
// ============================================================================

/** Days per month for each BS year (index 0 = Baishakh, 11 = Chaitra) */
const BS_CALENDAR_DATA: Record<number, number[]> = {
  2000: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2001: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2002: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2003: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2004: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2005: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2006: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2007: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2008: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31],
  2009: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2010: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2011: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2012: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2013: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2014: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2015: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2016: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2017: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2018: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2019: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2020: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2021: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2022: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2023: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2024: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2025: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2026: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2027: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2028: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2029: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  2030: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2031: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2032: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2033: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2034: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2035: [30, 32, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31],
  2036: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2037: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2038: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2039: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2040: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2041: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2042: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2043: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2044: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2045: [31, 32, 31, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2046: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2047: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2048: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2049: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2050: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2051: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2052: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2053: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2054: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2055: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2056: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  2057: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2058: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2059: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2060: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2061: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2062: [30, 32, 31, 32, 31, 31, 29, 30, 29, 30, 29, 31],
  2063: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2064: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2065: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2066: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 29, 31],
  2067: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2068: [31, 31, 32, 32, 31, 30, 30, 29, 30, 29, 30, 30],
  2069: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 31],
  2070: [31, 31, 31, 32, 31, 31, 29, 30, 30, 29, 30, 30],
  2071: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2072: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2073: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2074: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2075: [31, 31, 32, 31, 32, 30, 30, 29, 30, 29, 30, 30],
  2076: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2077: [31, 32, 31, 32, 31, 30, 30, 30, 29, 30, 29, 31],
  2078: [31, 31, 31, 32, 31, 31, 30, 29, 30, 29, 30, 30],
  2079: [31, 31, 32, 31, 31, 31, 30, 29, 30, 29, 30, 30],
  2080: [31, 32, 31, 32, 31, 30, 30, 30, 29, 29, 30, 30],
  2081: [31, 31, 32, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2082: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2083: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2084: [31, 31, 32, 31, 31, 30, 30, 30, 29, 30, 30, 30],
  2085: [31, 32, 31, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2086: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2087: [31, 31, 32, 31, 31, 31, 30, 30, 29, 30, 30, 30],
  2088: [30, 31, 32, 32, 30, 31, 30, 30, 29, 30, 30, 30],
  2089: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
  2090: [30, 32, 31, 32, 31, 30, 30, 30, 29, 30, 30, 30],
};

/** BS month names in English transliteration */
const BS_MONTHS = [
  'Baishakh', 'Jestha', 'Ashadh', 'Shrawan', 'Bhadra', 'Ashwin',
  'Kartik', 'Mangsir', 'Poush', 'Magh', 'Falgun', 'Chaitra',
] as const;

/** BS month names in Devanagari */
const BS_MONTHS_NE = [
  'बैशाख', 'जेठ', 'असार', 'श्रावण', 'भदौ', 'आश्विन',
  'कार्तिक', 'मंसिर', 'पौष', 'माघ', 'फाल्गुन', 'चैत्र',
] as const;

// Reference point: BS 2000/1/1 = AD 1943/4/14
const BS_EPOCH_YEAR = 2000;
const AD_EPOCH = new Date(1943, 3, 14); // April 14, 1943

// ============================================================================
// CORE CONVERSION FUNCTIONS
// ============================================================================

function getTotalDaysInBsYear(year: number): number {
  const months = BS_CALENDAR_DATA[year];
  if (!months) throw new Error(`BS year ${year} is out of supported range (2000-2090)`);
  return months.reduce((sum, d) => sum + d, 0);
}

function daysBetweenDates(d1: Date, d2: Date): number {
  const utc1 = Date.UTC(d1.getFullYear(), d1.getMonth(), d1.getDate());
  const utc2 = Date.UTC(d2.getFullYear(), d2.getMonth(), d2.getDate());
  return Math.floor((utc2 - utc1) / 86400000);
}

/**
 * Convert Gregorian ISO date string to Bikram Sambat components.
 */
export function gregorianToBs(date: string): { year: number; month: number; day: number } {
  const adDate = new Date(date);
  if (isNaN(adDate.getTime())) {
    throw new Error(`Invalid date string: ${date}`);
  }

  let totalDays = daysBetweenDates(AD_EPOCH, adDate);
  if (totalDays < 0) {
    throw new Error(`Date ${date} is before the supported range`);
  }

  let bsYear = BS_EPOCH_YEAR;
  let bsMonth = 0;
  let bsDay = 1;

  // Count years
  while (totalDays > 0) {
    const daysInYear = getTotalDaysInBsYear(bsYear);
    if (totalDays < daysInYear) break;
    totalDays -= daysInYear;
    bsYear++;
  }

  // Count months
  const months = BS_CALENDAR_DATA[bsYear];
  if (!months) throw new Error(`BS year ${bsYear} is out of supported range`);

  for (let m = 0; m < 12; m++) {
    if (totalDays < months[m]) {
      bsMonth = m;
      bsDay = totalDays + 1;
      break;
    }
    totalDays -= months[m];
  }

  return { year: bsYear, month: bsMonth + 1, day: bsDay }; // 1-indexed month
}

/**
 * Convert Bikram Sambat to Gregorian ISO date string.
 * @param year BS year
 * @param month BS month (1-12, 1=Baishakh)
 * @param day BS day (1-32)
 */
export function bsToGregorian(year: number, month: number, day: number): string {
  if (!BS_CALENDAR_DATA[year]) {
    throw new Error(`BS year ${year} is out of supported range (2000-2090)`);
  }

  const monthIdx = month - 1;
  const maxDay = BS_CALENDAR_DATA[year][monthIdx];
  if (!maxDay || day < 1 || day > maxDay) {
    throw new Error(`Invalid BS date: ${year}/${month}/${day} (month ${month} has ${maxDay} days)`);
  }

  // Count total days from BS epoch
  let totalDays = 0;
  for (let y = BS_EPOCH_YEAR; y < year; y++) {
    totalDays += getTotalDaysInBsYear(y);
  }
  for (let m = 0; m < monthIdx; m++) {
    totalDays += BS_CALENDAR_DATA[year][m];
  }
  totalDays += day - 1;

  const result = new Date(AD_EPOCH);
  result.setDate(result.getDate() + totalDays);

  const yyyy = result.getFullYear();
  const mm = String(result.getMonth() + 1).padStart(2, '0');
  const dd = String(result.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

// ============================================================================
// FORMATTING FUNCTIONS
// ============================================================================

/**
 * Format a Gregorian ISO date as a BS date string.
 * @param isoDate Gregorian ISO date (e.g., '2026-04-14')
 * @param format Output format: 'YYYY/MM/DD' (default), 'long', 'short'
 */
export function formatBsDate(isoDate: string, format: string = 'YYYY/MM/DD'): string {
  const bs = gregorianToBs(isoDate);

  if (format === 'long') {
    return `${bs.day} ${BS_MONTHS[bs.month - 1]} ${bs.year}`;
  }
  if (format === 'short') {
    return `${bs.day} ${BS_MONTHS[bs.month - 1].slice(0, 3)} ${bs.year}`;
  }

  // Default: YYYY/MM/DD
  const mm = String(bs.month).padStart(2, '0');
  const dd = String(bs.day).padStart(2, '0');
  return `${bs.year}/${mm}/${dd}`;
}

/**
 * Parse a BS date string to Gregorian ISO.
 * Accepts formats: 'YYYY/MM/DD', 'YYYY-MM-DD'
 */
export function parseBsDate(bsString: string): string {
  const parts = bsString.split(/[\/\-]/);
  if (parts.length !== 3) {
    throw new Error(`Cannot parse BS date: ${bsString}. Expected format: YYYY/MM/DD`);
  }
  const [y, m, d] = parts.map(Number);
  return bsToGregorian(y, m, d);
}

/**
 * Get current BS year.
 */
export function getCurrentBsYear(): number {
  const now = new Date();
  const iso = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return gregorianToBs(iso).year;
}

/**
 * Get BS month name (English).
 * @param month 1-indexed (1=Baishakh, 12=Chaitra)
 */
export function getBsMonthName(month: number, locale: 'en' | 'ne' = 'en'): string {
  if (month < 1 || month > 12) throw new Error(`Invalid BS month: ${month}`);
  return locale === 'ne' ? BS_MONTHS_NE[month - 1] : BS_MONTHS[month - 1];
}

/**
 * Get number of days in a BS month.
 */
export function getBsMonthDays(year: number, month: number): number {
  const data = BS_CALENDAR_DATA[year];
  if (!data) throw new Error(`BS year ${year} is out of supported range`);
  if (month < 1 || month > 12) throw new Error(`Invalid BS month: ${month}`);
  return data[month - 1];
}

/**
 * Get all BS month names.
 */
export function getBsMonthNames(locale: 'en' | 'ne' = 'en'): string[] {
  return locale === 'ne' ? [...BS_MONTHS_NE] : [...BS_MONTHS];
}

/**
 * Get total days in a BS year.
 */
export function getBsYearDays(year: number): number {
  return getTotalDaysInBsYear(year);
}

/**
 * Check if a BS year is in the supported range.
 */
export function isBsYearSupported(year: number): boolean {
  return !!BS_CALENDAR_DATA[year];
}

/**
 * Get the supported BS year range.
 */
export function getBsSupportedRange(): { min: number; max: number } {
  const years = Object.keys(BS_CALENDAR_DATA).map(Number);
  return { min: Math.min(...years), max: Math.max(...years) };
}
