/**
 * Sprint 3 — legacy-to-descriptor backfill unit tests.
 */

import {
  deriveDescriptorsFromLegacy,
  enrichStudentWithDerivedDescriptors,
} from './student-descriptor-backfill';

describe('deriveDescriptorsFromLegacy', () => {
  it('derives sexDescriptor from gender', () => {
    expect(deriveDescriptorsFromLegacy({ gender: 'male' })).toEqual({
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Male',
    });
    expect(deriveDescriptorsFromLegacy({ gender: 'female' })).toEqual({
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Female',
    });
  });

  it('derives languageDescriptor from primaryLanguage (incl. misspellings)', () => {
    expect(
      deriveDescriptorsFromLegacy({ primaryLanguage: 'Maithali' }),
    ).toEqual({
      languageDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Maithili',
    });
  });

  it('derives motherTongueDescriptor from homeLanguage', () => {
    expect(
      deriveDescriptorsFromLegacy({ homeLanguage: 'Bhojpuri' }),
    ).toEqual({
      motherTongueDescriptor: 'uri://ed-fi.org/LanguageDescriptor#Bhojpuri',
    });
  });

  it('does NOT overwrite an existing descriptor', () => {
    const existing = 'uri://ed-fi.org/SexDescriptor#Other';
    expect(
      deriveDescriptorsFromLegacy({
        gender: 'male',
        sexDescriptor: existing,
      }),
    ).toEqual({});
  });

  it('returns empty object when legacy value does not resolve', () => {
    expect(
      deriveDescriptorsFromLegacy({ primaryLanguage: 'Klingon' }),
    ).toEqual({});
    expect(
      deriveDescriptorsFromLegacy({ gender: 'prefer_not_to_say' }),
    ).toEqual({});
  });

  it('handles null / undefined / absent fields gracefully', () => {
    expect(deriveDescriptorsFromLegacy({})).toEqual({});
    expect(
      deriveDescriptorsFromLegacy({ gender: null, primaryLanguage: null }),
    ).toEqual({});
  });

  it('does NOT populate ethnicityDescriptor in V1 (Sprint 6 catalog)', () => {
    const result = deriveDescriptorsFromLegacy({ ethnicity: 'Brahmin' });
    expect(result.ethnicityDescriptor).toBeUndefined();
  });
});

describe('enrichStudentWithDerivedDescriptors', () => {
  it('returns a shallow-merged copy, existing fields win', () => {
    const original = {
      studentId: 'abc',
      gender: 'male',
      primaryLanguage: 'Nepali',
      sexDescriptor: 'uri://ed-fi.org/SexDescriptor#Female', // explicitly set
    };
    const enriched = enrichStudentWithDerivedDescriptors(original);
    expect(enriched.studentId).toBe('abc');
    expect(enriched.sexDescriptor).toBe(
      'uri://ed-fi.org/SexDescriptor#Female',
    );
    expect(enriched.languageDescriptor).toBe(
      'uri://ed-fi.org/LanguageDescriptor#Nepali',
    );
  });

  it('is non-destructive on the input', () => {
    const original = { gender: 'male' as const };
    const copyBefore = JSON.stringify(original);
    enrichStudentWithDerivedDescriptors(original);
    expect(JSON.stringify(original)).toBe(copyBefore);
  });
});
