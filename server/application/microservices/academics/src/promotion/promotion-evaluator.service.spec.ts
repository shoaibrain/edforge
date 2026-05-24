/**
 * PromotionEvaluatorService Spec — Sprint D.2.4
 *
 * Coverage (per `d2-sprint-plan.md` §4 D.2.4):
 *   - All-pass + ≥minAttendance → eligible + 'promoted'
 *   - One subject fail → retained + 'subject_failure'
 *   - Below attendance → retained + 'attendance_failure'
 *   - Required subject missing → retained + 'subjects_required_missing'
 *   - Stacked reasons → all surface in retainedReasons[]
 *   - No terminal card → retained + 'no_terminal_card'
 *   - Final-grade boundary → 'graduated' on success
 *   - Property: monotonic attendancePct → monotonic eligibility
 *   - Pure-function assertion: spec file does NOT import DDB SDK
 *   - Archetype-grep clean (no `tenant.archetype` branching in source)
 *   - Determinism: same input → same output across N invocations
 */

import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';
import {
  evaluatePromotion,
  PromotionEvaluatorService,
  type PromotionEvaluationInput,
  type EvaluatorResultCard,
  type EvaluatorRule,
} from './promotion-evaluator.service';

const ENROLLMENT = '11111111-1111-1111-1111-111111111111';
const STUDENT = '22222222-2222-2222-2222-222222222222';

const PABSON_RULE: EvaluatorRule = {
  ruleId: 'rrrrrrrr-rrrr-rrrr-rrrr-rrrrrrrrrrrr',
  passingThresholdPct: 35,
  minAttendancePct: 80,
  subjectsRequired: [],
};

function passingCard(courseIds: string[]): EvaluatorResultCard {
  return {
    cardId: 'card-1',
    enrollmentId: ENROLLMENT,
    examId: 'exam-1',
    isTerminalExam: true,
    totalScore: courseIds.length * 80,
    totalMaxMarks: courseIds.length * 100,
    courseScores: courseIds.map((id) => ({
      courseId: id,
      academicSubject: 'mathematics',
      isPassing: true,
    })),
  };
}

function mixedCard(scores: Array<{ courseId: string; subject: string; isPassing: boolean }>): EvaluatorResultCard {
  return {
    cardId: 'card-mixed',
    enrollmentId: ENROLLMENT,
    examId: 'exam-1',
    isTerminalExam: true,
    totalScore: 0,
    totalMaxMarks: 0,
    courseScores: scores.map((s) => ({
      courseId: s.courseId,
      academicSubject: s.subject,
      isPassing: s.isPassing,
    })),
  };
}

function input(overrides: Partial<PromotionEvaluationInput> = {}): PromotionEvaluationInput {
  return {
    enrollmentId: ENROLLMENT,
    studentId: STUDENT,
    resultCards: [passingCard(['c1', 'c2', 'c3'])],
    attendancePct: 92,
    rule: PABSON_RULE,
    ...overrides,
  };
}

// ============================================
// Eligible / promoted
// ============================================

describe('evaluatePromotion — eligible / promoted', () => {
  it('all-pass + ≥minAttendance → eligible=true + promoted', () => {
    const out = evaluatePromotion(input());
    expect(out.eligible).toBe(true);
    expect(out.suggestedDecision).toBe('promoted');
    expect(out.retainedReasons).toEqual([]);
  });

  it('boundary attendance = minAttendance → eligible (not below)', () => {
    const out = evaluatePromotion(input({ attendancePct: 80 }));
    expect(out.eligible).toBe(true);
  });

  it('final-grade flag → suggestedDecision = graduated (not promoted)', () => {
    const out = evaluatePromotion(input({ isFinalGrade: true }));
    expect(out.eligible).toBe(true);
    expect(out.suggestedDecision).toBe('graduated');
  });
});

// ============================================
// Retained / single reason
// ============================================

describe('evaluatePromotion — retained / single reason', () => {
  it('one subject fail → retained + subject_failure', () => {
    const card = mixedCard([
      { courseId: 'c-math', subject: 'mathematics', isPassing: false },
      { courseId: 'c-eng', subject: 'english', isPassing: true },
      { courseId: 'c-sci', subject: 'science', isPassing: true },
    ]);
    const out = evaluatePromotion(input({ resultCards: [card] }));
    expect(out.eligible).toBe(false);
    expect(out.suggestedDecision).toBe('retained');
    expect(out.retainedReasons).toContain('subject_failure');
    expect(out.details.failedSubjectIds).toEqual(['c-math']);
    expect(out.details.overallFailedSubjects).toBe(1);
    expect(out.details.overallPassedSubjects).toBe(2);
  });

  it('below attendance → retained + attendance_failure', () => {
    const out = evaluatePromotion(input({ attendancePct: 70 }));
    expect(out.eligible).toBe(false);
    expect(out.retainedReasons).toEqual(['attendance_failure']);
  });

  it('attendance at 79.99 → retained (below 80 threshold)', () => {
    const out = evaluatePromotion(input({ attendancePct: 79.99 }));
    expect(out.eligible).toBe(false);
    expect(out.retainedReasons).toContain('attendance_failure');
  });

  it('missing required subject → retained + subjects_required_missing', () => {
    const card = mixedCard([
      { courseId: 'c-math', subject: 'mathematics', isPassing: true },
      { courseId: 'c-sci', subject: 'science', isPassing: true },
      // 'english' required but absent
    ]);
    const out = evaluatePromotion(
      input({
        resultCards: [card],
        rule: { ...PABSON_RULE, subjectsRequired: ['english'] },
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.retainedReasons).toContain('subjects_required_missing');
  });

  it('required subject present but failing → counts as missing (per spec)', () => {
    const card = mixedCard([
      { courseId: 'c-eng', subject: 'english', isPassing: false },
      { courseId: 'c-math', subject: 'mathematics', isPassing: true },
    ]);
    const out = evaluatePromotion(
      input({
        resultCards: [card],
        rule: { ...PABSON_RULE, subjectsRequired: ['english'] },
      }),
    );
    expect(out.eligible).toBe(false);
    expect(out.retainedReasons).toContain('subjects_required_missing');
    expect(out.retainedReasons).toContain('subject_failure');
  });
});

// ============================================
// Stacked reasons
// ============================================

describe('evaluatePromotion — stacked reasons', () => {
  it('subject_failure + attendance_failure both surface', () => {
    const card = mixedCard([
      { courseId: 'c-math', subject: 'mathematics', isPassing: false },
      { courseId: 'c-eng', subject: 'english', isPassing: true },
    ]);
    const out = evaluatePromotion(input({ resultCards: [card], attendancePct: 50 }));
    expect(out.retainedReasons).toContain('subject_failure');
    expect(out.retainedReasons).toContain('attendance_failure');
    expect(out.retainedReasons).toHaveLength(2);
  });
});

// ============================================
// no_terminal_card
// ============================================

describe('evaluatePromotion — no terminal card', () => {
  it('empty resultCards[] → retained + no_terminal_card', () => {
    const out = evaluatePromotion(input({ resultCards: [] }));
    expect(out.eligible).toBe(false);
    expect(out.suggestedDecision).toBe('retained');
    expect(out.retainedReasons).toEqual(['no_terminal_card']);
    expect(out.details.overallPassedSubjects).toBe(0);
    expect(out.details.overallFailedSubjects).toBe(0);
  });

  it('no_terminal_card does NOT stack other reasons (operator must review)', () => {
    const out = evaluatePromotion(input({ resultCards: [], attendancePct: 50 }));
    expect(out.retainedReasons).toEqual(['no_terminal_card']);
  });
});

// ============================================
// Determinism + monotonicity
// ============================================

describe('evaluatePromotion — properties', () => {
  it('determinism: same input → same output across 10 invocations', () => {
    const fixed = input();
    const first = evaluatePromotion(fixed);
    for (let i = 0; i < 10; i++) {
      expect(evaluatePromotion(fixed)).toEqual(first);
    }
  });

  it('monotonic attendance: higher attendance never WORSENS eligibility', () => {
    const card = mixedCard([
      { courseId: 'c-math', subject: 'mathematics', isPassing: true },
      { courseId: 'c-eng', subject: 'english', isPassing: true },
    ]);
    let prevEligible = false;
    for (const attendancePct of [0, 25, 50, 75, 80, 85, 90, 95, 100]) {
      const out = evaluatePromotion(input({ resultCards: [card], attendancePct }));
      // eligibility is monotonic non-decreasing
      expect(out.eligible || !prevEligible).toBe(true);
      prevEligible = out.eligible;
    }
  });
});

// ============================================
// Strictest-fail across multiple cards (rare)
// ============================================

describe('evaluatePromotion — multi-card aggregation', () => {
  it('duplicate courseId across cards: failing card overrides passing card', () => {
    const passing = mixedCard([
      { courseId: 'c-math', subject: 'mathematics', isPassing: true },
    ]);
    const failing = {
      ...passing,
      cardId: 'card-2',
      examId: 'exam-2',
      courseScores: [{ courseId: 'c-math', academicSubject: 'mathematics', isPassing: false }],
    };
    const out = evaluatePromotion(input({ resultCards: [passing, failing] }));
    expect(out.eligible).toBe(false);
    expect(out.retainedReasons).toContain('subject_failure');
    expect(out.details.failedSubjectIds).toEqual(['c-math']);
  });
});

// ============================================
// Static guardrails — pure function + archetype-grep
// ============================================

describe('PromotionEvaluatorService — static guardrails', () => {
  const evaluatorPath = path.join(__dirname, 'promotion-evaluator.service.ts');
  const src = fs.readFileSync(evaluatorPath, 'utf8');

  // Strip block comments + line comments so docstring mentions of banned
  // tokens don't trip the regex. Quick lexer; sufficient for code-only
  // greps in TS source.
  const codeOnly = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');

  it('does NOT import @aws-sdk/* (pure function — no DDB reads inside)', () => {
    expect(codeOnly).not.toMatch(/from\s+['"]@aws-sdk\//);
  });

  it('does NOT import dynamodb-client.service (pure function — no DDB reads inside)', () => {
    expect(codeOnly).not.toMatch(/from\s+['"][^'"]*dynamodb-client\.service['"]/);
  });

  it('does NOT branch on tenant.archetype (invariant 12)', () => {
    // Looking for the implicit-branching pattern in code (not docstrings).
    // PromotionRule.archetypeId is a data field passed through to audit —
    // allowed. Banned: `tenant.archetype === 'PABSON'` style checks.
    expect(codeOnly).not.toMatch(/\btenant\.archetype\b/);
    expect(codeOnly).not.toMatch(/['"]PABSON['"]/);
    expect(codeOnly).not.toMatch(/['"]GENERIC['"]/);
  });

  it('Nest wrapper delegates to the pure function (no extra logic)', () => {
    const svc = new PromotionEvaluatorService();
    const inp = input();
    expect(svc.evaluate(inp)).toEqual(evaluatePromotion(inp));
  });
});
