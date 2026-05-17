/**
 * BS ↔ AD roundtrip property test.
 *
 * For every supported BS year (2000–2090) and every BS month (1–12),
 * verify that `bsToGregorian(y, m, d) → gregorianToBs(that) === (y, m, d)`
 * for: day 1, day 15 (if present), and the last day of the month. This is
 * the C3.7 regression guard for the `gregorianToBs` timezone fix
 * (date-only ISO strings now anchor to noon-local, so the day no longer
 * shifts under negative-offset hosts).
 *
 * Coverage: 91 years × 12 months × {first, mid, last} ≈ ~3,200 samples.
 * The spec also pins a single host-timezone check via TZ=America/Chicago
 * (negative offset) to make sure the fix actually defends the historical
 * failure mode and not just UTC CI.
 */

import { bsToGregorian, getBsMonthDays, getBsSupportedRange, gregorianToBs } from '../bikram-sambat';

describe('BS ↔ AD roundtrip integrity (BS 2000–2090)', () => {
  const { min, max } = getBsSupportedRange();

  it('reports the expected supported range', () => {
    expect(min).toBe(2000);
    expect(max).toBe(2090);
  });

  describe.each(
    Array.from({ length: max - min + 1 }, (_, i) => min + i),
  )('BS year %i', (year) => {
    for (let month = 1; month <= 12; month++) {
      it(`month ${month} roundtrips first/mid/last day`, () => {
        const monthDays = getBsMonthDays(year, month);
        const samples = new Set<number>([1, Math.min(15, monthDays), monthDays]);

        for (const day of samples) {
          const iso = bsToGregorian(year, month, day);
          const back = gregorianToBs(iso);
          expect(back).toEqual({ year, month, day });
        }
      });
    }
  });

  it('completes under 2 seconds for the full year sweep', () => {
    const start = Date.now();
    for (let year = min; year <= max; year++) {
      for (let month = 1; month <= 12; month++) {
        const monthDays = getBsMonthDays(year, month);
        for (const day of [1, Math.min(15, monthDays), monthDays]) {
          const iso = bsToGregorian(year, month, day);
          const back = gregorianToBs(iso);
          if (back.year !== year || back.month !== month || back.day !== day) {
            throw new Error(`Roundtrip drift at BS ${year}/${month}/${day}`);
          }
        }
      }
    }
    expect(Date.now() - start).toBeLessThan(2000);
  });
});

describe('gregorianToBs — TZ fix (date-only ISO anchored to noon-local)', () => {
  const ORIGINAL_TZ = process.env.TZ;

  afterAll(() => {
    if (ORIGINAL_TZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = ORIGINAL_TZ;
    }
  });

  // Setting process.env.TZ at runtime is honored by Node's Date implementation
  // on Linux/macOS for subsequent Date operations (no module reset required).
  // The historical bug was: in negative-offset hosts, `new Date('YYYY-MM-DD')`
  // parses as UTC midnight, then `.getDate()` reads the previous local day
  // and the conversion drops one day. With the T12:00:00-local anchor in
  // gregorianToBs, the same date-only inputs return the correct BS day.
  it('returns the correct BS date in a negative-offset host (America/Chicago, UTC-5/-6)', () => {
    process.env.TZ = 'America/Chicago';
    expect(gregorianToBs('2026-04-14')).toEqual({ year: 2083, month: 1, day: 1 });
    expect(gregorianToBs('2026-04-16')).toEqual({ year: 2083, month: 1, day: 3 });
    expect(gregorianToBs('2026-07-16')).toEqual({ year: 2083, month: 3, day: 32 });
    expect(gregorianToBs('2027-04-14')).toEqual({ year: 2083, month: 12, day: 30 });
  });
});
