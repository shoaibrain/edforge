/**
 * Subject-Area Mapper spec — Sprint A.2.3
 *
 * Coverage:
 *   - Every AcademicSubjectDescriptor maps to a valid SubjectArea
 *   - Mapping table covers all 15 descriptor values (no orphans)
 *   - Specific mappings match the documented rationale
 *   - Function is pure (same input → same output, no side effects)
 */

import {
  ACADEMIC_SUBJECT_DESCRIPTORS,
  type AcademicSubjectDescriptor,
} from '@aibrains/shared-types';
import {
  ACADEMIC_SUBJECT_TO_SUBJECT_AREA,
  deriveSubjectAreaFromAcademicSubject,
} from './subject-area-mapper';

describe('Subject-Area Mapper (A.2.3)', () => {
  it('mapping table covers all 15 AcademicSubjectDescriptor values', () => {
    for (const descriptor of ACADEMIC_SUBJECT_DESCRIPTORS) {
      expect(ACADEMIC_SUBJECT_TO_SUBJECT_AREA[descriptor]).toBeDefined();
    }
    expect(Object.keys(ACADEMIC_SUBJECT_TO_SUBJECT_AREA)).toHaveLength(15);
  });

  describe('deriveSubjectAreaFromAcademicSubject — documented mappings', () => {
    const cases: Array<[AcademicSubjectDescriptor, string]> = [
      // Direct passthroughs (Ed-Fi V6 names match)
      ['mathematics', 'mathematics'],
      ['science', 'science'],
      ['social_studies', 'social_studies'],
      // English → Ed-Fi V6 'english_language_arts' rollup
      ['english', 'english_language_arts'],
      // Non-English languages → Ed-Fi V6 'world_languages' rollup
      ['nepali', 'world_languages'],
      // Health-adjacent → Ed-Fi V6 'physical_education' rollup
      ['environment_population_health', 'physical_education'],
      ['health_physical_creative_arts', 'physical_education'],
      // No curriculum-neutral parent → 'other'
      ['local_subject', 'other'],
      // Optionals roll up to parent discipline
      ['optional_mathematics', 'mathematics'],
      ['optional_computer_science', 'technology'],
      ['optional_economics', 'business'],
      // Commerce-stream
      ['accounting', 'business'],
      // Individual sciences roll up to 'science'
      ['physics', 'science'],
      ['chemistry', 'science'],
      ['biology', 'science'],
    ];

    it.each(cases)('%s → %s', (descriptor, expected) => {
      expect(deriveSubjectAreaFromAcademicSubject(descriptor)).toBe(expected);
    });
  });

  it('function is pure (idempotent on repeat invocation)', () => {
    const result1 = deriveSubjectAreaFromAcademicSubject('mathematics');
    const result2 = deriveSubjectAreaFromAcademicSubject('mathematics');
    const result3 = deriveSubjectAreaFromAcademicSubject('mathematics');
    expect(result1).toBe(result2);
    expect(result2).toBe(result3);
  });

  it('never returns undefined for a valid descriptor', () => {
    for (const descriptor of ACADEMIC_SUBJECT_DESCRIPTORS) {
      const result = deriveSubjectAreaFromAcademicSubject(descriptor);
      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    }
  });
});
