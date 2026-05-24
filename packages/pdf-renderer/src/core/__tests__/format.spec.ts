import { formatDate, formatNumber } from '../format';

describe('formatDate', () => {
  // 2026-04-28 Gregorian = BS 2083-01-15 (Baisakh 15, 2083)
  const sampleIso = '2026-04-28T00:00:00Z';

  it('gregorian mode returns ISO YYYY-MM-DD', () => {
    expect(formatDate(sampleIso, 'gregorian')).toBe('2026-04-28');
  });

  it('bikram_sambat mode returns "B.S. YYYY-MM-DD"', () => {
    expect(formatDate(sampleIso, 'bikram_sambat')).toBe('B.S. 2083-01-15');
  });

  it('dual mode returns "B.S. YYYY-MM-DD (YYYY-MM-DD)"', () => {
    // This is the exact contract from c-epic-pdf-generation-design.md §1
    expect(formatDate(sampleIso, 'dual', 'ne-NP')).toBe(
      'B.S. 2083-01-15 (2026-04-28)',
    );
  });

  it('pads single-digit months and days to 2 chars', () => {
    // 2026-01-15 → BS 2082-10-02 (Magh 2, 2082) — but we just need to assert
    // padding works on the gregorian side
    expect(formatDate('2026-01-05T00:00:00Z', 'gregorian')).toBe('2026-01-05');
  });

  it('does not throw on invalid date input — surfaces the input instead', () => {
    const invalid = 'not-an-iso-date';
    expect(() => formatDate(invalid, 'gregorian')).not.toThrow();
    expect(formatDate(invalid, 'gregorian')).toBe(invalid);
  });

  it('locale parameter is accepted but not yet differentiating in V1', () => {
    expect(formatDate(sampleIso, 'gregorian', 'en-US')).toBe(
      formatDate(sampleIso, 'gregorian', 'ne-NP'),
    );
  });
});

describe('formatNumber', () => {
  describe('western grouping', () => {
    it('groups in thousands', () => {
      expect(formatNumber(1234567, 'western')).toBe('1,234,567');
    });
    it('handles small values without grouping', () => {
      expect(formatNumber(42, 'western')).toBe('42');
      expect(formatNumber(999, 'western')).toBe('999');
    });
    it('truncates decimals (caller responsible for currency decimals via formatCurrency)', () => {
      expect(formatNumber(1234.99, 'western')).toBe('1,234');
    });
  });

  describe('south-asian grouping (Nepal / India)', () => {
    it('uses lakh / crore grouping: last 3 then pairs of 2', () => {
      expect(formatNumber(1234567, 'south-asian')).toBe('12,34,567');
    });
    it('handles small values without grouping', () => {
      expect(formatNumber(42, 'south-asian')).toBe('42');
      expect(formatNumber(999, 'south-asian')).toBe('999');
    });
    it('handles four-digit values', () => {
      // 1234 → 1,234 (only one comma since rest is 1 digit)
      expect(formatNumber(1234, 'south-asian')).toBe('1,234');
    });
    it('handles crore range (10,000,000)', () => {
      expect(formatNumber(12345678, 'south-asian')).toBe('1,23,45,678');
    });
  });

  describe('edge cases', () => {
    it('returns "0" for NaN input', () => {
      expect(formatNumber(NaN, 'south-asian')).toBe('0');
      expect(formatNumber(NaN, 'western')).toBe('0');
    });
    it('returns "0" for Infinity input', () => {
      expect(formatNumber(Infinity, 'south-asian')).toBe('0');
    });
    it('handles negative values', () => {
      expect(formatNumber(-1234567, 'south-asian')).toBe('-12,34,567');
      expect(formatNumber(-1234567, 'western')).toBe('-1,234,567');
    });
  });
});
