/**
 * Term Aggregation Service — Sprint A.4.1
 *
 * **Pure function.** No DDB reads, no side effects. Caller (Lambda or
 * service) loads `Exam` + `ExamCourse[]` + `ExamScore[]` +
 * `Enrollment` map + `GradingPolicy` and hands them in.
 *
 * **Architecture: Core Ed-Fi V6 (per `a4-sprint-plan.md` §1.5).**
 *   - Archetype-blind: no `tenant.archetype` reads in this file.
 *     The valid grade letters + GPA points + passing flags come from
 *     GradingPolicy.letterGrades[] (lazy-seeded from ArchetypeDefaults
 *     by D.1.3; this service consumes the resolved entity).
 *   - Pure: deterministic from inputs. Suitable for property tests.
 *
 * **R42 mitigation (CRITICAL):** `studentId` is resolved here from the
 * Enrollment map keyed by `enrollmentId`. ExamScore.studentId is NOT
 * trusted — A.3 bulk handler writes `'unknown'` for performance, and
 * the single-write fallback also stores `'unknown'` on enrollment-miss.
 * ResultCard becomes the system of truth for resolved studentId.
 *
 * **Missing-score semantics:** for any ExamCourse where no ExamScore
 * row exists for the enrollment, the row is included in
 * courseScores[] with letter='NG' (if policy defines NG; otherwise
 * with the first letterGradeEntry having `isPassing: false`). This
 * matches the D.1 Not-Graded sentinel pattern; downstream rendering
 * (C.4.3) can show absences without separate plumbing.
 *
 * @see docs/pilot-greenlight/a4-sprint-plan.md §4 A.4.1
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  LetterGradeEntryDto,
} from '@aibrains/shared-types';
import { Exam } from '../common/entities/exam.entity';
import { ExamCourse } from '../common/entities/exam-course.entity';
import { ExamScore } from '../common/entities/exam-score.entity';
import { Enrollment } from '../common/entities/enrollment.entity';
import { GradingPolicyEntity } from '../common/entities/grading-policy.entity';
import {
  ResultCard,
  ResultCardCourseScore,
} from '../common/entities/result-card.entity';

// ============================================================================
// Types
// ============================================================================

export interface TermAggregationInput {
  exam: Exam;
  examCourses: ExamCourse[];
  examScores: ExamScore[];
  /** enrollmentId → Enrollment row (R42: studentId resolution source) */
  enrollments: Map<string, Enrollment>;
  gradingPolicy: GradingPolicyEntity;
  /**
   * Whether THIS exam is the terminal exam of the AY. Drives
   * `result.published.isTerminal` for C.9.5 cross-year handoff.
   * Caller computes by checking against
   * `archetypeDefaults[archetype].examPattern[length-1]` or similar.
   */
  isTerminalExam: boolean;
}

export interface AggregatedEnrollmentRow {
  enrollmentId: string;
  studentId: string;                            // R42-resolved from Enrollment
  schoolId: string;
  examId: string;
  termId: string;
  academicYearId: string;
  courseScores: ResultCardCourseScore[];
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
}

export interface TermAggregationOutput {
  perEnrollment: AggregatedEnrollmentRow[];
}

// ============================================================================
// Pure helpers (exported for spec coverage)
// ============================================================================

/**
 * Derive a letterGradeEntry from raw percentage by range lookup.
 * Returns the matching entry, or the NG/terminal-fail entry if defined,
 * or the first entry as last-resort fallback.
 */
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
  // No range matched — return the lowest-percentage entry (typically F or NG)
  return letterGrades.reduce((lo, cur) =>
    cur.minPercentage < lo.minPercentage ? cur : lo,
  );
}

/**
 * P1.5a — resolve the Division band for an aggregate percentage. Bands are
 * evaluated high→low; first met `minPercentage` wins. Null below the lowest.
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
 * Resolve the NG / Not-Graded letter from the policy (the entry with
 * `isTerminalFail: true` per D.1 Nepal CEHRD semantics). Falls back to
 * the lowest non-passing letter if no terminal-fail entry is defined.
 */
export function resolveNotGradedLetter(
  letterGrades: LetterGradeEntryDto[],
): LetterGradeEntryDto {
  const terminal = letterGrades.find((l) => l.isTerminalFail);
  if (terminal) return terminal;
  const nonPassing = letterGrades.find((l) => !l.isPassing);
  if (nonPassing) return nonPassing;
  // Policy defines only passing letters — return the lowest one
  return letterGrades.reduce((lo, cur) =>
    cur.minPercentage < lo.minPercentage ? cur : lo,
  );
}

/**
 * Build one ResultCard course-score row (P1.5b/c, P1b). Handles:
 *   - missing score → `notGraded` (Absent, distinct non-failing state §4.1),
 *   - the Theory/Practical component breakdown + per-component pass,
 *   - subject pass (every component ≥ its passMarks when split, else
 *     rawScore ≥ passingMarks),
 *   - the superset columns (passMarks/pass/components/highestInClass).
 * `highestInClass` is null here — the cohort pass fills it in V1.5 (§4.8).
 */
function buildCourseScore(
  ec: ExamCourse,
  score: ExamScore | undefined,
  letterGrades: LetterGradeEntryDto[],
  ngEntry: LetterGradeEntryDto,
): ResultCardCourseScore {
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
    : score.rawScore >= ec.passingMarks;

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
 * Build a per-enrollment lookup of ExamScores by examCourseId.
 */
function indexScoresByCourseAndEnrollment(
  scores: ExamScore[],
): Map<string, Map<string, ExamScore>> {
  const out = new Map<string, Map<string, ExamScore>>();
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

/**
 * Compute weighted termGpa across courseScores.
 *   weightedSum / totalWeight  where weight = courseScore.creditHours || 1.
 * If totalWeight is 0 (no courses), returns 0.
 */
function computeWeightedTermGpa(
  courseScores: ResultCardCourseScore[],
  examCourseById: Map<string, ExamCourse>,
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
 * P1.5d — cohort post-aggregation pass. Mutates the per-enrollment rows in place
 * to fill the two cohort stats the card shows but a per-student pass can't know:
 *   - `courseScores[].highestInClass` (H.M.) = the top obtained mark per subject,
 *     across graded rows only.
 *   - `classRank` (the card "Position") = rank by totalScore descending with
 *     competition ranking (ties share a rank; the next rank skips). Rows with no
 *     graded subject (fully absent) are left unranked (`null`).
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
// Main aggregation
// ============================================================================

@Injectable()
export class TermAggregationService {
  private readonly logger = new Logger(TermAggregationService.name);

  /**
   * Pure function — aggregate term results into per-enrollment rows.
   * Caller passes everything needed; no I/O happens here.
   */
  aggregateTermResults(input: TermAggregationInput): TermAggregationOutput {
    const { exam, examCourses, examScores, enrollments, gradingPolicy, isTerminalExam } = input;

    if (gradingPolicy.letterGrades.length === 0) {
      throw new Error(
        `GradingPolicy ${gradingPolicy.policyId} has no letterGrades; cannot aggregate`,
      );
    }

    const examCourseById = new Map<string, ExamCourse>(
      examCourses.map((ec) => [ec.examCourseId, ec]),
    );
    const scoresByEnrollment = indexScoresByCourseAndEnrollment(examScores);
    const ngEntry = resolveNotGradedLetter(gradingPolicy.letterGrades);

    const perEnrollment: AggregatedEnrollmentRow[] = [];

    for (const [enrollmentId, enrollment] of enrollments.entries()) {
      const courseScores: ResultCardCourseScore[] = [];
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
      // Division withheld on fail.
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
        studentId: enrollment.studentId,        // R42: resolved from Enrollment, not ExamScore
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
      });
    }

    // P1.5d — fill cohort stats (H.M. per subject + Position) now that every
    // enrollment's row exists.
    applyCohortStats(perEnrollment);

    this.logger.debug(
      `aggregateTermResults: examId=${exam.examId} enrollments=${perEnrollment.length} courses=${examCourses.length} terminal=${isTerminalExam}`,
    );

    return { perEnrollment };
  }
}

// ============================================================================
// Builder: aggregation output → ResultCard entity factories' input shape
// ============================================================================

/**
 * Translate an `AggregatedEnrollmentRow` into the shape required by
 * `createResultCardEntity(data: ...)`. Caller still wraps with tenantId
 * + cardId via the factory.
 */
export function aggregatedRowToResultCardData(
  row: AggregatedEnrollmentRow,
  audit: { createdBy: string; createdAt: string },
): Omit<
  ResultCard,
  | 'tenantId'
  | 'entityKey'
  | 'entityType'
  | 'cardId'
  | 'gsi1pk'
  | 'gsi1sk'
  | 'gsi2pk'
  | 'gsi2sk'
  | 'gsi3pk'
  | 'gsi3sk'
> {
  return {
    enrollmentId: row.enrollmentId,
    examId: row.examId,
    termId: row.termId,
    academicYearId: row.academicYearId,
    schoolId: row.schoolId,
    studentId: row.studentId,
    courseScores: row.courseScores,
    totalScore: row.totalScore,
    totalMaxMarks: row.totalMaxMarks,
    termGpa: row.termGpa,
    overallGrade: row.overallGrade,
    percentage: row.percentage,
    division: row.division,
    result: row.result,
    classRank: row.classRank ?? null,           // P1.5d — cohort rank ("Position")
    sectionRank: null,
    conduct: null,
    classTeacherRemark: null,
    status: 'draft',
    publishedAt: null,
    publishedBy: null,
    isTerminalExam: row.isTerminalExam,
    isActive: true,
    createdAt: audit.createdAt,
    createdBy: audit.createdBy,
    updatedAt: audit.createdAt,
    updatedBy: audit.createdBy,
    version: 1,
  };
}
