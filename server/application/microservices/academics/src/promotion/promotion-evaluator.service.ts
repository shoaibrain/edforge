/**
 * PromotionEvaluatorService — Sprint D.2.4
 *
 * **Pure function.** Zero DDB reads, zero side effects, zero archetype
 * branching. The caller (D.2.5 batch endpoint) resolves PromotionRule +
 * ResultCard rows + Attendance% via service-layer reads and hands them in.
 *
 * **Invariants (per `d2-sprint-plan.md` §1.5):**
 *   1. No `tenant.archetype` reads in this file. PromotionRule.archetypeId
 *      is a data field carried through to audit traceability — NEVER
 *      branched on. (`grep -rn 'archetype' microservices/academics/src/promotion/`
 *      should return zero implicit-branching hits.)
 *   2. Pure function: NO imports from `@aws-sdk/*` or `dynamodb-client.service`.
 *   3. Inputs are read-only; outputs are fresh objects.
 *
 * **Suggested-decision logic:**
 *   - eligible=true  + no-final-grade-flag → `'promoted'`
 *   - eligible=true  + final-grade-flag    → `'graduated'`
 *   - eligible=false                       → `'retained'`
 *   The final-grade detection (`isFinalGrade` input flag) is set by the
 *   caller from `archetypeDefaults.boardExams` — keeps archetype data at
 *   the edge, not inside the evaluator.
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.4
 */

import { Injectable } from '@nestjs/common';
import type {
  PromotionDecision,
  RetentionReason,
} from '@aibrains/shared-types';

// ============================================================================
// Input types
// ============================================================================

/**
 * Minimal projection of a ResultCard row that the evaluator needs. Avoids
 * coupling the evaluator to the full ResultCard entity shape — the caller
 * extracts just these fields when invoking the evaluator.
 */
export interface EvaluatorResultCard {
  cardId: string;
  enrollmentId: string;
  examId: string;
  isTerminalExam: boolean;
  totalScore: number;
  totalMaxMarks: number;
  courseScores: Array<{
    courseId: string;
    academicSubject: string;
    isPassing: boolean;
  }>;
}

export interface EvaluatorRule {
  ruleId: string;
  passingThresholdPct: number;
  minAttendancePct: number;
  subjectsRequired: string[]; // AcademicSubjectDescriptor values
}

export interface PromotionEvaluationInput {
  enrollmentId: string;
  studentId: string;
  studentName?: string;
  /** Terminal-AY ResultCards for this enrollment. Typically 1; engine handles N. */
  resultCards: EvaluatorResultCard[];
  /** 0..100 — current AY attendance % computed by the caller. */
  attendancePct: number;
  /** Active PromotionRule resolved by the caller for this enrollment. */
  rule: EvaluatorRule;
  /**
   * True when the enrollment is at the archetype's final grade (PABSON
   * Grade 10 for SEE-graduating cohort). Caller computes from
   * `archetypeDefaults` — keeps archetype data outside this pure function.
   */
  isFinalGrade?: boolean;
}

// ============================================================================
// Output types
// ============================================================================

export interface PromotionEvaluationOutput {
  enrollmentId: string;
  studentId: string;
  studentName?: string;
  eligible: boolean;
  suggestedDecision: PromotionDecision;
  retainedReasons: RetentionReason[];
  details: {
    overallPassedSubjects: number;
    overallFailedSubjects: number;
    failedSubjectIds: string[];
    attendancePct: number;
    passingThresholdPct: number;
    minAttendancePct: number;
  };
}

// ============================================================================
// Pure function
// ============================================================================

/**
 * Evaluate one enrollment for promotion eligibility.
 *
 * Determinism: same input always produces same output. No `Date.now()`,
 * no `Math.random()`, no module-level state read.
 */
export function evaluatePromotion(
  input: PromotionEvaluationInput,
): PromotionEvaluationOutput {
  const { enrollmentId, studentId, studentName, resultCards, attendancePct, rule, isFinalGrade } = input;
  const retainedReasons: RetentionReason[] = [];

  // No terminal card → cannot evaluate; operator must review.
  if (resultCards.length === 0) {
    return {
      enrollmentId,
      studentId,
      studentName,
      eligible: false,
      suggestedDecision: 'retained',
      retainedReasons: ['no_terminal_card'],
      details: {
        overallPassedSubjects: 0,
        overallFailedSubjects: 0,
        failedSubjectIds: [],
        attendancePct,
        passingThresholdPct: rule.passingThresholdPct,
        minAttendancePct: rule.minAttendancePct,
      },
    };
  }

  // Aggregate per-course pass/fail across all terminal cards. Duplicate
  // courseIds (rare; only if multiple terminal cards share a course) take
  // the strictest-fail interpretation: if ANY card marks the course
  // failing, treat it as failed.
  //
  // Map: courseId → { academicSubject, isPassing }
  const perCourse = new Map<string, { academicSubject: string; isPassing: boolean }>();
  for (const card of resultCards) {
    for (const score of card.courseScores) {
      const prior = perCourse.get(score.courseId);
      if (!prior) {
        perCourse.set(score.courseId, {
          academicSubject: score.academicSubject,
          isPassing: score.isPassing,
        });
      } else if (!score.isPassing) {
        // strictest-fail: overwrite passing → failing
        perCourse.set(score.courseId, {
          academicSubject: score.academicSubject,
          isPassing: false,
        });
      }
    }
  }

  const failedSubjectIds: string[] = [];
  let passed = 0;
  let failed = 0;
  for (const [courseId, info] of perCourse.entries()) {
    if (info.isPassing) {
      passed += 1;
    } else {
      failed += 1;
      failedSubjectIds.push(courseId);
    }
  }

  if (failed > 0) {
    retainedReasons.push('subject_failure');
  }

  // Required-subjects check: every entry in rule.subjectsRequired must
  // appear in perCourse AND be passing.
  if (rule.subjectsRequired.length > 0) {
    const passingSubjects = new Set<string>();
    for (const info of perCourse.values()) {
      if (info.isPassing) passingSubjects.add(info.academicSubject);
    }
    const missingRequired = rule.subjectsRequired.filter(
      (required) => !passingSubjects.has(required),
    );
    if (missingRequired.length > 0) {
      retainedReasons.push('subjects_required_missing');
    }
  }

  // Attendance check.
  if (attendancePct < rule.minAttendancePct) {
    retainedReasons.push('attendance_failure');
  }

  const eligible = retainedReasons.length === 0;
  const suggestedDecision: PromotionDecision = eligible
    ? isFinalGrade
      ? 'graduated'
      : 'promoted'
    : 'retained';

  return {
    enrollmentId,
    studentId,
    studentName,
    eligible,
    suggestedDecision,
    retainedReasons,
    details: {
      overallPassedSubjects: passed,
      overallFailedSubjects: failed,
      failedSubjectIds,
      attendancePct,
      passingThresholdPct: rule.passingThresholdPct,
      minAttendancePct: rule.minAttendancePct,
    },
  };
}

/**
 * Nest-injectable wrapper around the pure function. Exists so D.2.5 can
 * inject the evaluator through DI (testable via service swap). The wrapper
 * is intentionally trivial — keep the pure function the system-of-record
 * and DO NOT add caching, batching, or DDB reads here.
 */
@Injectable()
export class PromotionEvaluatorService {
  evaluate(input: PromotionEvaluationInput): PromotionEvaluationOutput {
    return evaluatePromotion(input);
  }
}
