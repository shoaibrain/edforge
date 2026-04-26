import {
  phoneFormatForArchetype,
  isValidPhoneForArchetype,
  stripPhoneToLocalDigits,
} from './phone-format';

describe('phoneFormatForArchetype', () => {
  describe('Resolution order — archetype-first', () => {
    it('returns Nepal mobile for PABSON archetype regardless of country', () => {
      expect(phoneFormatForArchetype('PABSON', 'USA').dialCode).toBe('+977');
      expect(phoneFormatForArchetype('PABSON', undefined).dialCode).toBe('+977');
      expect(phoneFormatForArchetype('PABSON', 'NPL').dialCode).toBe('+977');
    });

    it('returns Nepal mobile for GENERIC archetype tenants in Nepal (country fallback)', () => {
      expect(phoneFormatForArchetype('GENERIC', 'NPL').dialCode).toBe('+977');
      expect(phoneFormatForArchetype(undefined, 'NPL').dialCode).toBe('+977');
    });

    it('returns US default for everything else', () => {
      expect(phoneFormatForArchetype('GENERIC', 'USA').dialCode).toBe('+1');
      expect(phoneFormatForArchetype(undefined, undefined).dialCode).toBe('+1');
      expect(phoneFormatForArchetype(undefined, null).dialCode).toBe('+1');
      expect(phoneFormatForArchetype(null, null).dialCode).toBe('+1');
    });
  });

  describe('Format spec shape', () => {
    it('Nepal mobile has the expected fields', () => {
      const fmt = phoneFormatForArchetype('PABSON', 'NPL');
      expect(fmt.dialCode).toBe('+977');
      expect(fmt.label).toBe('Nepal mobile (+977)');
      expect(fmt.placeholder).toBe('98XXXXXXXX');
      expect(fmt.localNumberLength).toBe(10);
      expect(fmt.countryCode).toBe('NPL');
      expect(fmt.localNumberRegex).toBeInstanceOf(RegExp);
    });

    it('US default has the expected fields', () => {
      const fmt = phoneFormatForArchetype(undefined, undefined);
      expect(fmt.dialCode).toBe('+1');
      expect(fmt.label).toBe('US/Canada (+1)');
      expect(fmt.localNumberLength).toBe(10);
      expect(fmt.countryCode).toBe('USA');
    });
  });
});

describe('isValidPhoneForArchetype — PABSON / Nepal', () => {
  it.each([
    ['9812345678', 'pure 10-digit local starting with 9'],
    ['+9779812345678', 'with +977 dial-code prefix'],
    ['+977-981-234-5678', 'with formatting punctuation'],
    ['+977 981 234 5678', 'with spaces'],
    ['9712345678', '97-prefixed Ncell number'],
    ['9612345678', '96-prefixed Smart number'],
  ])('accepts %s (%s)', (input) => {
    expect(isValidPhoneForArchetype(input, 'PABSON', 'NPL')).toBe(true);
  });

  it.each([
    ['', 'empty string'],
    ['8123456789', "doesn't start with 9 (Nepal mobile rule)"],
    ['981234567', '9 digits — too short'],
    ['98123456789', '11 digits — too long'],
    ['abc', 'non-numeric'],
    ['+1-555-555-5555', 'US dial code on Nepal tenant'],
  ])('rejects %s (%s)', (input) => {
    expect(isValidPhoneForArchetype(input, 'PABSON', 'NPL')).toBe(false);
  });

  it('GENERIC archetype + NPL country falls back to Nepal validation', () => {
    expect(isValidPhoneForArchetype('9812345678', 'GENERIC', 'NPL')).toBe(true);
  });
});

describe('isValidPhoneForArchetype — GENERIC / US default', () => {
  it.each([
    ['5551234567', 'pure 10-digit'],
    ['+15551234567', 'with +1 dial code'],
    ['(555) 123-4567', 'with formatting'],
    ['555.123.4567', 'with dots'],
  ])('accepts %s (%s)', (input) => {
    expect(isValidPhoneForArchetype(input, 'GENERIC', 'USA')).toBe(true);
  });

  it.each([
    ['', 'empty string'],
    ['12345', 'too short'],
    ['12345678901', '11 digits — too long for US'],
    ['abcdefghij', 'non-numeric'],
  ])('rejects %s (%s)', (input) => {
    expect(isValidPhoneForArchetype(input, 'GENERIC', 'USA')).toBe(false);
  });
});

describe('isValidPhoneForArchetype — defensive', () => {
  it('returns false for non-string input', () => {
    expect(isValidPhoneForArchetype(undefined as any, 'PABSON', 'NPL')).toBe(false);
    expect(isValidPhoneForArchetype(null as any, 'PABSON', 'NPL')).toBe(false);
    expect(isValidPhoneForArchetype(0 as any, 'PABSON', 'NPL')).toBe(false);
  });
});

describe('stripPhoneToLocalDigits', () => {
  it('strips Nepal dial code + punctuation', () => {
    expect(stripPhoneToLocalDigits('+977-981-234-5678', 'PABSON', 'NPL')).toBe('9812345678');
    expect(stripPhoneToLocalDigits('+977 981 234 5678', 'PABSON', 'NPL')).toBe('9812345678');
  });

  it('passes through pure local digits unchanged', () => {
    expect(stripPhoneToLocalDigits('9812345678', 'PABSON', 'NPL')).toBe('9812345678');
  });

  it('strips US dial code on US format', () => {
    expect(stripPhoneToLocalDigits('+1-555-123-4567', 'GENERIC', 'USA')).toBe('5551234567');
  });

  it('returns empty string for empty input', () => {
    expect(stripPhoneToLocalDigits('', 'PABSON', 'NPL')).toBe('');
  });

  it('does NOT strip an unrelated dial code (e.g., +1 on Nepal-formatted input)', () => {
    // The +1 won't match Nepal's +977, so it stays — leaving the user with a
    // bad number that fails validation. This is the expected behavior; the UI
    // should set the correct dial-code prefix automatically.
    const result = stripPhoneToLocalDigits('+15551234567', 'PABSON', 'NPL');
    expect(result).toBe('15551234567');
  });
});
