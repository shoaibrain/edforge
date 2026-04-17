import {
  validateDateRange,
  validateGranularity,
  validateWeekKey,
  validateDays,
  ValidationError,
} from './validation';

describe('validateDateRange', () => {
  it('accepts a valid yyyy-mm-dd range', () => {
    expect(validateDateRange('2026-04-01', '2026-04-14')).toEqual({
      from: '2026-04-01',
      to: '2026-04-14',
    });
  });
  it('rejects missing from', () => {
    expect(() => validateDateRange(undefined, '2026-04-14')).toThrow(ValidationError);
  });
  it('rejects bad format', () => {
    expect(() => validateDateRange('2026/04/01', '2026-04-14')).toThrow(ValidationError);
  });
  it('rejects to < from', () => {
    expect(() => validateDateRange('2026-04-14', '2026-04-01')).toThrow(/before/);
  });
  it('rejects > 365 day range', () => {
    expect(() => validateDateRange('2024-01-01', '2026-04-14')).toThrow(/365/);
  });
});

describe('validateGranularity', () => {
  it.each(['day', 'week', 'month'])('accepts %s', (g) => {
    expect(validateGranularity(g)).toBe(g);
  });
  it('rejects unknown', () => {
    expect(() => validateGranularity('hour')).toThrow(ValidationError);
    expect(() => validateGranularity(undefined)).toThrow(ValidationError);
  });
});

describe('validateWeekKey', () => {
  it('accepts 2026-W16', () => {
    expect(validateWeekKey('2026-W16')).toBe('2026-W16');
  });
  it('rejects bad format', () => {
    expect(() => validateWeekKey('2026-04-14')).toThrow(ValidationError);
    expect(() => validateWeekKey(undefined)).toThrow(ValidationError);
  });
});

describe('validateDays', () => {
  it('defaults to 30 when unset', () => {
    expect(validateDays(undefined)).toBe(30);
  });
  it('accepts 1..365', () => {
    expect(validateDays('1')).toBe(1);
    expect(validateDays('365')).toBe(365);
  });
  it('rejects 0 / 366 / non-numeric', () => {
    expect(() => validateDays('0')).toThrow(ValidationError);
    expect(() => validateDays('366')).toThrow(ValidationError);
    expect(() => validateDays('abc')).toThrow(ValidationError);
  });
});
