/**
 * Term Aggregation — Lambda-local copy of the pure function from
 * `server/application/microservices/academics/src/results/term-aggregation.service.ts`.
 *
 * **DRY note:** this is a deliberate duplicate. The academics-service
 * version is decorated with @Injectable() for NestJS DI; this Lambda
 * version is plain TypeScript. Both must stay in sync; the function
 * logic is identical. Keeping in sync is cheap because:
 *   - The function is deterministic and pure (easy to spot drift in PR diff).
 *   - Any logic change touches both files in the same PR by convention.
 *   - Extracting to a workspace package would trigger the
 *     `edforge_workspace_only_packages_docker_trap` if academics ever
 *     needed it in a Docker build (workspace packages don't resolve in
 *     Docker; Lambdas via esbuild do).
 *
 * V1.5: revisit the workspace-package extraction if other Lambdas need
 * to call the function.
 *
 * Sync anchor: `aggregateTermResults` in academics src ~line 165.
 */

import type { LetterGradeEntryDto } from '@aibrains/shared-types';

// ============================================================================
// Local types (decoupled from NestJS / academics service)
// ============================================================================

export interface AggExam {
  examId: string;
  schoolId: string;
  termId: string;
  academicYearId: string;
}

export interface AggExamCourse {
  examCourseId: string;
  courseId: string;
  academicSubject: string;
  maxMarks: number;
  creditHours?: number;
}

export interface AggExamScore {
  examCourseId: string;
  enrollmentId: string;
  rawScore: number;
}

/**
 * Frozen student-identity snapshot denormalized onto the ResultCard at
 * generation time (RC-UX.1). Captured as of issuance so a published report
 * card reads as printed even after later section transfers / name corrections.
 */
export interface StudentIdentity {
  legalName: string;
  preferredName?: string;
  gradeLevel?: string;
  emisStudentId?: string;
  photoUrl?: string;
}

export interface AggEnrollment {
  enrollmentId: string;
  studentId: string;
  studentIdentity?: StudentIdentity;
}

export interface AggGradingPolicy {
  policyId: string;
  letterGrades: LetterGradeEntryDto[];
}

export interface AggregatedCourseScore {
  courseId: string;
  examCourseId: string;
  academicSubject: string;
  rawScore: number;
  maxMarks: number;
  grade: string;
  gpa: number;
  isPassing: boolean;
  isTerminalFail?: boolean;
}

export interface AggregatedEnrollmentRow {
  enrollmentId: string;
  studentId: string;
  schoolId: string;
  examId: string;
  termId: string;
  academicYearId: string;
  courseScores: AggregatedCourseScore[];
  totalScore: number;
  totalMaxMarks: number;
  termGpa: number;
  overallGrade: string;
  isTerminalExam: boolean;
  studentIdentity?: StudentIdentity;
}

export interface TermAggregationInput {
  exam: AggExam;
  examCourses: AggExamCourse[];
  examScores: AggExamScore[];
  /** enrollmentId → Enrollment (R42: studentId resolution source) */
  enrollments: Map<string, AggEnrollment>;
  gradingPolicy: AggGradingPolicy;
  isTerminalExam: boolean;
}

export interface TermAggregationOutput {
  perEnrollment: AggregatedEnrollmentRow[];
}

// ============================================================================
// Pure helpers
// ============================================================================

export function deriveLetterForPercentage(
  percentage: number,
  letterGrades: LetterGradeEntryDto[],
): LetterGradeEntryDto {
  if (letterGrades.length === 0) {
    throw new Error('GradingPolicy.letterGrades is empty — no letters defined');
  }
  const match = letterGrades.find(
    (l) => percentage >= l.minPercentage && percentage <= l.maxPercentage,
  );
  if (match) return match;
  return letterGrades.reduce((lo, cur) =>
    cur.minPercentage < lo.minPercentage ? cur : lo,
  );
}

export function resolveNotGradedLetter(
  letterGrades: LetterGradeEntryDto[],
): LetterGradeEntryDto {
  const terminal = letterGrades.find((l) => l.isTerminalFail);
  if (terminal) return terminal;
  const nonPassing = letterGrades.find((l) => !l.isPassing);
  if (nonPassing) return nonPassing;
  return letterGrades.reduce((lo, cur) =>
    cur.minPercentage < lo.minPercentage ? cur : lo,
  );
}

function indexScoresByEnrollment(
  scores: AggExamScore[],
): Map<string, Map<string, AggExamScore>> {
  const out = new Map<string, Map<string, AggExamScore>>();
  for (const s of scores) {
    let inner = out.get(s.enrollmentId);
    if (!inner) {
      inner = new Map();
      out.set(s.enrollmentId, inner);
    }
    inner.set(s.examCourseId, s);
  }
  return out;
}

function computeWeightedTermGpa(
  courseScores: AggregatedCourseScore[],
  examCourseById: Map<string, AggExamCourse>,
): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const cs of courseScores) {
    const ec = examCourseById.get(cs.examCourseId);
    const weight = ec?.creditHours ?? 1;
    weightedSum += cs.gpa * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  return weightedSum / totalWeight;
}

// ============================================================================
// Main aggregation — pure function
// ============================================================================

export function aggregateTermResults(input: TermAggregationInput): TermAggregationOutput {
  const { exam, examCourses, examScores, enrollments, gradingPolicy, isTerminalExam } = input;

  if (gradingPolicy.letterGrades.length === 0) {
    throw new Error(
      `GradingPolicy ${gradingPolicy.policyId} has no letterGrades; cannot aggregate`,
    );
  }

  const examCourseById = new Map<string, AggExamCourse>(
    examCourses.map((ec) => [ec.examCourseId, ec]),
  );
  const scoresByEnrollment = indexScoresByEnrollment(examScores);
  const ngEntry = resolveNotGradedLetter(gradingPolicy.letterGrades);

  const perEnrollment: AggregatedEnrollmentRow[] = [];

  for (const [enrollmentId, enrollment] of enrollments.entries()) {
    const courseScores: AggregatedCourseScore[] = [];
    let totalScore = 0;
    let totalMaxMarks = 0;

    const enrollmentScores = scoresByEnrollment.get(enrollmentId);

    for (const ec of examCourses) {
      const score = enrollmentScores?.get(ec.examCourseId);

      if (score === undefined) {
        // No row — NG / Not-Graded per D.1 semantics
        courseScores.push({
          courseId: ec.courseId,
          examCourseId: ec.examCourseId,
          academicSubject: ec.academicSubject,
          rawScore: 0,
          maxMarks: ec.maxMarks,
          grade: ngEntry.letter,
          gpa: ngEntry.gpaPoints,
          isPassing: ngEntry.isPassing,
          isTerminalFail: ngEntry.isTerminalFail,
        });
        totalMaxMarks += ec.maxMarks;
        continue;
      }

      const percentage = ec.maxMarks > 0 ? (score.rawScore / ec.maxMarks) * 100 : 0;
      const letter = deriveLetterForPercentage(percentage, gradingPolicy.letterGrades);

      courseScores.push({
        courseId: ec.courseId,
        examCourseId: ec.examCourseId,
        academicSubject: ec.academicSubject,
        rawScore: score.rawScore,
        maxMarks: ec.maxMarks,
        grade: letter.letter,
        gpa: letter.gpaPoints,
        isPassing: letter.isPassing,
        isTerminalFail: letter.isTerminalFail,
      });
      totalScore += score.rawScore;
      totalMaxMarks += ec.maxMarks;
    }

    const termGpa = computeWeightedTermGpa(courseScores, examCourseById);
    const overallPercentage = totalMaxMarks > 0 ? (totalScore / totalMaxMarks) * 100 : 0;
    const overallLetter = deriveLetterForPercentage(
      overallPercentage,
      gradingPolicy.letterGrades,
    );

    perEnrollment.push({
      enrollmentId,
      studentId: enrollment.studentId,                 // R42: from Enrollment, not ExamScore
      schoolId: exam.schoolId,
      examId: exam.examId,
      termId: exam.termId,
      academicYearId: exam.academicYearId,
      courseScores,
      totalScore,
      totalMaxMarks,
      termGpa,
      overallGrade: overallLetter.letter,
      isTerminalExam,
      studentIdentity: enrollment.studentIdentity,
    });
  }

  return { perEnrollment };
}
