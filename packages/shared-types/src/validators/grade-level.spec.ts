import {
  GRADE_LEVELS,
  GRADE_LEVEL_NAMES,
  ELEMENTARY_GRADES,
  MIDDLE_GRADES,
  HIGH_GRADES,
  getGradeLevelIndex,
  isValidGradeLevel,
  getGradeLevelDisplayName,
  getGradeLevelGroup,
  compareGradeLevels,
  getGradeLevelsInRange,
  isGradeInRange,
  getNextGradeLevel,
  getPreviousGradeLevel,
  gradeLevelEnumSchema,
  gradeLevelRangeValidatorSchema,
} from './grade-level';

// =============================================================================
// REGRESSION GUARD — F-LEGACY-1
// =============================================================================
//
// Before this fix, GRADE_LEVELS held only PK/K/1-12 (14 entries). When called
// with a Nepal-shape range like getGradeLevelsInRange('ECD', '12'), the
// function returned ['12'] (single entry) because:
//   indexOf('ECD') => -1
//   indexOf('12')  => 13
//   slice(-1, 14)  => ['12']  (negative start = "from end")
//
// The bug propagated through useFilteredGradeOptions in
// edforge-saas-frontend/apps/academics to 6 form components, breaking grade
// selection for every PABSON primary school. The regression tests below pin
// the fix in place: GRADE_LEVELS must include ECD + PPC, and the slice math
// must work for ECD-starting ranges.
// =============================================================================

describe('GRADE_LEVELS canonical set', () => {
  it('includes the 16 ECD-through-12 codes in order', () => {
    expect([...GRADE_LEVELS]).toEqual([
      'ECD', 'PPC', 'PK', 'K',
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
    ]);
  });

  it('places ECD at index 0 and PPC at index 1 (PABSON pre-school bands)', () => {
    expect(getGradeLevelIndex('ECD')).toBe(0);
    expect(getGradeLevelIndex('PPC')).toBe(1);
  });

  it('preserves PK at index 2 and 12 at index 15', () => {
    expect(getGradeLevelIndex('PK')).toBe(2);
    expect(getGradeLevelIndex('12')).toBe(15);
  });
});

describe('isValidGradeLevel', () => {
  it('accepts ECD and PPC (Nepal pre-school bands)', () => {
    expect(isValidGradeLevel('ECD')).toBe(true);
    expect(isValidGradeLevel('PPC')).toBe(true);
  });

  it('accepts PK through 12 (existing US-K-12 behavior preserved)', () => {
    expect(isValidGradeLevel('PK')).toBe(true);
    expect(isValidGradeLevel('K')).toBe(true);
    expect(isValidGradeLevel('1')).toBe(true);
    expect(isValidGradeLevel('12')).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(isValidGradeLevel('Nursery')).toBe(false);
    expect(isValidGradeLevel('13')).toBe(false);
    expect(isValidGradeLevel('')).toBe(false);
    expect(isValidGradeLevel('ECD/PPC')).toBe(false);
  });
});

describe('getGradeLevelsInRange — F-LEGACY-1 regression matrix', () => {
  it('returns all 16 codes for the full PABSON-K12 range (ECD → 12)', () => {
    expect(getGradeLevelsInRange('ECD', '12')).toEqual([
      'ECD', 'PPC', 'PK', 'K',
      '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
    ]);
  });

  it('returns ECD + PPC for the pre-school-only range (ECD → PPC)', () => {
    expect(getGradeLevelsInRange('ECD', 'PPC')).toEqual(['ECD', 'PPC']);
  });

  it('returns single ECD for the degenerate (ECD → ECD) range', () => {
    expect(getGradeLevelsInRange('ECD', 'ECD')).toEqual(['ECD']);
  });

  it('returns 8 codes for PABSON primary range (PPC → 5)', () => {
    expect(getGradeLevelsInRange('PPC', '5')).toEqual([
      'PPC', 'PK', 'K', '1', '2', '3', '4', '5',
    ]);
  });

  it('returns 14 codes for the legacy US K-12 range (PK → 12) — preserves prior behavior', () => {
    expect(getGradeLevelsInRange('PK', '12')).toEqual([
      'PK', 'K', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12',
    ]);
  });

  it('returns 5 codes for secondary-only range (6 → 10) — School B negative-test shape', () => {
    expect(getGradeLevelsInRange('6', '10')).toEqual(['6', '7', '8', '9', '10']);
  });

  it('returns single 12 for (12 → 12)', () => {
    expect(getGradeLevelsInRange('12', '12')).toEqual(['12']);
  });

  it('returns empty array when start > end (12 → ECD)', () => {
    expect(getGradeLevelsInRange('12', 'ECD')).toEqual([]);
  });

  it('returns single K for (K → K)', () => {
    expect(getGradeLevelsInRange('K', 'K')).toEqual(['K']);
  });
});

describe('isGradeInRange', () => {
  it('returns true for ECD inside an ECD-having range', () => {
    expect(isGradeInRange('ECD', { start: 'ECD', end: '12' })).toBe(true);
    expect(isGradeInRange('ECD', { start: 'ECD', end: 'PPC' })).toBe(true);
  });

  it('returns false for ECD outside a numeric-only range', () => {
    expect(isGradeInRange('ECD', { start: '1', end: '12' })).toBe(false);
    expect(isGradeInRange('ECD', { start: '6', end: '10' })).toBe(false);
  });

  it('returns true for boundary inclusion (start and end edges)', () => {
    expect(isGradeInRange('1', { start: '1', end: '5' })).toBe(true);
    expect(isGradeInRange('5', { start: '1', end: '5' })).toBe(true);
  });
});

describe('compareGradeLevels', () => {
  it('orders ECD before PPC before PK before K before numeric grades', () => {
    expect(compareGradeLevels('ECD', 'PPC')).toBeLessThan(0);
    expect(compareGradeLevels('PPC', 'PK')).toBeLessThan(0);
    expect(compareGradeLevels('PK', 'K')).toBeLessThan(0);
    expect(compareGradeLevels('K', '1')).toBeLessThan(0);
  });

  it('returns 0 for equal grades', () => {
    expect(compareGradeLevels('ECD', 'ECD')).toBe(0);
    expect(compareGradeLevels('5', '5')).toBe(0);
  });

  it('handles the full ECD-to-12 ordering', () => {
    expect(compareGradeLevels('ECD', '12')).toBeLessThan(0);
    expect(compareGradeLevels('12', 'ECD')).toBeGreaterThan(0);
  });
});

describe('getNextGradeLevel / getPreviousGradeLevel', () => {
  it('next(ECD) is PPC; prev(PPC) is ECD', () => {
    expect(getNextGradeLevel('ECD')).toBe('PPC');
    expect(getPreviousGradeLevel('PPC')).toBe('ECD');
  });

  it('prev(ECD) is null (start of sequence)', () => {
    expect(getPreviousGradeLevel('ECD')).toBeNull();
  });

  it('next(12) is null (end of sequence)', () => {
    expect(getNextGradeLevel('12')).toBeNull();
  });

  it('next(K) is 1, prev(1) is K — boundary at K↔numeric', () => {
    expect(getNextGradeLevel('K')).toBe('1');
    expect(getPreviousGradeLevel('1')).toBe('K');
  });
});

describe('GRADE_LEVEL_NAMES + getGradeLevelDisplayName', () => {
  it('has display names for ECD and PPC', () => {
    expect(GRADE_LEVEL_NAMES['ECD']).toBe('Early Childhood Development');
    expect(GRADE_LEVEL_NAMES['PPC']).toBe('Pre-Primary Class');
  });

  it('preserves existing US K-12 display names', () => {
    expect(GRADE_LEVEL_NAMES['PK']).toBe('Pre-Kindergarten');
    expect(GRADE_LEVEL_NAMES['K']).toBe('Kindergarten');
    expect(GRADE_LEVEL_NAMES['1']).toBe('1st Grade');
    expect(GRADE_LEVEL_NAMES['12']).toBe('12th Grade (Senior)');
  });

  it('getGradeLevelDisplayName routes through the names map', () => {
    expect(getGradeLevelDisplayName('ECD')).toBe('Early Childhood Development');
    expect(getGradeLevelDisplayName('5')).toBe('5th Grade');
  });
});

describe('Grade level groups', () => {
  it('includes ECD and PPC in ELEMENTARY_GRADES (pre-school grouped with elementary)', () => {
    expect(ELEMENTARY_GRADES).toContain('ECD');
    expect(ELEMENTARY_GRADES).toContain('PPC');
  });

  it('keeps existing elementary / middle / high partitions', () => {
    expect(ELEMENTARY_GRADES).toContain('PK');
    expect(ELEMENTARY_GRADES).toContain('5');
    expect(MIDDLE_GRADES).toEqual(['6', '7', '8']);
    expect(HIGH_GRADES).toEqual(['9', '10', '11', '12']);
  });

  it('getGradeLevelGroup returns elementary for ECD/PPC', () => {
    expect(getGradeLevelGroup('ECD')).toBe('elementary');
    expect(getGradeLevelGroup('PPC')).toBe('elementary');
  });

  it('preserves group classification for existing K-12 grades', () => {
    expect(getGradeLevelGroup('K')).toBe('elementary');
    expect(getGradeLevelGroup('5')).toBe('elementary');
    expect(getGradeLevelGroup('7')).toBe('middle');
    expect(getGradeLevelGroup('11')).toBe('high');
  });
});

describe('Zod schemas', () => {
  it('gradeLevelEnumSchema accepts ECD/PPC + all canonical codes', () => {
    expect(() => gradeLevelEnumSchema.parse('ECD')).not.toThrow();
    expect(() => gradeLevelEnumSchema.parse('PPC')).not.toThrow();
    expect(() => gradeLevelEnumSchema.parse('PK')).not.toThrow();
    expect(() => gradeLevelEnumSchema.parse('1')).not.toThrow();
    expect(() => gradeLevelEnumSchema.parse('12')).not.toThrow();
  });

  it('gradeLevelEnumSchema rejects non-canonical values', () => {
    expect(() => gradeLevelEnumSchema.parse('Nursery')).toThrow();
    expect(() => gradeLevelEnumSchema.parse('13')).toThrow();
    expect(() => gradeLevelEnumSchema.parse('')).toThrow();
  });

  it('gradeLevelRangeValidatorSchema accepts a PABSON full range', () => {
    expect(() =>
      gradeLevelRangeValidatorSchema.parse({ start: 'ECD', end: '12' })
    ).not.toThrow();
  });

  it('gradeLevelRangeValidatorSchema rejects start > end', () => {
    expect(() =>
      gradeLevelRangeValidatorSchema.parse({ start: '12', end: 'ECD' })
    ).toThrow();
  });
});
