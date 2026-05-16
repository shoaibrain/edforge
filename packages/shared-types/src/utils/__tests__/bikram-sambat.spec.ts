/**
 * Bikram Sambat converter regression spec.
 *
 * Added 2026-05-16 alongside the BS 2083 Pus correction (29 → 30).
 * BS 2083 is a 366-day year; the table had previously declared Pus = 29
 * which silently shifted every date conversion from Pus 30 onward by 1
 * day. Production impact: ~3 months of date conversions (late December
 * 2026 through early April 2027) were off by one before the fix.
 *
 * Coverage in this spec:
 *   1. BS 2083 month-day counts (pinned via direct table-lookup)
 *   2. BS 2083 total year days = 366 (catches summed regressions)
 *   3. Pus 30 2083 is a valid date (the specific bug)
 *   4. Pus 31 2083 is invalid (catches over-correction)
 *
 * The BS→AD→BS roundtrip would be a stronger guarantee but the existing
 * `gregorianToBs` has a separate timezone fragility (parses ISO strings
 * as UTC midnight, then reads local components) that's unrelated to this
 * Pus 2083 fix. That TZ bug is tracked in deferred-work.md and gets a
 * separate spec when fixed. The current tests below are TZ-independent.
 */

import {
  bsToGregorian,
  getBsMonthDays,
  getBsYearDays,
  isBsYearSupported,
} from '../bikram-sambat';

describe('BS_CALENDAR_DATA — BS 2083 month-day counts', () => {
  /**
   * Canonical month-day counts for BS 2083. Pinned to catch silent
   * regressions in the lookup table — the prior Pus = 29 bug went
   * undetected because no spec asserted these counts.
   */
  const BS_2083_MONTH_DAYS: ReadonlyArray<readonly [number, number, string]> = [
    [1, 31, 'Baisakh'],
    [2, 31, 'Jeth'],
    [3, 32, 'Asar'],
    [4, 31, 'Saun'],
    [5, 31, 'Bhadau'],
    [6, 30, 'Asoj'],
    [7, 30, 'Kartik'],
    [8, 30, 'Mangsir'],
    [9, 30, 'Pus'], // ← corrected 2026-05-16 (was 29)
    [10, 30, 'Magh'],
    [11, 30, 'Fagun'],
    [12, 30, 'Chait'],
  ];

  it.each(BS_2083_MONTH_DAYS)(
    'getBsMonthDays(2083, %i) returns %i (%s)',
    (month, expected) => {
      expect(getBsMonthDays(2083, month)).toBe(expected);
    },
  );

  it('BS 2083 has 366 total days (sum of all month-day counts)', () => {
    // BS 2083 is a 366-day year. The prior buggy table gave 365 because
    // Pus was understated as 29. A 1-day error in any month flips this.
    expect(getBsYearDays(2083)).toBe(366);
  });

  it('isBsYearSupported(2083) is true', () => {
    expect(isBsYearSupported(2083)).toBe(true);
  });
});

describe('Pus 2083 — the specific regression date', () => {
  it('Pus 2083 has exactly 30 days (the bug fix)', () => {
    expect(getBsMonthDays(2083, 9)).toBe(30);
  });

  it('bsToGregorian(2083, 9, 30) succeeds (the corrected last day of Pus)', () => {
    // The function throws on invalid (year, month, day) tuples. If Pus 2083
    // had only 29 days (the pre-fix state), this call would throw.
    const ad = bsToGregorian(2083, 9, 30);
    expect(ad).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('bsToGregorian(2083, 9, 31) throws (catches over-correction)', () => {
    // Guard against a future PR that pushes the day count to 31 by mistake.
    expect(() => bsToGregorian(2083, 9, 31)).toThrow(/Invalid BS date/);
  });

  it('successive Pus 2083 days (28 → 29 → 30) map to consecutive AD days', () => {
    // Three calls to bsToGregorian; differencing the returned AD strings
    // confirms the table assigns one day per BS day at the corrected
    // month-end boundary. TZ-independent because bsToGregorian uses
    // LOCAL setDate arithmetic from a LOCAL-constructed epoch.
    const ad28 = bsToGregorian(2083, 9, 28);
    const ad29 = bsToGregorian(2083, 9, 29);
    const ad30 = bsToGregorian(2083, 9, 30);

    const dayMs = 86400000;
    // Append T00:00:00 to coerce LOCAL midnight parse, matching the
    // LOCAL midnight that bsToGregorian's output represents.
    const t28 = new Date(ad28 + 'T00:00:00').getTime();
    const t29 = new Date(ad29 + 'T00:00:00').getTime();
    const t30 = new Date(ad30 + 'T00:00:00').getTime();

    expect(t29 - t28).toBe(dayMs);
    expect(t30 - t29).toBe(dayMs);
  });
});
