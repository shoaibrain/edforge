import {
  toDateKey,
  toWeekKey,
  toMonthKey,
  shiftDays,
  parseDateKey,
  resolveTargetDate,
} from './date-utils';

describe('date-utils (6.3)', () => {
  it('toDateKey / parseDateKey round trip', () => {
    const d = parseDateKey('2026-04-14');
    expect(toDateKey(d)).toBe('2026-04-14');
  });

  describe('toWeekKey — ISO-8601', () => {
    it('mid-week', () => {
      // 2026-04-14 is a Tuesday → ISO week 16
      expect(toWeekKey(parseDateKey('2026-04-14'))).toBe('2026-W16');
    });
    it('Sunday rolls over at week boundary', () => {
      // Sun 2026-04-12 → ISO week 15. Mon 2026-04-13 → ISO week 16.
      expect(toWeekKey(parseDateKey('2026-04-12'))).toBe('2026-W15');
      expect(toWeekKey(parseDateKey('2026-04-13'))).toBe('2026-W16');
    });
    it('year-end edge: 2024-12-30 (Mon) is 2025-W01', () => {
      expect(toWeekKey(parseDateKey('2024-12-30'))).toBe('2025-W01');
    });
    it('year-start edge: 2023-01-01 (Sun) is 2022-W52', () => {
      expect(toWeekKey(parseDateKey('2023-01-01'))).toBe('2022-W52');
    });
  });

  describe('toMonthKey', () => {
    it('pads single-digit months', () => {
      expect(toMonthKey(parseDateKey('2026-04-14'))).toBe('2026-04');
      expect(toMonthKey(parseDateKey('2026-01-01'))).toBe('2026-01');
    });
    it('month boundary: last day of Jan → 2026-01, first of Feb → 2026-02', () => {
      expect(toMonthKey(parseDateKey('2026-01-31'))).toBe('2026-01');
      expect(toMonthKey(parseDateKey('2026-02-01'))).toBe('2026-02');
    });
    it('year boundary: 2026-12-31 → 2026-12, 2027-01-01 → 2027-01', () => {
      expect(toMonthKey(parseDateKey('2026-12-31'))).toBe('2026-12');
      expect(toMonthKey(parseDateKey('2027-01-01'))).toBe('2027-01');
    });
  });

  describe('shiftDays', () => {
    it('shifts forward and backward without mutating input', () => {
      const d = parseDateKey('2026-04-14');
      expect(toDateKey(shiftDays(d, 7))).toBe('2026-04-21');
      expect(toDateKey(shiftDays(d, -14))).toBe('2026-03-31');
      expect(toDateKey(d)).toBe('2026-04-14'); // unchanged
    });
    it('crosses year boundary', () => {
      expect(toDateKey(shiftDays(parseDateKey('2026-12-30'), 5))).toBe('2027-01-04');
    });
  });

  describe('resolveTargetDate priority', () => {
    const savedEnv = process.env.DATE_OVERRIDE;
    afterEach(() => {
      if (savedEnv === undefined) delete process.env.DATE_OVERRIDE;
      else process.env.DATE_OVERRIDE = savedEnv;
    });

    it('uses DATE_OVERRIDE when set', () => {
      process.env.DATE_OVERRIDE = '2026-01-15';
      const d = resolveTargetDate({ date: '2026-04-14' });
      expect(toDateKey(d)).toBe('2026-01-15');
    });
    it('falls back to event.date', () => {
      delete process.env.DATE_OVERRIDE;
      const d = resolveTargetDate({ date: '2026-04-14' });
      expect(toDateKey(d)).toBe('2026-04-14');
    });
    it('defaults to yesterday when neither is set', () => {
      delete process.env.DATE_OVERRIDE;
      const d = resolveTargetDate({});
      const yesterday = toDateKey(shiftDays(new Date(), -1));
      expect(toDateKey(d)).toBe(yesterday);
    });
  });
});
