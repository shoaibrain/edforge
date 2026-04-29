/**
 * education-org-descriptors spec — locks the Sprint C1 enum widening.
 *
 * 0.37.0 adds 'EarlyChildhoodDevelopment' and 'PrePrimaryClass' to
 * schoolGradeLevelDescriptorSchema (and to SCHOOL_GRADE_LEVEL_DESCRIPTORS)
 * so the backend's POST /schools accepts the canonical PABSON pre-primary bands.
 */

import {
  schoolGradeLevelDescriptorSchema,
  SCHOOL_GRADE_LEVEL_DESCRIPTORS,
} from './education-org-descriptors';

describe('schoolGradeLevelDescriptorSchema', () => {
  it('accepts the new EarlyChildhoodDevelopment descriptor', () => {
    expect(schoolGradeLevelDescriptorSchema.safeParse('EarlyChildhoodDevelopment').success).toBe(
      true,
    );
  });

  it('accepts the new PrePrimaryClass descriptor', () => {
    expect(schoolGradeLevelDescriptorSchema.safeParse('PrePrimaryClass').success).toBe(true);
  });

  it.each([
    'InfantToddler',
    'Prenursery',
    'Nursery',
    'Prekindergarten',
    'TransitionalKindergarten',
    'Kindergarten',
    'FirstGrade',
    'TwelfthGrade',
    'Postsecondary',
    'Ungraded',
    'Other',
  ])('still accepts existing descriptor %s', (descriptor) => {
    expect(schoolGradeLevelDescriptorSchema.safeParse(descriptor).success).toBe(true);
  });

  it.each([
    'EarlyEducation', // the buggy value the wizard used to send
    'PreKindergarten', // wrong casing
    'preprimaryclass', // wrong casing
    '',
    null,
    42,
  ])('rejects invalid input %s', (input) => {
    expect(schoolGradeLevelDescriptorSchema.safeParse(input).success).toBe(false);
  });
});

describe('SCHOOL_GRADE_LEVEL_DESCRIPTORS catalog', () => {
  const values = SCHOOL_GRADE_LEVEL_DESCRIPTORS.map((d) => d.value);

  it('includes EarlyChildhoodDevelopment with a Ed-Fi-style URI', () => {
    const entry = SCHOOL_GRADE_LEVEL_DESCRIPTORS.find(
      (d) => d.value === 'EarlyChildhoodDevelopment',
    );
    expect(entry).toBeDefined();
    expect(entry?.uri).toContain('GradeLevelDescriptor');
    expect(entry?.uri).toContain('EarlyChildhoodDevelopment');
  });

  it('includes PrePrimaryClass with a Ed-Fi-style URI', () => {
    const entry = SCHOOL_GRADE_LEVEL_DESCRIPTORS.find((d) => d.value === 'PrePrimaryClass');
    expect(entry).toBeDefined();
    expect(entry?.uri).toContain('GradeLevelDescriptor');
    expect(entry?.uri).toContain('PrePrimaryClass');
  });

  it('every catalog entry passes the validator', () => {
    for (const v of values) {
      expect(schoolGradeLevelDescriptorSchema.safeParse(v).success).toBe(true);
    }
  });

  it('catalog values are unique', () => {
    expect(new Set(values).size).toBe(values.length);
  });
});
