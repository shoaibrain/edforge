/**
 * Exam entity spec — Sprint A.3.2
 *
 * Coverage:
 *   - Factory produces correctly-shaped entity
 *   - entityKey + GSI keys (lowercase per S3.2 regression guard)
 *   - tenantId is bare UUID (per memory `edforge_identity_ddb_bare_uuid_partition_key`)
 *   - GSI2 refresh helper for status / startDate changes
 */

import { createExamEntity, refreshExamGsi2sk, Exam } from './exam.entity';

describe('Exam entity (A.3.2)', () => {
  const TID = '21aea5da-511f-4dfa-a6f2-6971f63a719f';
  const SID = '4209e3d8-d2e2-4e0e-9961-790341c264f4';
  const EID = '99999999-9999-9999-9999-999999999999';

  function buildData(): Omit<Exam, 'tenantId' | 'entityKey' | 'entityType' | 'examId' | 'schoolId' | 'gsi1pk' | 'gsi1sk' | 'gsi2pk' | 'gsi2sk'> {
    return {
      examName: 'Term 1 Final',
      academicYearId: '22222222-2222-2222-2222-222222222222',
      termId: '33333333-3333-3333-3333-333333333333',
      examType: 'terminal',
      startDate: '2026-06-01',
      endDate: '2026-06-15',
      status: 'draft',
      isActive: true,
      createdAt: '2026-05-22T10:00:00.000Z',
      createdBy: 'admin-001',
      updatedAt: '2026-05-22T10:00:00.000Z',
      updatedBy: 'admin-001',
      version: 1,
    };
  }

  it('factory produces a fully-keyed entity', () => {
    const exam = createExamEntity(TID, EID, SID, buildData());
    expect(exam.tenantId).toBe(TID);
    expect(exam.examId).toBe(EID);
    expect(exam.schoolId).toBe(SID);
    expect(exam.entityType).toBe('EXAM');
  });

  it('tenantId is the bare UUID (NOT prefixed TENANT#...)', () => {
    const exam = createExamEntity(TID, EID, SID, buildData());
    expect(exam.tenantId).toBe(TID);
    expect(exam.tenantId.startsWith('TENANT#')).toBe(false);
  });

  it('entityKey uses uppercase EXAM# prefix per EntityKeyBuilder convention', () => {
    const exam = createExamEntity(TID, EID, SID, buildData());
    expect(exam.entityKey).toBe(`EXAM#${SID}#${EID}`);
  });

  it('GSI1 keys are lowercase per S3.2 regression guard', () => {
    const exam = createExamEntity(TID, EID, SID, buildData());
    expect(exam.gsi1pk).toBe(`tenant#${TID}#school#${SID}`);
    // gsi1pk + gsi1sk MUST NOT contain uppercase TENANT# / SCHOOL#
    expect(exam.gsi1pk).not.toMatch(/TENANT#/);
    expect(exam.gsi1pk).not.toMatch(/SCHOOL#/);
    expect(exam.gsi1sk).not.toMatch(/TENANT#/);
    expect(exam.gsi1sk).not.toMatch(/SCHOOL#/);
    expect(exam.gsi1sk.startsWith('exam#')).toBe(true);
  });

  it('GSI2 keys are lowercase + term-scoped', () => {
    const exam = createExamEntity(TID, EID, SID, buildData());
    expect(exam.gsi2pk).toBe(`term#${buildData().termId}`);
    expect(exam.gsi2sk).toBe(`exam#draft#2026-06-01`);
  });

  it('GSI2 supports cross-school query (no schoolId in PK)', () => {
    const examA = createExamEntity(TID, EID, SID, buildData());
    const examB = createExamEntity(TID, 'a'.repeat(36), 'b'.repeat(36), buildData());
    // Both exams under the same term share GSI2PK regardless of schoolId
    expect(examA.gsi2pk).toBe(examB.gsi2pk);
  });

  it('refreshExamGsi2sk recomputes correctly on status transition', () => {
    expect(refreshExamGsi2sk('scheduled', '2026-06-01')).toBe('exam#scheduled#2026-06-01');
    expect(refreshExamGsi2sk('closed', '2026-06-01')).toBe('exam#closed#2026-06-01');
  });

  it('factory preserves optional fields (description, totalMaxMarks)', () => {
    const exam = createExamEntity(TID, EID, SID, {
      ...buildData(),
      description: 'Term-end final',
      totalMaxMarks: 500,
    });
    expect(exam.description).toBe('Term-end final');
    expect(exam.totalMaxMarks).toBe(500);
  });
});
