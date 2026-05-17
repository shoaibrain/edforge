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
  schoolTypeDescriptorSchema,
  SCHOOL_TYPE_DESCRIPTORS,
} from './education-org-descriptors';
import { createSchoolSchema } from './school.schema';

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

/**
 * Sprint C0.b.4 — locks `schoolTypeDescriptor` as a strict Ed-Fi enum.
 *
 * The schema was already an enum at the shared-types level; this spec
 * gives us regression coverage for the C0.b.4 AC ("Only valid Ed-Fi
 * values accepted") and prevents accidental widening to `z.string()`
 * in a future refactor. The createSchoolSchema check confirms the enum
 * propagates through the higher-level DTO that the controller binds via
 * createZodDto, so a malformed body is rejected at the boundary (400),
 * not at the persistence layer (500 / silent corruption).
 */
describe('schoolTypeDescriptorSchema — C0.b.4', () => {
  const validValues = [
    'Regular',
    'SpecialEducation',
    'CareerAndTechnical',
    'Alternative',
  ] as const;

  it.each(validValues)('accepts canonical Ed-Fi value: %s', (v) => {
    expect(schoolTypeDescriptorSchema.safeParse(v).success).toBe(true);
  });

  it.each([
    'regular',          // case-variant — strict enum, no normalization
    'Magnet',           // a real Ed-Fi flavor we don't model yet
    'invalid',
    '',
    'Regular ',         // trailing space
  ])('rejects non-canonical / invalid value: %s', (v) => {
    expect(schoolTypeDescriptorSchema.safeParse(v).success).toBe(false);
  });

  it('every catalog entry passes the validator (parity with grade-level catalog)', () => {
    for (const entry of SCHOOL_TYPE_DESCRIPTORS) {
      expect(schoolTypeDescriptorSchema.safeParse(entry.value).success).toBe(true);
    }
  });

  it('every catalog entry carries an Ed-Fi-style URI', () => {
    for (const entry of SCHOOL_TYPE_DESCRIPTORS) {
      expect(entry.uri).toMatch(/^uri:\/\/ed-fi\.org\/SchoolTypeDescriptor#/);
    }
  });

  it('catalog values are unique', () => {
    const vs = SCHOOL_TYPE_DESCRIPTORS.map((d) => d.value);
    expect(new Set(vs).size).toBe(vs.length);
  });
});

/**
 * Round-trip the enum through createSchoolSchema (the DTO the controller
 * binds via createZodDto). Proves the descriptor validation is enforced at
 * the request boundary, not just on the standalone schema.
 */
describe('createSchoolSchema — schoolTypeDescriptor validation — C0.b.4', () => {
  // Address omitted intentionally — the US-country refinement requires
  // state + zip, which would be noise for this descriptor-focused spec.
  const baseValidDto = {
    schoolCode: 'TEST',
    name: 'Test School',
    schoolType: 'elementary',
    gradeRange: { start: 'K', end: '5' },
  };

  it('accepts a valid Ed-Fi descriptor on the DTO', () => {
    const r = createSchoolSchema.safeParse({
      ...baseValidDto,
      schoolTypeDescriptor: 'Regular',
    });
    expect(r.success).toBe(true);
  });

  it('rejects an invalid descriptor — 400-shaped error from the DTO boundary', () => {
    const r = createSchoolSchema.safeParse({
      ...baseValidDto,
      schoolTypeDescriptor: 'Magnet', // unknown value
    });
    expect(r.success).toBe(false);
  });

  it('accepts the DTO when schoolTypeDescriptor is omitted (optional field)', () => {
    const r = createSchoolSchema.safeParse(baseValidDto);
    expect(r.success).toBe(true);
  });
});
