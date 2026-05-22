/**
 * Sprint D.1.2 — `GradeLetter` widening regression specs.
 *
 * Confirms that with `GradeLetter = string` (D.1.2), the Grade entity
 * factory accepts archetype-defined letter values that were previously
 * rejected by the hardcoded US-scale enum:
 *
 *   - `NG` (Nepal CEHRD Not-Graded sentinel; D.4.0 §6.3)
 *   - `A+++` (hypothetical future weighted-honors letter, length-bounded
 *      by the Zod schema's `z.string().min(1).max(5)`)
 *
 * The hard guarantee: any new archetype's letter set lands at runtime via
 * `GradingPolicyEntity.letterGrades[].letter`, not via an entity-file edit.
 */

import { createGradeEntity, Grade } from './grade.entity';

const TENANT = '11111111-1111-1111-1111-111111111111';
const SCHOOL = '22222222-2222-2222-2222-222222222222';
const STUDENT = '33333333-3333-3333-3333-333333333333';
const COURSE = '44444444-4444-4444-4444-444444444444';
const TERM = '55555555-5555-5555-5555-555555555555';
const AY = '66666666-6666-6666-6666-666666666666';
const GRADE_ID = '77777777-7777-7777-7777-777777777777';

function baseGrade(
  letterGrade: string,
  gpaPoints: number,
): Omit<Grade, 'tenantId' | 'entityKey' | 'entityType' | 'gradeId' | 'studentId' | 'schoolId' | 'courseId' | 'termId' | 'academicYearId' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'> {
  return {
    numericGrade: 0,
    letterGrade,
    percentage: 0,
    gpaPoints,
    isPassing: gpaPoints > 0,
    isFinal: true,
    finalizedAt: '2026-05-22T00:00:00.000Z',
    finalizedBy: 'system',
    createdAt: '2026-05-22T00:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-05-22T00:00:00.000Z',
    updatedBy: 'system',
    version: 1,
    assignmentGrades: [],
    categoryBreakdown: [],
    history: [],
  } as unknown as Parameters<typeof createGradeEntity>[7];
}

describe('Sprint D.1.2 — GradeLetter widening', () => {
  it('round-trips NG (Nepal CEHRD Not-Graded sentinel) through createGradeEntity', () => {
    const grade = createGradeEntity(
      TENANT, GRADE_ID, STUDENT, SCHOOL, COURSE, TERM, AY,
      baseGrade('NG', 0),
    );
    expect(grade.letterGrade).toBe('NG');
    expect(grade.gpaPoints).toBe(0);
    expect(grade.isPassing).toBe(false);
  });

  it('round-trips standard US letters (A+ through F)', () => {
    for (const [letter, gpa] of [
      ['A+', 4.0], ['A', 4.0], ['A-', 3.7],
      ['B+', 3.3], ['B', 3.0], ['B-', 2.7],
      ['C', 2.0], ['D', 1.0], ['F', 0],
    ] as [string, number][]) {
      const grade = createGradeEntity(
        TENANT, GRADE_ID, STUDENT, SCHOOL, COURSE, TERM, AY,
        baseGrade(letter, gpa),
      );
      expect(grade.letterGrade).toBe(letter);
    }
  });

  it('round-trips the Nepal CEHRD scale (A+, A, B+, B, C+, C, D+, D, E, NG)', () => {
    const cehrd = [
      ['A+', 4.0], ['A', 3.6], ['B+', 3.2], ['B', 2.8], ['C+', 2.4],
      ['C', 2.0], ['D+', 1.6], ['D', 1.2], ['E', 0.8], ['NG', 0],
    ] as [string, number][];
    for (const [letter, gpa] of cehrd) {
      const grade = createGradeEntity(
        TENANT, GRADE_ID, STUDENT, SCHOOL, COURSE, TERM, AY,
        baseGrade(letter, gpa),
      );
      expect(grade.letterGrade).toBe(letter);
    }
  });

  it('accepts a 5-char letter (`A++++` — the Zod schema max bound)', () => {
    // Demonstrates the upper bound. Zod schema is z.string().min(1).max(5);
    // entity field is string so TS doesn't reject. The actual archetype's
    // policy enumerates the valid letters at the API boundary.
    const grade = createGradeEntity(
      TENANT, GRADE_ID, STUDENT, SCHOOL, COURSE, TERM, AY,
      baseGrade('A++++', 5.0),
    );
    expect(grade.letterGrade).toBe('A++++');
  });
});
