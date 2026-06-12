/**
 * Exam-cycle generator — Sprint S1.8 (per-subject, Ed-Fi aligned).
 *
 * One terminal exam covering every grade. Each course becomes an ExamCourse
 * (the examined subject, out of 100, with an archetype pass threshold). Every
 * enrolled student gets a per-subject rawScore, and the result card aggregates
 * their subjects via the archetype's canonical letterGrades scale. Result
 * cards are auto-generated server-side when the exam closes, so the cards here
 * are the expected verification values.
 */

import { getArchetypeDefaults } from '@aibrains/shared-types';

import type { DemoRosterConfig } from './roster-config';
import type {
  DemoAcademicYear,
  DemoCourse,
  DemoExam,
  DemoExamCourse,
  DemoMark,
  DemoResultCard,
  DemoStudent,
} from './generated-types';
import type { Rng } from './synthetic-identity';

const SUBJECT_MAX_MARKS = 100;

export interface ExamCycle {
  exam: DemoExam;
  examCourses: DemoExamCourse[];
  marks: DemoMark[];
  resultCards: DemoResultCard[];
}

interface LetterBand {
  letter: string;
  minPct: number;
  maxPct: number;
  gpaPoints: number;
  isPassing: boolean;
  isTerminalFail?: boolean;
}

function bandForPercentage(bands: LetterBand[], pct: number): LetterBand {
  for (const b of bands) {
    if (b.isTerminalFail) continue;
    if (pct >= b.minPct && pct <= b.maxPct) return b;
  }
  return bands[bands.length - 1];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function generateExamCycle(
  config: DemoRosterConfig,
  rng: Rng,
  academicYear: DemoAcademicYear,
  students: DemoStudent[],
  courses: DemoCourse[],
): ExamCycle {
  const defaults = getArchetypeDefaults(config.archetype);
  const passingMarks = defaults.promotionDefaults.passingThresholdPct;
  const bands = defaults.letterGrades as LetterBand[];
  const terminalTerm = academicYear.terms[academicYear.terms.length - 1];

  const exam: DemoExam = {
    ref: 'exam:0',
    examName: config.examCycle.name,
    examType: config.examCycle.examType,
    gradeCodes: config.gradeLevels.map((g) => g.code),
    termRef: terminalTerm.ref,
    startDate: terminalTerm.examStartDate,
    endDate: terminalTerm.examEndDate,
  };

  // One ExamCourse per course (subject).
  const examCourses: DemoExamCourse[] = courses.map((c) => ({
    ref: `examcourse:${c.ref}`,
    examRef: exam.ref,
    courseRef: c.ref,
    gradeCode: c.gradeCode,
    maxMarks: SUBJECT_MAX_MARKS,
    passingMarks,
  }));
  const examCoursesByGrade = new Map<string, DemoExamCourse[]>();
  for (const ec of examCourses) {
    const list = examCoursesByGrade.get(ec.gradeCode) ?? [];
    list.push(ec);
    examCoursesByGrade.set(ec.gradeCode, list);
  }

  const marks: DemoMark[] = [];
  const resultCards: DemoResultCard[] = [];

  for (const student of students) {
    const subjects = examCoursesByGrade.get(student.gradeCode) ?? [];
    // Per-student baseline ability, varied so the cohort isn't degenerate.
    const ability = rng.int(30, 96);
    let total = 0;
    for (const ec of subjects) {
      const rawScore = clamp(ability + rng.int(-8, 8), 0, SUBJECT_MAX_MARKS);
      total += rawScore;
      marks.push({
        ref: `mark:${student.ref}:${ec.ref}`,
        studentRef: student.ref,
        examCourseRef: ec.ref,
        rawScore,
        maxMarks: SUBJECT_MAX_MARKS,
      });
    }
    const totalMax = subjects.length * SUBJECT_MAX_MARKS;
    const percentage = totalMax > 0 ? Math.round((total / totalMax) * 10000) / 100 : 0;
    const band = bandForPercentage(bands, percentage);
    resultCards.push({
      ref: `resultcard:${student.ref}`,
      studentRef: student.ref,
      examRef: exam.ref,
      gradeCode: student.gradeCode,
      subjectCount: subjects.length,
      totalMarks: total,
      totalMax,
      percentage,
      letterGrade: band.letter,
      gpaPoints: band.gpaPoints,
      isPassing: band.isPassing,
    });
  }

  return { exam, examCourses, marks, resultCards };
}
