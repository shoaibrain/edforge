import {
  FIELD_MUTABILITY,
  isFieldLocked,
  classifyUpdateFields,
  getFieldMutability,
} from './field-governance';

describe('FIELD_MUTABILITY.immutable — tenantTag', () => {
  it('lists tenantTag as immutable', () => {
    expect(FIELD_MUTABILITY.immutable).toContain('tenantTag');
  });

  it('keeps the existing immutable entries (regression guard)', () => {
    // If this fails, someone widened or trimmed the immutable list — review
    // before merging. These four are load-bearing for tenant + school
    // identity contracts.
    expect([...FIELD_MUTABILITY.immutable].sort()).toEqual([
      'archetype',
      'emisSchoolCode',
      'schoolCode',
      'tenantTag',
    ]);
  });
});

describe('isFieldLocked — tenantTag', () => {
  it('returns true regardless of academic year state (immutable)', () => {
    expect(isFieldLocked('tenantTag', false)).toBe(true);
    expect(isFieldLocked('tenantTag', true)).toBe(true);
  });
});

describe('classifyUpdateFields — tenantTag', () => {
  it('classifies tenantTag as immutable when present in payload', () => {
    const r = classifyUpdateFields({ tenantTag: 'internal-dev', name: 'X' });
    expect(r.immutable).toContain('tenantTag');
    expect(r.editable).toContain('name');
  });

  it('skips tenantTag when value is undefined (PATCH-style omission)', () => {
    const r = classifyUpdateFields({ tenantTag: undefined, name: 'X' });
    expect(r.immutable).not.toContain('tenantTag');
  });
});

describe('getFieldMutability — tenantTag', () => {
  it('returns "immutable"', () => {
    expect(getFieldMutability('tenantTag')).toBe('immutable');
  });
});
