/**
 * PABSON_COURSE_CATALOG seed-shape spec — Sprint A.2.4
 *
 * Coverage:
 *   - Catalog is 21 templates (matches sprint-plan §4)
 *   - Every template has a unique `code`
 *   - All `academicSubject` values pass the descriptor enum
 *   - All `curriculumRef` values pass the curriculum-ref enum
 *   - Every grade 4-10 has ≥6 compulsory courses
 *   - All templates have `curriculumRef: 'CDC_NCF_2076'` (V1 invariant)
 *   - `stateSubjectCode` left undefined for V1 (best-guess scope)
 */

import {
  PABSON_COURSE_CATALOG,
  type PabsonCourseTemplate,
} from './pabson-courses';
import { academicSubjectSchema } from '../descriptors/academic-subject';
import { curriculumRefSchema } from '../schemas/archetype-defaults.schema';

describe('PABSON_COURSE_CATALOG (A.2.4)', () => {
  it('contains exactly 21 templates (Grades 4-10 best-guess scope)', () => {
    expect(PABSON_COURSE_CATALOG).toHaveLength(21);
  });

  it('every template has a unique `code`', () => {
    const codes = PABSON_COURSE_CATALOG.map((t) => t.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('every template `code` follows the NCF-<SUBJ>-G<band> naming convention', () => {
    for (const template of PABSON_COURSE_CATALOG) {
      expect(template.code).toMatch(/^NCF-[A-Z]+-G(45|68|910)$/);
    }
  });

  it('every template `academicSubject` is a valid AcademicSubjectDescriptor', () => {
    for (const template of PABSON_COURSE_CATALOG) {
      expect(academicSubjectSchema.safeParse(template.academicSubject).success).toBe(true);
    }
  });

  it('every template has `curriculumRef: CDC_NCF_2076` (V1 PABSON-only invariant)', () => {
    for (const template of PABSON_COURSE_CATALOG) {
      expect(template.curriculumRef).toBe('CDC_NCF_2076');
      expect(curriculumRefSchema.safeParse(template.curriculumRef).success).toBe(true);
    }
  });

  it('every grade 4-10 has at least 6 compulsory courses', () => {
    const grades = ['4', '5', '6', '7', '8', '9', '10'];
    for (const grade of grades) {
      const compulsoryForGrade = PABSON_COURSE_CATALOG.filter(
        (t) => t.isCompulsory && t.gradeLevels.includes(grade),
      );
      expect(compulsoryForGrade.length).toBeGreaterThanOrEqual(6);
    }
  });

  it('`stateSubjectCode` is undefined on every template (V1 best-guess scope)', () => {
    for (const template of PABSON_COURSE_CATALOG) {
      expect(template.stateSubjectCode).toBeUndefined();
    }
  });

  it('Grades 1-3 are NOT seeded (V1.5 deferred per CDC integrated/thematic curriculum)', () => {
    for (const template of PABSON_COURSE_CATALOG) {
      expect(template.gradeLevels).not.toContain('1');
      expect(template.gradeLevels).not.toContain('2');
      expect(template.gradeLevels).not.toContain('3');
    }
  });

  it('Grades 11-12 are NOT seeded (Sprint D.6 / V1.5 NEB scope)', () => {
    for (const template of PABSON_COURSE_CATALOG) {
      expect(template.gradeLevels).not.toContain('11');
      expect(template.gradeLevels).not.toContain('12');
    }
  });

  it('Grade-band coverage matches sprint plan: 6 / 7 / 8 templates per band', () => {
    const g45 = PABSON_COURSE_CATALOG.filter((t) => t.gradeLevels.includes('4'));
    const g68 = PABSON_COURSE_CATALOG.filter((t) => t.gradeLevels.includes('6'));
    const g910 = PABSON_COURSE_CATALOG.filter((t) => t.gradeLevels.includes('9'));
    expect(g45).toHaveLength(6);
    expect(g68).toHaveLength(7);
    expect(g910).toHaveLength(8);
  });

  it('every optional course has `isCore: false` (consistency check)', () => {
    const optionalCourses = PABSON_COURSE_CATALOG.filter((t) => !t.isCompulsory);
    expect(optionalCourses.length).toBeGreaterThan(0);
    for (const t of optionalCourses) {
      expect(t.isCore).toBe(false);
    }
  });

  it('Optional Computer Science appears in both G6-8 and G9-10 bands (research §1.2)', () => {
    const ocs = PABSON_COURSE_CATALOG.filter(
      (t) => t.academicSubject === 'optional_computer_science',
    );
    expect(ocs).toHaveLength(2);
  });

  it('Optional Mathematics appears only in G9-10 (SEE-prep optional)', () => {
    const opMath = PABSON_COURSE_CATALOG.filter(
      (t) => t.academicSubject === 'optional_mathematics',
    );
    expect(opMath).toHaveLength(1);
    expect(opMath[0].gradeLevels).toEqual(['9', '10']);
  });

  it('PabsonCourseTemplate shape is exported and type-correct', () => {
    const probe: PabsonCourseTemplate = PABSON_COURSE_CATALOG[0];
    expect(typeof probe.code).toBe('string');
    expect(typeof probe.name).toBe('string');
    expect(Array.isArray(probe.gradeLevels)).toBe(true);
    expect(typeof probe.academicSubject).toBe('string');
    expect(typeof probe.curriculumRef).toBe('string');
    expect(typeof probe.isCompulsory).toBe('boolean');
    expect(typeof probe.isCore).toBe('boolean');
  });
});
