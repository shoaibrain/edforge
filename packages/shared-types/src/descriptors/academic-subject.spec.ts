/**
 * AcademicSubjectDescriptor spec — Sprint A.2.1
 *
 * Coverage:
 *   - Enum value list matches master plan §0.3 (15 values, exact set + order
 *     irrelevant for set comparison)
 *   - Schema accepts every canonical value
 *   - Schema rejects unknown values (4xx-grade input)
 *   - TS type narrows to the union
 */

import {
  academicSubjectSchema,
  ACADEMIC_SUBJECT_DESCRIPTORS,
  type AcademicSubjectDescriptor,
} from './academic-subject';

describe('AcademicSubjectDescriptor (A.2.1)', () => {
  const EXPECTED_VALUES = [
    'mathematics',
    'science',
    'english',
    'nepali',
    'social_studies',
    'environment_population_health',
    'health_physical_creative_arts',
    'local_subject',
    'optional_mathematics',
    'optional_computer_science',
    'optional_economics',
    'accounting',
    'physics',
    'chemistry',
    'biology',
  ];

  it('exports exactly the 15 values from master plan §0.3', () => {
    expect(new Set(ACADEMIC_SUBJECT_DESCRIPTORS)).toEqual(new Set(EXPECTED_VALUES));
    expect(ACADEMIC_SUBJECT_DESCRIPTORS).toHaveLength(15);
  });

  it.each(EXPECTED_VALUES)('accepts canonical value %s', (value) => {
    expect(academicSubjectSchema.safeParse(value).success).toBe(true);
  });

  it('rejects unknown values', () => {
    expect(academicSubjectSchema.safeParse('astrology').success).toBe(false);
    expect(academicSubjectSchema.safeParse('Mathematics').success).toBe(false); // case-sensitive
    expect(academicSubjectSchema.safeParse('').success).toBe(false);
    expect(academicSubjectSchema.safeParse(null).success).toBe(false);
    expect(academicSubjectSchema.safeParse(undefined).success).toBe(false);
  });

  it('TS type narrows to the union', () => {
    const valid: AcademicSubjectDescriptor = 'mathematics';
    expect(valid).toBe('mathematics');
    // @ts-expect-error — 'astrology' is not a valid AcademicSubjectDescriptor
    const invalid: AcademicSubjectDescriptor = 'astrology';
    expect(invalid).toBe('astrology'); // runtime still holds the string
  });

  it('Nepal-archetype subjects are present (Ed-Fi V6 strict does NOT enumerate these)', () => {
    expect(ACADEMIC_SUBJECT_DESCRIPTORS).toContain('nepali');
    expect(ACADEMIC_SUBJECT_DESCRIPTORS).toContain('environment_population_health');
    expect(ACADEMIC_SUBJECT_DESCRIPTORS).toContain('health_physical_creative_arts');
    expect(ACADEMIC_SUBJECT_DESCRIPTORS).toContain('optional_mathematics');
    expect(ACADEMIC_SUBJECT_DESCRIPTORS).toContain('local_subject');
  });

  it('Grade 11-12 NEB-stream science subjects are individually listed', () => {
    expect(ACADEMIC_SUBJECT_DESCRIPTORS).toContain('physics');
    expect(ACADEMIC_SUBJECT_DESCRIPTORS).toContain('chemistry');
    expect(ACADEMIC_SUBJECT_DESCRIPTORS).toContain('biology');
  });
});
