import {
  normalizeGender,
  cleanNullish,
  cleanPhone,
  splitFullNameLastSpace,
  isValidGradeForArchetype,
  normalizeName,
} from './import-normalize';

describe('normalizeGender', () => {
  it.each([
    ['m', 'male'],
    ['M', 'male'],
    ['male', 'male'],
    ['Male', 'male'],
    ['MALE', 'male'],
    ['f', 'female'],
    ['F', 'female'],
    ['female', 'female'],
    ['Female', 'female'],
    ['FEMALE', 'female'],
    ['o', 'other'],
    ['Other', 'other'],
    ['prefer_not_to_say', 'prefer_not_to_say'],
    ['PNS', 'prefer_not_to_say'],
    ['n/a', 'prefer_not_to_say'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeGender(input)).toBe(expected);
  });

  it.each([
    ['', null],
    [null, null],
    [undefined, null],
    ['unknown', null],
    ['X', null],
    ['123', null],
    ['  ', null],
  ])('%s → null', (input, expected) => {
    expect(normalizeGender(input)).toBe(expected);
  });
});

describe('cleanNullish', () => {
  it('strips Na / NA / na / null / -null, to null', () => {
    expect(cleanNullish('Na')).toBeNull();
    expect(cleanNullish('NA')).toBeNull();
    expect(cleanNullish('na')).toBeNull();
    expect(cleanNullish('null')).toBeNull();
    expect(cleanNullish('NULL')).toBeNull();
    expect(cleanNullish('-null,')).toBeNull();
    expect(cleanNullish('-null')).toBeNull();
    expect(cleanNullish('none')).toBeNull();
    expect(cleanNullish('undefined')).toBeNull();
  });

  it('trims whitespace but preserves meaningful strings', () => {
    expect(cleanNullish('  Roshani  ')).toBe('Roshani');
    expect(cleanNullish('   Khadka Bahadur Karki   ')).toBe('Khadka Bahadur Karki');
  });

  it('returns null for empty / undefined', () => {
    expect(cleanNullish('')).toBeNull();
    expect(cleanNullish(null)).toBeNull();
    expect(cleanNullish(undefined)).toBeNull();
    expect(cleanNullish('   ')).toBeNull();
  });
});

describe('cleanPhone', () => {
  it('treats common placeholders as null', () => {
    expect(cleanPhone('123')).toBeNull();
    expect(cleanPhone('0000000000')).toBeNull();
    expect(cleanPhone('1234567890')).toBeNull();
    expect(cleanPhone('Na')).toBeNull();
    expect(cleanPhone('')).toBeNull();
  });

  it('preserves a real Nepali mobile number', () => {
    expect(cleanPhone('9825851510')).toBe('9825851510');
  });

  it('preserves numbers with country code / spaces', () => {
    expect(cleanPhone('+977 98-25851510')).toBe('+977 98-25851510');
  });
});

describe('splitFullNameLastSpace', () => {
  it('three-token Nepali name: first=two tokens, last=one token', () => {
    expect(splitFullNameLastSpace('Khadka Bahadur Karki')).toEqual({
      first: 'Khadka Bahadur',
      last: 'Karki',
    });
  });

  it('two-token name: first=first, last=last', () => {
    expect(splitFullNameLastSpace('Ram Prasad')).toEqual({
      first: 'Ram',
      last: 'Prasad',
    });
  });

  it('single-token name: first only, last blank', () => {
    expect(splitFullNameLastSpace('Rashmi')).toEqual({
      first: 'Rashmi',
      last: '',
    });
  });

  it('collapses internal whitespace runs', () => {
    expect(splitFullNameLastSpace('  Roshani   Khatun  ')).toEqual({
      first: 'Roshani',
      last: 'Khatun',
    });
  });

  it('empty / nullish → blank both', () => {
    expect(splitFullNameLastSpace('')).toEqual({ first: '', last: '' });
    expect(splitFullNameLastSpace(null)).toEqual({ first: '', last: '' });
    expect(splitFullNameLastSpace('Na')).toEqual({ first: '', last: '' });
  });
});

describe('isValidGradeForArchetype', () => {
  it('PABSON accepts ECD, PPC, and 1-12', () => {
    expect(isValidGradeForArchetype('ECD', 'PABSON')).toBe(true);
    expect(isValidGradeForArchetype('PPC', 'PABSON')).toBe(true);
    expect(isValidGradeForArchetype('1', 'PABSON')).toBe(true);
    expect(isValidGradeForArchetype('12', 'PABSON')).toBe(true);
  });

  it('PABSON rejects PK/K', () => {
    expect(isValidGradeForArchetype('PK', 'PABSON')).toBe(false);
    expect(isValidGradeForArchetype('K', 'PABSON')).toBe(false);
  });

  it('GENERIC rejects PABSON-only ECD/PPC', () => {
    expect(isValidGradeForArchetype('ECD', 'GENERIC')).toBe(false);
    expect(isValidGradeForArchetype('PPC', 'GENERIC')).toBe(false);
  });

  it('GENERIC accepts PK/K/1-12', () => {
    expect(isValidGradeForArchetype('PK', 'GENERIC')).toBe(true);
    expect(isValidGradeForArchetype('K', 'GENERIC')).toBe(true);
    expect(isValidGradeForArchetype('5', 'GENERIC')).toBe(true);
  });

  it('rejects unknown grade codes for any archetype', () => {
    expect(isValidGradeForArchetype('13', 'PABSON')).toBe(false);
    expect(isValidGradeForArchetype('A', 'GENERIC')).toBe(false);
    expect(isValidGradeForArchetype('', 'PABSON')).toBe(false);
  });
});

describe('normalizeName', () => {
  it('title-cases ALL CAPS', () => {
    expect(normalizeName('ROSHANI KHATUN')).toBe('Roshani Khatun');
  });

  it('preserves already-title-case', () => {
    expect(normalizeName('Ram Prasad')).toBe('Ram Prasad');
  });

  it('handles mixed case', () => {
    expect(normalizeName('roSHANI khaTUN')).toBe('Roshani Khatun');
  });

  it('trims whitespace and collapses internal runs', () => {
    expect(normalizeName('  Khadka   Karki  ')).toBe('Khadka Karki');
  });

  it('title-cases hyphenated names correctly', () => {
    expect(normalizeName('Kshireshwar-Nath')).toBe('Kshireshwar-Nath');
  });

  it('returns empty string for nullish', () => {
    expect(normalizeName('Na')).toBe('');
    expect(normalizeName('')).toBe('');
  });
});
