/**
 * GB3.1 — EthnicityDescriptor catalog tests.
 *
 * Asserts the catalog is registered, validates against the catalog schema, the
 * 6 CEHRD bands resolve, real-world Nepal caste aliases route to their band,
 * and unmapped input returns null (→ blank + warning at the boundary, never a
 * silent misclassification).
 */

import { describe, it, expect } from '@jest/globals';
import {
  DESCRIPTOR_CATALOGS,
  validateCatalog,
  resolveDescriptor,
  resolveDescriptorEntry,
  getDisplayName,
} from './index';
import { ETHNICITY_DESCRIPTOR_CATALOG } from './ethnicity-descriptor';

describe('EthnicityDescriptor catalog (GB3.1)', () => {
  it('is registered in the catalog registry', () => {
    expect(DESCRIPTOR_CATALOGS.EthnicityDescriptor).toBe(ETHNICITY_DESCRIPTOR_CATALOG);
  });

  it('passes descriptorCatalogSchema validation (no dup codes/uris/aliases, valid URIs)', () => {
    expect(() => validateCatalog(ETHNICITY_DESCRIPTOR_CATALOG)).not.toThrow();
  });

  it('carries exactly the 6 CEHRD bands', () => {
    const bands = ETHNICITY_DESCRIPTOR_CATALOG.entries.map((e) => e.displayName.en).sort();
    expect(bands).toEqual(
      ['Brahmin/Chhetri', 'Dalit', 'Janajati', 'Madheshi', 'Muslim', 'Other'].sort(),
    );
  });

  it('every entry ships an ne-NP display name (PABSON pilot locale)', () => {
    for (const e of ETHNICITY_DESCRIPTOR_CATALOG.entries) {
      expect(e.displayName['ne-NP']).toBeTruthy();
    }
  });

  it('resolves each band by its code', () => {
    expect(resolveDescriptor('EthnicityDescriptor', 'Brahmin')).toBe(
      'uri://ed-fi.org/EthnicityDescriptor#Brahmin',
    );
    expect(resolveDescriptor('EthnicityDescriptor', 'Dalit')).toBe(
      'uri://ed-fi.org/EthnicityDescriptor#Dalit',
    );
  });

  it('routes Nepal caste aliases into their band (case-insensitive)', () => {
    const band = (input: string) =>
      resolveDescriptorEntry('EthnicityDescriptor', input)?.displayName.en;
    expect(band('Hill_Brahmin')).toBe('Brahmin/Chhetri');
    expect(band('chhetri')).toBe('Brahmin/Chhetri');
    expect(band('Kami')).toBe('Dalit');
    expect(band('Tamang')).toBe('Janajati');
    expect(band('Yadav')).toBe('Madheshi');
    expect(band('Musalman')).toBe('Muslim');
    expect(band('Others')).toBe('Other');
  });

  it('returns null for unmapped input (never a silent misclassification)', () => {
    expect(resolveDescriptor('EthnicityDescriptor', 'NotACaste123')).toBeNull();
    expect(resolveDescriptor('EthnicityDescriptor', '')).toBeNull();
  });

  it('getDisplayName falls back to ne-NP for the pilot locale', () => {
    expect(getDisplayName('uri://ed-fi.org/EthnicityDescriptor#Dalit', 'ne-NP')).toBe('दलित');
  });
});
