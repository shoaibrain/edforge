/**
 * Spec for the C3.6 + C3.8 enhancements to `generateCalendarSchema`:
 *
 *   - C3.6: every date field accepts EITHER an AD (YYYY-MM-DD) or a
 *           BS (YYYY/MM/DD) variant; `resolveAdDate` normalizes to AD.
 *   - C3.8: `mode` field defaults to `'merge'` (operator-preserving) and
 *           accepts the alternative `'replace'` (Danger Zone, destructive).
 *
 * Pure schema + helper coverage. Service-side merge/replace partition
 * logic is covered separately in identity's calendar-date.service.spec.
 */

import {
  generateCalendarSchema,
  normalizeGenerateCalendarDtoToAd,
  resolveAdDate,
} from './calendar-date.schema';

const VALID_AY_ID = '0167de00-cc49-476b-9654-ef98a8cf9014';

describe('generateCalendarSchema — mode default + value', () => {
  it("defaults mode to 'merge' when omitted", () => {
    const parsed = generateCalendarSchema.parse({
      academicYearId: VALID_AY_ID,
      startDate: '2026-04-14',
      endDate: '2027-04-13',
    });
    expect(parsed.mode).toBe('merge');
  });

  it("accepts explicit mode='replace'", () => {
    const parsed = generateCalendarSchema.parse({
      academicYearId: VALID_AY_ID,
      startDate: '2026-04-14',
      endDate: '2027-04-13',
      mode: 'replace',
    });
    expect(parsed.mode).toBe('replace');
  });

  it("rejects unknown mode strings", () => {
    expect(() =>
      generateCalendarSchema.parse({
        academicYearId: VALID_AY_ID,
        startDate: '2026-04-14',
        endDate: '2027-04-13',
        mode: 'nuke',
      }),
    ).toThrow();
  });
});

describe('generateCalendarSchema — BS / AD date input', () => {
  it('accepts AD-only payload (the canonical pre-C3.6 shape)', () => {
    const parsed = generateCalendarSchema.parse({
      academicYearId: VALID_AY_ID,
      startDate: '2026-04-14',
      endDate: '2027-04-13',
    });
    expect(parsed.startDate).toBe('2026-04-14');
    expect(parsed.endDate).toBe('2027-04-13');
  });

  it('accepts BS-only payload for window endpoints', () => {
    const parsed = generateCalendarSchema.parse({
      academicYearId: VALID_AY_ID,
      startDateBs: '2083/01/01',
      endDateBs: '2083/12/30',
    });
    expect(parsed.startDateBs).toBe('2083/01/01');
    expect(parsed.endDateBs).toBe('2083/12/30');
  });

  it('accepts mixed AD + BS in one request (AD window + BS holiday)', () => {
    const parsed = generateCalendarSchema.parse({
      academicYearId: VALID_AY_ID,
      startDate: '2026-04-14',
      endDate: '2027-04-13',
      holidays: [{ name: 'Buddha Jayanti', dateBs: '2083/01/22' }],
    });
    expect(parsed.holidays?.[0].dateBs).toBe('2083/01/22');
  });

  it('rejects when neither startDate nor startDateBs is provided', () => {
    expect(() =>
      generateCalendarSchema.parse({
        academicYearId: VALID_AY_ID,
        endDate: '2027-04-13',
      }),
    ).toThrow(/startDate/);
  });

  it('rejects when neither endDate nor endDateBs is provided', () => {
    expect(() =>
      generateCalendarSchema.parse({
        academicYearId: VALID_AY_ID,
        startDate: '2026-04-14',
      }),
    ).toThrow(/endDate/);
  });

  it('rejects a holiday with neither date nor dateBs', () => {
    expect(() =>
      generateCalendarSchema.parse({
        academicYearId: VALID_AY_ID,
        startDate: '2026-04-14',
        endDate: '2027-04-13',
        holidays: [{ name: 'Mystery Day' } as any],
      }),
    ).toThrow();
  });

  it('rejects a break with only one BS endpoint set', () => {
    expect(() =>
      generateCalendarSchema.parse({
        academicYearId: VALID_AY_ID,
        startDate: '2026-04-14',
        endDate: '2027-04-13',
        breaks: [{ name: 'Winter Break', startDateBs: '2083/09/01' } as any],
      }),
    ).toThrow();
  });

  it('rejects out-of-range BS year (outside 2000–2090)', () => {
    expect(() =>
      generateCalendarSchema.parse({
        academicYearId: VALID_AY_ID,
        startDateBs: '1999/01/01',
        endDateBs: '2083/12/30',
      }),
    ).toThrow(/2000 and 2090/);
  });
});

describe('resolveAdDate', () => {
  it('prefers AD when both are present', () => {
    expect(resolveAdDate('2026-04-16', '2083/01/03')).toBe('2026-04-16');
  });

  it('converts BS to AD when only BS is present', () => {
    expect(resolveAdDate(undefined, '2083/01/01')).toBe('2026-04-14');
    expect(resolveAdDate(undefined, '2083/03/32')).toBe('2026-07-16');
  });

  it('passes AD through unchanged when only AD is present', () => {
    expect(resolveAdDate('2026-04-16', undefined)).toBe('2026-04-16');
  });

  it('throws when neither is provided', () => {
    expect(() => resolveAdDate(undefined, undefined)).toThrow(/required/);
  });

  it('throws on invalid BS day (overflows month)', () => {
    // BS 2083/01 has 31 days; day 32 is invalid.
    expect(() => resolveAdDate(undefined, '2083/01/32')).toThrow();
  });
});

describe('normalizeGenerateCalendarDtoToAd', () => {
  it('passes through an AD-only dto unchanged shape-wise', () => {
    const dto = generateCalendarSchema.parse({
      academicYearId: VALID_AY_ID,
      startDate: '2026-04-14',
      endDate: '2027-04-13',
      holidays: [{ date: '2026-05-23', name: 'Buddha Jayanti' }],
      breaks: [{ startDate: '2026-12-26', endDate: '2026-12-31', name: 'Winter' }],
    });
    const ad = normalizeGenerateCalendarDtoToAd(dto);
    expect(ad.startDate).toBe('2026-04-14');
    expect(ad.endDate).toBe('2027-04-13');
    expect(ad.mode).toBe('merge');
    expect(ad.holidays?.[0].date).toBe('2026-05-23');
    expect(ad.breaks?.[0].startDate).toBe('2026-12-26');
  });

  it('converts BS-only window + BS-only holidays/breaks to AD', () => {
    const dto = generateCalendarSchema.parse({
      academicYearId: VALID_AY_ID,
      startDateBs: '2083/01/01',
      endDateBs: '2083/12/30',
      mode: 'replace',
      holidays: [{ dateBs: '2083/01/22', name: 'Buddha Jayanti' }],
      breaks: [{ startDateBs: '2083/09/01', endDateBs: '2083/09/07', name: 'Dashain' }],
    });
    const ad = normalizeGenerateCalendarDtoToAd(dto);
    expect(ad.startDate).toBe('2026-04-14');
    expect(ad.endDate).toBe('2027-04-14');
    expect(ad.mode).toBe('replace');
    expect(ad.holidays?.[0].date).toBe(resolveAdDate(undefined, '2083/01/22'));
    expect(ad.breaks?.[0].startDate).toBe(resolveAdDate(undefined, '2083/09/01'));
    expect(ad.breaks?.[0].endDate).toBe(resolveAdDate(undefined, '2083/09/07'));
  });

  it('handles mixed AD + BS within one dto', () => {
    const dto = generateCalendarSchema.parse({
      academicYearId: VALID_AY_ID,
      startDate: '2026-04-14',       // AD
      endDateBs: '2083/12/30',        // BS
      holidays: [
        { date: '2026-05-23', name: 'AD Holiday' },
        { dateBs: '2083/02/15', name: 'BS Holiday' },
      ],
    });
    const ad = normalizeGenerateCalendarDtoToAd(dto);
    expect(ad.startDate).toBe('2026-04-14');
    expect(ad.endDate).toBe('2027-04-14');
    expect(ad.holidays).toHaveLength(2);
    expect(ad.holidays?.[0].date).toBe('2026-05-23');
    expect(ad.holidays?.[1].date).toBe(resolveAdDate(undefined, '2083/02/15'));
  });
});
