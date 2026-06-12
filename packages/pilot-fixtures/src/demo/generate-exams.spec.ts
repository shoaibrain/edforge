/**
 * S1.8 — exam-cycle generator (exam + marks + result cards).
 */

import { getArchetypeDefaults } from '@aibrains/shared-types';

import { loadRosterConfig } from './roster-config';
import { generateAcademicFoundation } from './generate-academic-foundation';
import { generateSections } from './generate-sections';
import { generateStudents } from './generate-students';
import { generateExamCycle } from './generate-exams';
import { createRng } from './synthetic-identity';

function build(archetype: 'PABSON' | 'GENERIC') {
  const config = loadRosterConfig(archetype);
  const { academicYear } = generateAcademicFoundation(config);
  const sections = generateSections(config);
  const students = generateStudents(config, createRng(`${archetype}:students`), sections);
  const cycle = generateExamCycle(config, createRng(`${archetype}:exam`), academicYear, students);
  return { config, academicYear, students, ...cycle };
}

describe.each(['PABSON', 'GENERIC'] as const)('exam cycle — %s', (archetype) => {
  const { config, academicYear, students, exam, marks, resultCards } = build(archetype);

  it('is deterministic for a fixed seed', () => {
    const again = generateExamCycle(
      config,
      createRng(`${archetype}:exam`),
      academicYear,
      students,
    );
    expect(again).toEqual({ exam, marks, resultCards });
  });

  describe('exam', () => {
    it('covers every grade and uses the terminal term + a valid examType', () => {
      expect(exam.gradeCodes).toEqual(config.gradeLevels.map((g) => g.code));
      expect(exam.termRef).toBe(academicYear.terms[academicYear.terms.length - 1].ref);
      expect(getArchetypeDefaults(archetype).examPattern).toContain(exam.examType);
    });

    it('components carry the config weights and total 100 marks', () => {
      expect(exam.components.map((c) => c.weightPct)).toEqual(
        config.examCycle.components.map((c) => c.weightPct),
      );
      expect(exam.components.reduce((s, c) => s + c.maxMarks, 0)).toBe(100);
    });
  });

  describe('marks', () => {
    it('records one mark per (student × component), each within range', () => {
      expect(marks).toHaveLength(students.length * exam.components.length);
      const maxByComp = new Map(exam.components.map((c) => [c.name, c.maxMarks]));
      for (const m of marks) {
        expect(m.marksObtained).toBeGreaterThanOrEqual(0);
        expect(m.marksObtained).toBeLessThanOrEqual(maxByComp.get(m.componentName)!);
      }
    });
  });

  describe('result cards', () => {
    it('one per student, percentage 0..100', () => {
      expect(resultCards).toHaveLength(students.length);
      for (const rc of resultCards) {
        expect(rc.percentage).toBeGreaterThanOrEqual(0);
        expect(rc.percentage).toBeLessThanOrEqual(100);
      }
    });

    it('total marks equal the sum of the student’s component marks', () => {
      const byStudent = new Map<string, number>();
      for (const m of marks) byStudent.set(m.studentRef, (byStudent.get(m.studentRef) ?? 0) + m.marksObtained);
      for (const rc of resultCards) expect(rc.totalMarks).toBe(byStudent.get(rc.studentRef));
    });

    it('GPA + letter grade match the archetype canonical scale', () => {
      const bands = getArchetypeDefaults(archetype).letterGrades;
      const gpaScale = getArchetypeDefaults(archetype).gpaScale;
      for (const rc of resultCards) {
        expect(rc.gpaPoints).toBeGreaterThanOrEqual(0);
        expect(rc.gpaPoints).toBeLessThanOrEqual(gpaScale);
        const band = bands.find(
          (b) => !b.isTerminalFail && rc.percentage >= b.minPct && rc.percentage <= b.maxPct,
        );
        expect(band).toBeDefined();
        expect(rc.letterGrade).toBe(band!.letter);
        expect(rc.gpaPoints).toBe(band!.gpaPoints);
        expect(rc.isPassing).toBe(band!.isPassing);
      }
    });

    it('mark distribution is non-degenerate (varied percentages, plausible pass rate)', () => {
      const distinct = new Set(resultCards.map((rc) => rc.percentage));
      expect(distinct.size).toBeGreaterThan(20);
      const passRate = resultCards.filter((rc) => rc.isPassing).length / resultCards.length;
      expect(passRate).toBeGreaterThan(0.2);
      expect(passRate).toBeLessThanOrEqual(1);
    });
  });
});
