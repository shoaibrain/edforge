import {
  toDateKey,
  toWeekKey,
  toMonthKey,
  shiftDays,
  parseDateKey,
  resolveTargetDate,
} from './date-utils';

describe('date-utils — Asia/Kathmandu civil-date semantics (ACRIT.1)', () => {
  describe('round-trip', () => {
    it('toDateKey / parseDateKey round trip on a benign date', () => {
      const d = parseDateKey('2026-04-14');
      expect(toDateKey(d)).toBe('2026-04-14');
    });
  });

  describe('NPT boundary correctness — the bug ACRIT.1 fixes', () => {
    // NPT = UTC+5:45. Boundaries cluster around 18:14:59 / 18:15:00 UTC.

    it('event at 18:14:59 UTC bucketed to NPT day D (= same calendar day)', () => {
      // 18:14:59 UTC on 2026-04-13 = 23:59:59 NPT on 2026-04-13
      expect(toDateKey(new Date('2026-04-13T18:14:59Z'))).toBe('2026-04-13');
    });

    it('event at 18:15:00 UTC bucketed to NPT day D+1', () => {
      // 18:15:00 UTC on 2026-04-13 = 00:00:00 NPT on 2026-04-14
      expect(toDateKey(new Date('2026-04-13T18:15:00Z'))).toBe('2026-04-14');
    });

    it('a 5:30 AM NPT Sunday event lands on Sunday, NOT Saturday', () => {
      // The motivating bug example. 5:30 AM NPT Sunday 2026-04-12
      //   = 23:45 UTC Saturday 2026-04-11
      // Old UTC code bucketed this to 2026-04-11 (Saturday). That's wrong:
      // a teacher taking attendance early Sunday morning was credited to
      // the previous Saturday's totals.
      expect(toDateKey(new Date('2026-04-11T23:45:00Z'))).toBe('2026-04-12');
    });

    it('midnight UTC bucketed to NPT day D (= same calendar day)', () => {
      // 00:00:00 UTC on 2026-04-13 = 05:45:00 NPT on 2026-04-13
      expect(toDateKey(new Date('2026-04-13T00:00:00Z'))).toBe('2026-04-13');
    });

    it('23:59:59 UTC bucketed to NPT day D+1', () => {
      // 23:59:59 UTC on 2026-04-12 = 05:44:59 NPT on 2026-04-13
      expect(toDateKey(new Date('2026-04-12T23:59:59Z'))).toBe('2026-04-13');
    });
  });

  describe('toWeekKey — ISO weeks computed from NPT date', () => {
    it('mid-week', () => {
      // 2026-04-14 is a Tuesday → ISO week 16
      expect(toWeekKey(parseDateKey('2026-04-14'))).toBe('2026-W16');
    });

    it('Sunday rolls over at week boundary', () => {
      // Sun 2026-04-12 → ISO week 15. Mon 2026-04-13 → ISO week 16.
      expect(toWeekKey(parseDateKey('2026-04-12'))).toBe('2026-W15');
      expect(toWeekKey(parseDateKey('2026-04-13'))).toBe('2026-W16');
    });

    it('year-end edge: 2024-12-30 (Mon NPT) is 2025-W01', () => {
      expect(toWeekKey(parseDateKey('2024-12-30'))).toBe('2025-W01');
    });

    it('year-start edge: 2023-01-01 (Sun NPT) is 2022-W52', () => {
      expect(toWeekKey(parseDateKey('2023-01-01'))).toBe('2022-W52');
    });

    it('NPT-Sunday late evening still maps to that NPT Sunday week', () => {
      // 18:14 UTC Sun 2026-04-12 = 23:59 NPT Sun 2026-04-12 → ISO week 15
      // Old UTC code would have computed Mon 18:14 UTC → ISO week 16. Wrong.
      expect(toWeekKey(new Date('2026-04-12T18:14:00Z'))).toBe('2026-W15');
    });
  });

  describe('toMonthKey — NPT month', () => {
    it('pads single-digit months', () => {
      expect(toMonthKey(parseDateKey('2026-04-14'))).toBe('2026-04');
      expect(toMonthKey(parseDateKey('2026-01-01'))).toBe('2026-01');
    });

    it('month boundary: last day of Jan NPT → 2026-01, first of Feb NPT → 2026-02', () => {
      expect(toMonthKey(parseDateKey('2026-01-31'))).toBe('2026-01');
      expect(toMonthKey(parseDateKey('2026-02-01'))).toBe('2026-02');
    });

    it('year boundary: 2026-12-31 NPT → 2026-12, 2027-01-01 NPT → 2027-01', () => {
      expect(toMonthKey(parseDateKey('2026-12-31'))).toBe('2026-12');
      expect(toMonthKey(parseDateKey('2027-01-01'))).toBe('2027-01');
    });

    it('NPT-month-boundary correctness across the 18:15 UTC line', () => {
      // 18:14 UTC on Jan 31 = 23:59 NPT Jan 31 → 2026-01
      // 18:15 UTC on Jan 31 = 00:00 NPT Feb 1 → 2026-02
      expect(toMonthKey(new Date('2026-01-31T18:14:00Z'))).toBe('2026-01');
      expect(toMonthKey(new Date('2026-01-31T18:15:00Z'))).toBe('2026-02');
    });
  });

  describe('shiftDays — NPT calendar arithmetic', () => {
    it('shifts forward and backward without mutating input', () => {
      const d = parseDateKey('2026-04-14');
      expect(toDateKey(shiftDays(d, 7))).toBe('2026-04-21');
      expect(toDateKey(shiftDays(d, -14))).toBe('2026-03-31');
      expect(toDateKey(d)).toBe('2026-04-14'); // unchanged
    });

    it('crosses year boundary on the NPT calendar', () => {
      expect(toDateKey(shiftDays(parseDateKey('2026-12-30'), 5))).toBe('2027-01-04');
    });

    it('shift by 0 is identity for any input time', () => {
      const d = new Date('2026-04-13T18:30:00Z'); // 00:15 NPT 2026-04-14
      expect(toDateKey(shiftDays(d, 0))).toBe('2026-04-14');
    });
  });

  describe('resolveTargetDate priority', () => {
    const savedEnv = process.env.DATE_OVERRIDE;
    afterEach(() => {
      if (savedEnv === undefined) delete process.env.DATE_OVERRIDE;
      else process.env.DATE_OVERRIDE = savedEnv;
    });

    it('uses DATE_OVERRIDE when set (interpreted as NPT)', () => {
      process.env.DATE_OVERRIDE = '2026-01-15';
      const d = resolveTargetDate({ date: '2026-04-14' });
      expect(toDateKey(d)).toBe('2026-01-15');
    });

    it('falls back to event.date', () => {
      delete process.env.DATE_OVERRIDE;
      const d = resolveTargetDate({ date: '2026-04-14' });
      expect(toDateKey(d)).toBe('2026-04-14');
    });

    it('defaults to yesterday (NPT) when neither is set', () => {
      delete process.env.DATE_OVERRIDE;
      const d = resolveTargetDate({});
      const yesterday = toDateKey(shiftDays(new Date(), -1));
      expect(toDateKey(d)).toBe(yesterday);
    });
  });

  describe('A-WS3.T1 — per-tenant timezone parameter', () => {
    it('toDateKey defaults to Asia/Kathmandu (preserves V1 behavior)', () => {
      // Same boundary scenario from ACRIT.1 — must still bucket to NPT day.
      expect(toDateKey(new Date('2026-04-13T18:14:59Z'))).toBe('2026-04-13');
      expect(toDateKey(new Date('2026-04-13T18:15:00Z'))).toBe('2026-04-14');
    });

    it('toDateKey honors America/New_York (US tenant)', () => {
      // EST = UTC-5 (no DST in this date)
      // 23:45 UTC Sat 2026-01-10 = 18:45 EST Sat 2026-01-10 → Saturday
      expect(toDateKey(new Date('2026-01-10T23:45:00Z'), 'America/New_York')).toBe('2026-01-10');
      // 04:45 UTC Mon 2026-01-12 = 23:45 EST Sun 2026-01-11 → Sunday
      expect(toDateKey(new Date('2026-01-12T04:45:00Z'), 'America/New_York')).toBe('2026-01-11');
    });

    it('toDateKey honors UTC explicitly when requested', () => {
      expect(toDateKey(new Date('2026-04-13T18:14:59Z'), 'UTC')).toBe('2026-04-13');
      expect(toDateKey(new Date('2026-04-13T23:59:59Z'), 'UTC')).toBe('2026-04-13');
      expect(toDateKey(new Date('2026-04-14T00:00:00Z'), 'UTC')).toBe('2026-04-14');
    });

    it('SAME UTC instant produces DIFFERENT dates for tenants in different tz', () => {
      // 23:45 UTC Sat 2026-04-11
      const ts = new Date('2026-04-11T23:45:00Z');
      const npt = toDateKey(ts, 'Asia/Kathmandu'); // 05:30 NPT Sun → 2026-04-12
      const est = toDateKey(ts, 'America/New_York'); // 18:45 EST Sat → 2026-04-11
      expect(npt).toBe('2026-04-12');
      expect(est).toBe('2026-04-11');
      expect(npt).not.toBe(est);
    });

    it('toMonthKey respects tenant tz at month boundaries', () => {
      // 04:00 UTC Feb 1 = 23:00 EST Jan 31 → 2026-01 for EST tenant
      expect(toMonthKey(new Date('2026-02-01T04:00:00Z'), 'America/New_York')).toBe('2026-01');
      // Same UTC instant in NPT (= 09:45 NPT Feb 1) → 2026-02
      expect(toMonthKey(new Date('2026-02-01T04:00:00Z'), 'Asia/Kathmandu')).toBe('2026-02');
    });

    it('parseDateKey honors tz for non-default zones', () => {
      // Parsing "2026-04-15" as midnight EST means 04:00 UTC same day
      const est = parseDateKey('2026-04-15', 'America/New_York');
      expect(est.toISOString().slice(0, 16)).toBe('2026-04-15T04:00');
    });

    it('shiftDays operates on the local calendar in tenant tz', () => {
      // Asia/Kathmandu (default): 14 → 21
      const kKathmandu = parseDateKey('2026-04-14');
      expect(toDateKey(shiftDays(kKathmandu, 7))).toBe('2026-04-21');
      // America/New_York: 14 → 21 (same calendar arithmetic; tz only changes anchoring)
      const kNy = parseDateKey('2026-04-14', 'America/New_York');
      expect(toDateKey(shiftDays(kNy, 7, 'America/New_York'), 'America/New_York')).toBe('2026-04-21');
    });
  });
});
