/**
 * Exam-cycle generator — Sprint S1.8.
 *
 * One terminal exam covering every grade, with the config's weighted
 * components, marks for every student, and the result card each student's
 * marks produce. Result cards are auto-generated server-side on publish, so
 * the cards here are the *expected* values (computed with the archetype's
 * canonical letterGrades scale from shared-types) for the loader to verify.
 */

import { getArchetypeDefaults } from '@aibrains/shared-types';

import type { DemoRosterConfig } from './roster-config';
import type {
  DemoAcademicYear,
  DemoExam,
  DemoExamComponent,
  DemoMark,
  DemoResultCard,
  DemoStudent,
} from './generated-types';
import type { Rng } from './synthetic-identity';

export interface ExamCycle {
  exam: DemoExam;
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
): ExamCycle {
  const components: DemoExamComponent[] = config.examCycle.components.map((c) => ({
    name: c.name,
    weightPct: c.weightPct,
    maxMarks: c.weightPct, // weights sum to 100 → exam totals 100 marks
  }));
  const totalMax = components.reduce((s, c) => s + c.maxMarks, 0);
  const terminalTerm = academicYear.terms[academicYear.terms.length - 1];

  const exam: DemoExam = {
    ref: 'exam:0',
    examName: config.examCycle.name,
    examType: config.examCycle.examType,
    gradeCodes: config.gradeLevels.map((g) => g.code),
    termRef: terminalTerm.ref,
    startDate: terminalTerm.examStartDate,
    endDate: terminalTerm.examEndDate,
    components,
  };

  const bands = getArchetypeDefaults(config.archetype).letterGrades as LetterBand[];

  const marks: DemoMark[] = [];
  const resultCards: DemoResultCard[] = [];

  for (const student of students) {
    // Per-student baseline ability, varied so the cohort isn't degenerate.
    const ability = rng.int(30, 96);
    let total = 0;
    for (const comp of components) {
      const compPct = clamp(ability + rng.int(-8, 8), 0, 100);
      const marksObtained = Math.round((compPct / 100) * comp.maxMarks);
      total += marksObtained;
      marks.push({
        ref: `mark:${student.ref}:${comp.name}`,
        studentRef: student.ref,
        examRef: exam.ref,
        componentName: comp.name,
        marksObtained,
        maxMarks: comp.maxMarks,
      });
    }
    const percentage = Math.round((total / totalMax) * 10000) / 100;
    const band = bandForPercentage(bands, percentage);
    resultCards.push({
      ref: `resultcard:${student.ref}`,
      studentRef: student.ref,
      examRef: exam.ref,
      gradeCode: student.gradeCode,
      totalMarks: total,
      totalMax,
      percentage,
      letterGrade: band.letter,
      gpaPoints: band.gpaPoints,
      isPassing: band.isPassing,
    });
  }

  return { exam, marks, resultCards };
}
