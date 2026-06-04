/**
 * Descriptor-transform unit tests.
 *
 * Sprint A.3 (V1 platform hardening): coverage for the new
 * `schoolGradeToCanonical` transform. Other transforms (sex/ethnicity/etc.)
 * are exercised end-to-end via handler.spec.ts.
 */

import { schoolGradeToCanonical, ethnicityDescriptorToBand } from './transforms';

describe('schoolGradeToCanonical', () => {
  describe('PABSON school-local codes → CEHRD canonical', () => {
    it.each([
      ['PG', 'ECD'],
      ['NUR', 'ECD'],
      ['LKG', 'PPC'],
      ['UKG', 'PPC'],
    ])('maps %s → %s', (input, expected) => {
      expect(schoolGradeToCanonical(input)).toBe(expected);
    });
  });

  describe('canonical short codes pass through', () => {
    it.each([
      ['ECD', 'ECD'],
      ['PPC', 'PPC'],
      ['1', '1'],
      ['5', '5'],
      ['10', '10'],
    ])('%s → %s (identity via codeShort)', (input, expected) => {
      expect(schoolGradeToCanonical(input)).toBe(expected);
    });
  });

  describe('verbose alias forms resolve', () => {
    it.each([
      ['Grade 1', '1'],
      ['Class 1', '1'],
      ['G1', '1'],
      ['Grade 10', '10'],
      ['SEE', '10'],
      ['कक्षा १', '1'],
    ])('%s → %s', (input, expected) => {
      expect(schoolGradeToCanonical(input)).toBe(expected);
    });
  });

  describe('case-insensitive + whitespace-tolerant', () => {
    it.each([
      ['pg', 'ECD'],
      ['lkg', 'PPC'],
      ['  PG  ', 'ECD'],
      ['Grade 5', '5'],
    ])('%j → %s', (input, expected) => {
      expect(schoolGradeToCanonical(input)).toBe(expected);
    });
  });

  describe('intentional non-resolution', () => {
    // Per grade-level-descriptor.ts header: the combined token is ambiguous
    // (54 Saraswati students) and importers must disambiguate before reporting.
    it('returns empty for the lossy "ECD/PPC" literal', () => {
      expect(schoolGradeToCanonical('ECD/PPC')).toBe('');
    });

    it.each([
      ['', ''],
      ['   ', ''],
      ['UNKNOWN_CODE', ''],
    ])('returns empty for %j', (input, expected) => {
      expect(schoolGradeToCanonical(input)).toBe(expected);
    });
  });

  describe('non-string inputs', () => {
    it.each([
      [undefined],
      [null],
      [42],
      [{ gradeLevel: 'PG' }],
      [['PG']],
      [true],
    ])('returns empty for %p', (input) => {
      expect(schoolGradeToCanonical(input)).toBe('');
    });
  });
});

describe('ethnicityDescriptorToBand (GB3.3 — catalog-backed)', () => {
  describe('each CEHRD band resolves from its descriptor URI', () => {
    it.each([
      ['uri://ed-fi.org/EthnicityDescriptor#Brahmin', 'Brahmin/Chhetri'],
      ['uri://ed-fi.org/EthnicityDescriptor#Janajati', 'Janajati'],
      ['uri://ed-fi.org/EthnicityDescriptor#Madheshi', 'Madheshi'],
      ['uri://ed-fi.org/EthnicityDescriptor#Dalit', 'Dalit'],
      ['uri://ed-fi.org/EthnicityDescriptor#Muslim', 'Muslim'],
      ['uri://ed-fi.org/EthnicityDescriptor#Other', 'Other'],
    ])('%p → %p', (uri, band) => {
      expect(ethnicityDescriptorToBand(uri)).toBe(band);
    });
  });

  describe('edforge: namespaced caste tokens route to their band', () => {
    it.each([
      ['edforge:Hill_Brahmin', 'Brahmin/Chhetri'],
      ['edforge:Kami', 'Dalit'],
      ['edforge:Tamang', 'Janajati'],
    ])('%p → %p', (token, band) => {
      expect(ethnicityDescriptorToBand(token)).toBe(band);
    });
  });

  describe('unresolved → empty string (a real signal, never silent Other)', () => {
    it.each([undefined, null, '', 'uri://ed-fi.org/EthnicityDescriptor#NotACaste', 'gibberish'])(
      'returns empty for %p',
      (input) => {
        expect(ethnicityDescriptorToBand(input)).toBe('');
      },
    );
  });
});
