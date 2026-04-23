import {
  iemisSchoolCodeSchema,
  iemisStudentIdSchema,
  isValidIemisSchoolCode,
  isValidIemisStudentId,
} from './iemis-codes';

describe('iemisSchoolCodeSchema', () => {
  it.each([
    ['12345678', '8 digits'],
    ['123456789', '9 digits'],
    ['1234567890', '10 digits'],
    ['00000001', 'leading zeros preserved'],
  ])('accepts %s (%s)', (input) => {
    expect(iemisSchoolCodeSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    ['1234567', '7 digits — too short'],
    ['12345678901', '11 digits — too long'],
    ['', 'empty string'],
    ['12345 678', 'space embedded'],
    ['12-345678', 'dash embedded'],
    ['abcd1234', 'non-digits'],
    ['12345678 ', 'trailing space'],
    [' 12345678', 'leading space'],
    ['१२३४५६७८', 'Devanagari digits rejected — we require ASCII'],
  ])('rejects %s (%s)', (input) => {
    expect(iemisSchoolCodeSchema.safeParse(input).success).toBe(false);
  });

  it('rejects non-string inputs', () => {
    expect(iemisSchoolCodeSchema.safeParse(12345678).success).toBe(false);
    expect(iemisSchoolCodeSchema.safeParse(null).success).toBe(false);
    expect(iemisSchoolCodeSchema.safeParse(undefined).success).toBe(false);
  });

  it('returns an actionable error message on malformed input', () => {
    const result = iemisSchoolCodeSchema.safeParse('abc');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].message).toContain('8–10 digits');
    }
  });
});

describe('iemisStudentIdSchema', () => {
  it.each([
    ['1234567890123456', 'canonical 16 digits'],
    ['0000000000000001', 'left-padded with leading zeros'],
    ['9999999999999999', 'all nines'],
  ])('accepts %s (%s)', (input) => {
    expect(iemisStudentIdSchema.safeParse(input).success).toBe(true);
  });

  it.each([
    ['123456789012345', '15 digits — too short'],
    ['12345678901234567', '17 digits — too long'],
    ['', 'empty'],
    ['1234-5678-9012-3456', 'hyphens'],
    ['1234 5678 9012 3456', 'spaces'],
    ['abcdefghijklmnop', 'letters'],
    ['१२३४५६७८९०१२३४५६', 'Devanagari digits'],
  ])('rejects %s (%s)', (input) => {
    expect(iemisStudentIdSchema.safeParse(input).success).toBe(false);
  });

  it('preserves leading zeros (CEHRD treats `0012…` ≠ `12…`)', () => {
    const result = iemisStudentIdSchema.safeParse('0012345678901234');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toBe('0012345678901234');
      expect(result.data).not.toBe('12345678901234');
    }
  });
});

describe('isValidIemisSchoolCode (type-narrowing helper)', () => {
  it('returns true for valid codes', () => {
    expect(isValidIemisSchoolCode('12345678')).toBe(true);
    expect(isValidIemisSchoolCode('1234567890')).toBe(true);
  });

  it('returns false for invalid / non-string inputs', () => {
    expect(isValidIemisSchoolCode('abc')).toBe(false);
    expect(isValidIemisSchoolCode(12345678)).toBe(false);
    expect(isValidIemisSchoolCode(null)).toBe(false);
    expect(isValidIemisSchoolCode(undefined)).toBe(false);
    expect(isValidIemisSchoolCode({})).toBe(false);
  });

  it('narrows the type in a TS context', () => {
    const candidate: unknown = '12345678';
    if (isValidIemisSchoolCode(candidate)) {
      // compiles only because candidate is narrowed to IemisSchoolCode (= string)
      const n: string = candidate;
      expect(n.length).toBe(8);
    }
  });
});

describe('isValidIemisStudentId (type-narrowing helper)', () => {
  it('returns true for valid ID', () => {
    expect(isValidIemisStudentId('1234567890123456')).toBe(true);
  });

  it('returns false for malformed / non-string', () => {
    expect(isValidIemisStudentId('123')).toBe(false);
    expect(isValidIemisStudentId(1234567890123456)).toBe(false);
    expect(isValidIemisStudentId(null)).toBe(false);
  });
});
