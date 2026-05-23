/**
 * ExamScore entity spec — Sprint A.3.4
 *
 * Coverage:
 *   - Factory shape with enrollmentId binding (invariant 3)
 *   - entityKey + 3 GSI key sets (school / student / enrollment)
 *   - GSI casing lowercase (S3.2 guard)
 *   - Cross-AY queryability via GSI2 (student-centric)
 *   - tenantId bare UUID
 */

import { createExamScoreEntity, ExamScore } from './exam-score.entity';

describe('ExamScore entity (A.3.4)', () => {
  const TID = '21aea5da-511f-4dfa-a6f2-6971f63a719f';
  const SID = '4209e3d8-d2e2-4e0e-9961-790341c264f4';
  const EID = '99999999-9999-9999-9999-999999999999';
  const ECID = '88888888-8888-8888-8888-888888888888';
  const ENID = '77777777-7777-7777-7777-777777777777';
  const ESID = '66666666-6666-6666-6666-666666666666';
  const STID = '55555555-5555-5555-5555-555555555555';
  const AYID = '44444444-4444-4444-4444-444444444444';
  const TERMID = '33333333-3333-3333-3333-333333333333';

  function buildData(overrides: Partial<ExamScore> = {}): Omit<ExamScore, 'tenantId' | 'entityKey' | 'entityType' | 'examScoreId' | 'examId' | 'examCourseId' | 'enrollmentId' | 'schoolId' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk' | 'gsi3pk' | 'gsi3sk'> {
    return {
      studentId: STID,
      academicYearId: AYID,
      termId: TERMID,
      rawScore: 75,
      status: 'entered',
      enteredBy: 'admin-001',
      enteredAt: '2026-05-22T10:00:00.000Z',
      createdAt: '2026-05-22T10:00:00.000Z',
      createdBy: 'admin-001',
      updatedAt: '2026-05-22T10:00:00.000Z',
      updatedBy: 'admin-001',
      version: 1,
      ...overrides,
    };
  }

  it('factory produces a fully-keyed entity', () => {
    const es = createExamScoreEntity(TID, ESID, EID, ECID, ENID, SID, buildData());
    expect(es.entityType).toBe('EXAM_SCORE');
    expect(es.examScoreId).toBe(ESID);
    expect(es.examId).toBe(EID);
    expect(es.examCourseId).toBe(ECID);
    expect(es.enrollmentId).toBe(ENID);
  });

  it('invariant 3 — enrollmentId is the student-anchor (not (studentId, examId))', () => {
    const es = createExamScoreEntity(TID, ESID, EID, ECID, ENID, SID, buildData());
    // enrollmentId in primary entityKey? No — entityKey uses examScoreId UUID.
    // But enrollmentId IS in GSI1SK + GSI3PK for the cross-year query path.
    expect(es.gsi1sk).toContain(`#${ENID}`);
    expect(es.gsi3pk).toBe(`enrollment#${ENID}`);
  });

  it('tenantId is bare UUID', () => {
    const es = createExamScoreEntity(TID, ESID, EID, ECID, ENID, SID, buildData());
    expect(es.tenantId).toBe(TID);
    expect(es.tenantId.startsWith('TENANT#')).toBe(false);
  });

  it('entityKey uses uppercase EXAM_SCORE# prefix', () => {
    const es = createExamScoreEntity(TID, ESID, EID, ECID, ENID, SID, buildData());
    expect(es.entityKey).toBe(`EXAM_SCORE#${EID}#${ESID}`);
  });

  it('GSI1 (school-scope) keys are lowercase', () => {
    const es = createExamScoreEntity(TID, ESID, EID, ECID, ENID, SID, buildData());
    expect(es.gsi1pk).toBe(`tenant#${TID}#school#${SID}`);
    expect(es.gsi1pk).not.toMatch(/TENANT#/);
    expect(es.gsi1pk).not.toMatch(/SCHOOL#/);
    expect(es.gsi1sk).toBe(`exam-score#${EID}#${ECID}#${ENID}`);
  });

  it('GSI2 (student-centric cross-AY) keys are lowercase', () => {
    const es = createExamScoreEntity(TID, ESID, EID, ECID, ENID, SID, buildData());
    expect(es.gsi2pk).toBe(`student#${STID}`);
    expect(es.gsi2sk).toBe(`exam-score#${AYID}#${TERMID}#${EID}`);
  });

  it('GSI3 (per-enrollment) keys are lowercase', () => {
    const es = createExamScoreEntity(TID, ESID, EID, ECID, ENID, SID, buildData());
    expect(es.gsi3pk).toBe(`enrollment#${ENID}`);
    expect(es.gsi3sk).toBe(`exam-score#${EID}`);
  });

  it('cross-AY query shape: two scores under same studentId in different AYs both indexed via GSI2', () => {
    const es2083 = createExamScoreEntity(TID, ESID, EID, ECID, ENID, SID, buildData({
      academicYearId: '11111111-aaaa-aaaa-aaaa-111111111111',
      termId: TERMID,
    }));
    const es2084 = createExamScoreEntity(TID, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', EID, ECID, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', SID, buildData({
      academicYearId: '22222222-aaaa-aaaa-aaaa-222222222222',
      termId: TERMID,
    }));
    // Both share GSI2PK (same studentId) for transcript lookup
    expect(es2083.gsi2pk).toBe(es2084.gsi2pk);
    // Distinct GSI2SK by academicYearId (chronological ordering)
    expect(es2083.gsi2sk).not.toBe(es2084.gsi2sk);
  });

  it('preserves correlationId when supplied (bulk-write idempotency marker)', () => {
    const corrId = '44444444-4444-4444-4444-444444444444';
    const es = createExamScoreEntity(TID, ESID, EID, ECID, ENID, SID, buildData({
      correlationId: corrId,
    }));
    expect(es.correlationId).toBe(corrId);
  });

  it('locked status persists distinctly from entered', () => {
    const esEntered = createExamScoreEntity(TID, ESID, EID, ECID, ENID, SID, buildData({ status: 'entered' }));
    const esLocked = createExamScoreEntity(TID, 'l'.repeat(36), EID, ECID, ENID, SID, buildData({ status: 'locked' }));
    expect(esEntered.status).toBe('entered');
    expect(esLocked.status).toBe('locked');
  });
});
