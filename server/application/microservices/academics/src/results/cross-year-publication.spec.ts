/**
 * Cross-Year Publication Spec — Sprint A.4.6
 *
 * **Invariant 3 regression guard.** Per master plan §1.4 and a4-sprint-plan
 * §1.5 #1: ResultCard is keyed by `enrollmentId` (NOT `(studentId, examId)`)
 * so that promotion (D.2.10) rewrites of Enrollment leave per-AY cards
 * untouched.
 *
 * Scenario:
 *   - Student S1 is enrolled in AY1 with enrollmentId = enroll-ay1
 *   - Student S1 is promoted to AY2 with enrollmentId = enroll-ay2
 *   - Term-1 exam in AY1 closes → ResultCard card-1 generated for enroll-ay1
 *   - AY2 enrollment is created (D.2.10 rewrites a row, NOT card-1's row)
 *   - AY1 Term-1 card is published AFTER AY2 enrollment exists
 *
 * Assertions:
 *   - card-1.enrollmentId === enroll-ay1 (NOT enroll-ay2)
 *   - card-1.gsi2pk === 'enrollment#enroll-ay1' (cross-AY partition stable)
 *   - GSI2 query by enroll-ay2 returns nothing for card-1
 *   - GSI3 query by AY1 examId returns card-1 only
 *   - studentId on card-1 still resolves to S1 (denormalized at aggregation)
 */

import { createResultCardEntity, ResultCard } from '../common/entities/result-card.entity';

function buildCardForAy(
  cardId: string,
  enrollmentId: string,
  examId: string,
  academicYearId: string,
  studentId: string,
): ResultCard {
  return createResultCardEntity('tenant-1', cardId, {
    enrollmentId,
    examId,
    termId: 'term-1',
    academicYearId,
    schoolId: 'school-1',
    studentId,
    courseScores: [],
    totalScore: 0,
    totalMaxMarks: 0,
    termGpa: 0,
    overallGrade: 'NG',
    status: 'draft',
    isTerminalExam: false,
    isActive: true,
    createdAt: '2026-06-01T00:00:00.000Z',
    createdBy: 'lambda',
    updatedAt: '2026-06-01T00:00:00.000Z',
    updatedBy: 'lambda',
    version: 1,
  });
}

describe('Sprint A.4.6 — Cross-year publication invariant 3 guard', () => {
  const STUDENT = 'student-S1';
  const AY1 = 'ay-2025-26';
  const AY2 = 'ay-2026-27';
  const ENROLL_AY1 = 'enroll-ay1';
  const ENROLL_AY2 = 'enroll-ay2';
  const EXAM_AY1 = 'exam-ay1-term1';
  const EXAM_AY2 = 'exam-ay2-term1';

  it('AY1 ResultCard stays bound to AY1 enrollment after AY2 enrollment is created', () => {
    // 1. Generate the AY1 card
    const ay1Card = buildCardForAy('card-ay1', ENROLL_AY1, EXAM_AY1, AY1, STUDENT);

    // 2. Simulate D.2.10 grade promotion creating an AY2 enrollment row
    //    (does not touch ay1Card; that's the point of invariant 3)
    //    For this spec, we don't materialize the Enrollment entity — we
    //    only verify that ay1Card's keying is untouched.

    // 3. Publish AY1 card AFTER AY2 enrollment exists (simulated by
    //    operator action; here we just toggle status).
    const published = { ...ay1Card, status: 'published' as const };

    // 4. Assertions
    expect(published.enrollmentId).toBe(ENROLL_AY1);
    expect(published.enrollmentId).not.toBe(ENROLL_AY2);
    expect(published.gsi2pk).toBe(`enrollment#${ENROLL_AY1}`);
    expect(published.gsi2pk).not.toBe(`enrollment#${ENROLL_AY2}`);
    expect(published.studentId).toBe(STUDENT);
    expect(published.academicYearId).toBe(AY1);
  });

  it('GSI2 partitions cleanly: an AY2 enrollment-centric query does NOT surface AY1 cards', () => {
    const ay1Card = buildCardForAy('card-ay1', ENROLL_AY1, EXAM_AY1, AY1, STUDENT);
    const ay2Card = buildCardForAy('card-ay2', ENROLL_AY2, EXAM_AY2, AY2, STUDENT);

    // Simulating a "list cards where gsi2pk = enrollment#enroll-ay2" filter
    const all = [ay1Card, ay2Card];
    const ay2Results = all.filter((c) => c.gsi2pk === `enrollment#${ENROLL_AY2}`);

    expect(ay2Results).toHaveLength(1);
    expect(ay2Results[0].cardId).toBe('card-ay2');
    expect(ay2Results.find((c) => c.cardId === 'card-ay1')).toBeUndefined();
  });

  it('GSI3 (exam-scope) returns AY1 card by AY1 examId only', () => {
    const ay1Card = buildCardForAy('card-ay1', ENROLL_AY1, EXAM_AY1, AY1, STUDENT);
    const ay2Card = buildCardForAy('card-ay2', ENROLL_AY2, EXAM_AY2, AY2, STUDENT);

    const all = [ay1Card, ay2Card];
    const examAy1Results = all.filter((c) => c.gsi3pk === `exam#${EXAM_AY1}`);
    const examAy2Results = all.filter((c) => c.gsi3pk === `exam#${EXAM_AY2}`);

    expect(examAy1Results).toHaveLength(1);
    expect(examAy1Results[0].cardId).toBe('card-ay1');
    expect(examAy2Results).toHaveLength(1);
    expect(examAy2Results[0].cardId).toBe('card-ay2');
  });

  it('Cross-AY transcript shape: filtering both cards by studentId returns both', () => {
    const ay1Card = buildCardForAy('card-ay1', ENROLL_AY1, EXAM_AY1, AY1, STUDENT);
    const ay2Card = buildCardForAy('card-ay2', ENROLL_AY2, EXAM_AY2, AY2, STUDENT);

    const all = [ay1Card, ay2Card];
    const studentCards = all.filter((c) => c.studentId === STUDENT);

    expect(studentCards).toHaveLength(2);
    expect(studentCards.map((c) => c.academicYearId).sort()).toEqual([AY1, AY2]);
  });

  it('enrollmentId is the entityKey, not (studentId, examId)', () => {
    const card = buildCardForAy('card-ay1', ENROLL_AY1, EXAM_AY1, AY1, STUDENT);
    expect(card.entityKey).toMatch(/^RESULT_CARD#enroll-ay1#card-ay1$/);
    expect(card.entityKey).not.toContain(STUDENT);
  });
});
