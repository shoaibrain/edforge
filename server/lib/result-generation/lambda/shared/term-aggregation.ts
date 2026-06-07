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

export interface AggExamComponent {
  code: string;
  label?: string;
  fullMarks: number;
  passMarks: number;
}

export interface AggExamCourse {
  examCourseId: string;
  courseId: string;
  academicSubject?: string;
  subjectArea?: string;
  courseName?: string;
  maxMarks: number;
  passingMarks?: number;
  creditHours?: number;
  /** P1.5b — Theory/Practical split; absent for single-component subjects. */
  components?: AggExamComponent[];
}

export interface AggExamScore {
  examCourseId: string;
  enrollmentId: string;
  rawScore: number;
  /** P1.5b — per-component marks keyed by component code. */
  componentScores?: Record<string, number>;
}

export interface AggComponentScore {
  code: string;
  label?: string;
  fullMarks: number;
  passMarks: number;
  obtained: number;
  pass: boolean;
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
  /** P1.5a — 'division' aggregates by percentage band; default 'letter_gpa'. */
  schemeType?: 'letter_gpa' | 'division';
  divisions?: { label: string; minPercentage: number }[];
}

export interface AggregatedCourseScore {
  courseId: string;
  examCourseId: string;
  academicSubject?: string;
  subjectArea?: string;
  courseName?: string;
  rawScore: number;
  maxMarks: number;
  // P1.5c — subject superset
  passMarks?: number;
  pass?: boolean;
  components?: AggComponentScore[];
  highestInClass?: number | null;
  // P1b — Absent / Not-Graded (distinct non-failing state)
  notGraded?: boolean;
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
  percentage?: number;
  division?: string | null;
  result?: 'pass' | 'fail';
  /** P1.5d cohort stat — rank by totalScore (the card "Position"); null = unranked. */
  classRank?: number | null;
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

/**
 * Resolve the Division band for an aggregate percentage. Bands are evaluated
 * high→low; the first whose `minPercentage` the student meets wins. Returns
 * null when below the lowest band (caller treats that as no division).
 */
export function deriveDivision(
  percentage: number,
  divisions: { label: string; minPercentage: number }[],
): string | null {
  const sorted = [...divisions].sort((a, b) => b.minPercentage - a.minPercentage);
  for (const band of sorted) {
    if (percentage >= band.minPercentage) return band.label;
  }
  return null;
}

/**
 * Build one aggregated course-score row (P1.5b/c, P1b). Mirrors the academics
 * service `buildCourseScore`; keep both in sync. Handles missing-score Absent,
 * the component breakdown + per-component pass, subject pass, and the superset
 * columns. `highestInClass` is null (cohort compute is V1.5, §4.8).
 */
function buildCourseScore(
  ec: AggExamCourse,
  score: AggExamScore | undefined,
  letterGrades: LetterGradeEntryDto[],
  ngEntry: LetterGradeEntryDto,
): AggregatedCourseScore {
  const subjectIdentity = {
    courseId: ec.courseId,
    examCourseId: ec.examCourseId,
    academicSubject: ec.academicSubject,
    subjectArea: ec.subjectArea,
    courseName: ec.courseName,
    maxMarks: ec.maxMarks,
    passMarks: ec.passingMarks,
    highestInClass: null,
  };

  if (score === undefined) {
    return {
      ...subjectIdentity,
      rawScore: 0,
      notGraded: true,
      pass: false,
      grade: ngEntry.letter,
      gpa: ngEntry.gpaPoints,
      isPassing: ngEntry.isPassing,
      isTerminalFail: ngEntry.isTerminalFail,
    };
  }

  const components = ec.components?.map((c) => {
    const obtained = score.componentScores?.[c.code] ?? 0;
    return {
      code: c.code,
      label: c.label,
      fullMarks: c.fullMarks,
      passMarks: c.passMarks,
      obtained,
      pass: obtained >= c.passMarks,
    };
  });

  const subjectPass = components && components.length > 0
    ? components.every((c) => c.pass)
    : score.rawScore >= (ec.passingMarks ?? 0);

  const percentage = ec.maxMarks > 0 ? (score.rawScore / ec.maxMarks) * 100 : 0;
  const letter = deriveLetterForPercentage(percentage, letterGrades);

  return {
    ...subjectIdentity,
    rawScore: score.rawScore,
    components,
    pass: subjectPass,
    grade: letter.letter,
    gpa: letter.gpaPoints,
    isPassing: letter.isPassing,
    isTerminalFail: letter.isTerminalFail,
  };
}

/**
 * P1.5d — cohort post-aggregation pass (mirrors the academics service copy; keep
 * in sync). Mutates rows in place: `courseScores[].highestInClass` (H.M., top
 * obtained per subject across graded rows) + `classRank` (the card "Position",
 * by totalScore desc, competition ranking; fully-absent rows left null).
 */
function applyCohortStats(rows: AggregatedEnrollmentRow[]): void {
  const highest = new Map<string, number>();
  for (const row of rows) {
    for (const cs of row.courseScores) {
      if (cs.notGraded) continue;
      const cur = highest.get(cs.examCourseId);
      if (cur === undefined || cs.rawScore > cur) highest.set(cs.examCourseId, cs.rawScore);
    }
  }
  for (const row of rows) {
    for (const cs of row.courseScores) {
      cs.highestInClass = highest.get(cs.examCourseId) ?? null;
    }
  }
  const rankable = rows.filter((r) => r.courseScores.some((cs) => !cs.notGraded));
  const sorted = [...rankable].sort((a, b) => b.totalScore - a.totalScore);
  let rank = 0;
  let prev: number | null = null;
  let seen = 0;
  for (const row of sorted) {
    seen++;
    if (prev === null || row.totalScore !== prev) {
      rank = seen;
      prev = row.totalScore;
    }
    row.classRank = rank;
  }
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
      const cs = buildCourseScore(ec, score, gradingPolicy.letterGrades, ngEntry);
      courseScores.push(cs);
      totalMaxMarks += ec.maxMarks;
      if (!cs.notGraded) totalScore += cs.rawScore;
    }

    const termGpa = computeWeightedTermGpa(courseScores, examCourseById);
    const overallPercentage = totalMaxMarks > 0 ? (totalScore / totalMaxMarks) * 100 : 0;
    const overallLetter = deriveLetterForPercentage(
      overallPercentage,
      gradingPolicy.letterGrades,
    );

    // P1.5a/b — division scheme: pass requires every subject to pass (each
    // component ≥ its passMarks when split; ungraded counts as fail). The
    // per-subject `pass` flag from buildCourseScore already encodes this.
    let division: string | null | undefined;
    let result: 'pass' | 'fail' | undefined;
    if (gradingPolicy.schemeType === 'division') {
      const allPassed = courseScores.every((cs) => cs.pass === true);
      result = allPassed ? 'pass' : 'fail';
      division = allPassed
        ? deriveDivision(overallPercentage, gradingPolicy.divisions ?? [])
        : null;
    }

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
      percentage: Math.round(overallPercentage * 100) / 100,
      division,
      result,
      isTerminalExam,
      studentIdentity: enrollment.studentIdentity,
    });
  }

  applyCohortStats(perEnrollment);

  return { perEnrollment };
}
