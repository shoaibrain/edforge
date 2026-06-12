/**
 * S1.8 — exam-cycle generator (exam + examCourses + per-subject marks + cards).
 */

import { getArchetypeDefaults } from '@aibrains/shared-types';

import { loadRosterConfig } from './roster-config';
import { generateAcademicFoundation } from './generate-academic-foundation';
import { generateSections } from './generate-sections';
import { generateStaff, teachersOf } from './generate-staff';
import { generateStudents } from './generate-students';
import { generateCoursesAndSections } from './generate-courses';
import { generateExamCycle } from './generate-exams';
import { createRng } from './synthetic-identity';

function build(archetype: 'PABSON' | 'GENERIC') {
  const config = loadRosterConfig(archetype);
  const { academicYear } = generateAcademicFoundation(config);
  const sections = generateSections(config);
  const students = generateStudents(config, createRng(`${archetype}:students`), sections);
  const teachers = teachersOf(
    generateStaff(config, createRng(`${archetype}:staff`), config.academicYear.startDate),
  );
  const { courses } = generateCoursesAndSections(config, sections, teachers);
  const cycle = generateExamCycle(config, createRng(`${archetype}:exam`), academicYear, students, courses);
  return { config, academicYear, students, courses, ...cycle };
}

describe.each(['PABSON', 'GENERIC'] as const)('exam cycle — %s', (archetype) => {
  const { config, academicYear, students, courses, exam, examCourses, marks, resultCards } =
    build(archetype);

  it('is deterministic for a fixed seed', () => {
    const again = generateExamCycle(
      config,
      createRng(`${archetype}:exam`),
      academicYear,
      students,
      courses,
    );
    expect(again).toEqual({ exam, examCourses, marks, resultCards });
  });

  describe('exam', () => {
    it('covers every grade, uses the terminal term + a valid examType', () => {
      expect(exam.gradeCodes).toEqual(config.gradeLevels.map((g) => g.code));
      expect(exam.termRef).toBe(academicYear.terms[academicYear.terms.length - 1].ref);
      expect(getArchetypeDefaults(archetype).examPattern).toContain(exam.examType);
    });
  });

  describe('exam courses (subjects)', () => {
    it('one per course, out of 100 with the archetype pass threshold', () => {
      expect(examCourses).toHaveLength(courses.length);
      const pass = getArchetypeDefaults(archetype).promotionDefaults.passingThresholdPct;
      const courseRefs = new Set(courses.map((c) => c.ref));
      for (const ec of examCourses) {
        expect(ec.maxMarks).toBe(100);
        expect(ec.passingMarks).toBe(pass);
        expect(courseRefs.has(ec.courseRef)).toBe(true);
      }
    });
  });

  describe('marks', () => {
    it('one per (student × their grade subjects), each 0..100', () => {
      const coursesPerGrade = new Map<string, number>();
      for (const c of courses) coursesPerGrade.set(c.gradeCode, (coursesPerGrade.get(c.gradeCode) ?? 0) + 1);
      const expected = students.reduce((s, st) => s + (coursesPerGrade.get(st.gradeCode) ?? 0), 0);
      expect(marks).toHaveLength(expected);
      const examCourseRefs = new Set(examCourses.map((ec) => ec.ref));
      for (const m of marks) {
        expect(m.rawScore).toBeGreaterThanOrEqual(0);
        expect(m.rawScore).toBeLessThanOrEqual(100);
        expect(examCourseRefs.has(m.examCourseRef)).toBe(true);
      }
    });
  });

  describe('result cards', () => {
    it('one per student; total = sum of that student’s subject marks', () => {
      expect(resultCards).toHaveLength(students.length);
      const byStudent = new Map<string, number>();
      for (const m of marks) byStudent.set(m.studentRef, (byStudent.get(m.studentRef) ?? 0) + m.rawScore);
      for (const rc of resultCards) {
        expect(rc.totalMarks).toBe(byStudent.get(rc.studentRef) ?? 0);
        expect(rc.totalMax).toBe(rc.subjectCount * 100);
        expect(rc.percentage).toBeGreaterThanOrEqual(0);
        expect(rc.percentage).toBeLessThanOrEqual(100);
      }
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
