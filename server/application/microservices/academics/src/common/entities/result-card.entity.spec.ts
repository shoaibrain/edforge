/**
 * ResultCard Entity Spec — Sprint A.4.2
 *
 * Covers:
 *   - Factory: keys + audit fields wired correctly
 *   - GSI casing: all gsi*pk/sk produced lowercase per S3.2
 *   - Cross-AY query shape via GSI2 (enrollment#{enrollmentId})
 *   - Invariant 3 keying: entityKey uses enrollmentId NOT studentId
 *   - Invariant 2 denormalization: academicSubject carried on courseScores
 *   - tenantId column: bare UUID (no TENANT#{tid} prefix in stored value)
 */

import { createResultCardEntity, ResultCardCourseScore } from './result-card.entity';

function buildCourseScore(overrides: Partial<ResultCardCourseScore> = {}): ResultCardCourseScore {
  return {
    courseId: 'c-math',
    examCourseId: 'ec-1',
    academicSubject: 'mathematics',
    rawScore: 85,
    maxMarks: 100,
    grade: 'A',
    gpa: 3.6,
    isPassing: true,
    ...overrides,
  };
}

describe('createResultCardEntity', () => {
  it('builds entity with correct keys + RESULT_CARD entityType', () => {
    const card = createResultCardEntity('tenant-uuid', 'card-1', {
      enrollmentId: 'enroll-1',
      examId: 'exam-1',
      termId: 'term-1',
      academicYearId: 'ay-1',
      schoolId: 'school-1',
      studentId: 'student-1',
      courseScores: [buildCourseScore()],
      totalScore: 85,
      totalMaxMarks: 100,
      termGpa: 3.6,
      overallGrade: 'A',
      classRank: null,
      sectionRank: null,
      conduct: null,
      classTeacherRemark: null,
      status: 'draft',
      publishedAt: null,
      publishedBy: null,
      isTerminalExam: false,
      isActive: true,
      createdAt: '2026-06-01T00:00:00.000Z',
      createdBy: 'lambda',
      updatedAt: '2026-06-01T00:00:00.000Z',
      updatedBy: 'lambda',
      version: 1,
    });

    expect(card.entityType).toBe('RESULT_CARD');
    expect(card.cardId).toBe('card-1');
    // Invariant 3: keyed by enrollmentId, NOT studentId
    expect(card.entityKey).toBe('RESULT_CARD#enroll-1#card-1');
    expect(card.entityKey).not.toContain('student-1');
  });

  it('tenantId is bare UUID (no TENANT# prefix per memory)', () => {
    const card = createResultCardEntity('44b58a6f-9b0d-4d6e-b5c0-baseline', 'card-1', {
      enrollmentId: 'e',
      examId: 'x',
      termId: 't',
      academicYearId: 'ay',
      schoolId: 's',
      studentId: 'st',
      courseScores: [],
      totalScore: 0,
      totalMaxMarks: 0,
      termGpa: 0,
      overallGrade: 'NG',
      isTerminalExam: false,
      isActive: true,
      status: 'draft',
      createdAt: 't',
      createdBy: 'u',
      updatedAt: 't',
      updatedBy: 'u',
      version: 1,
    });
    expect(card.tenantId).toBe('44b58a6f-9b0d-4d6e-b5c0-baseline');
    expect(card.tenantId).not.toContain('TENANT#');
  });

  it('GSI keys are lowercase (S3.2 regression guard)', () => {
    const card = createResultCardEntity('tenant-1', 'card-1', {
      enrollmentId: 'enroll-1',
      examId: 'exam-1',
      termId: 'term-1',
      academicYearId: 'ay-1',
      schoolId: 'school-1',
      studentId: 'student-1',
      courseScores: [],
      totalScore: 0,
      totalMaxMarks: 0,
      termGpa: 0,
      overallGrade: 'NG',
      status: 'draft',
      isTerminalExam: false,
      isActive: true,
      createdAt: 't',
      createdBy: 'u',
      updatedAt: 't',
      updatedBy: 'u',
      version: 1,
    });

    expect(card.gsi1pk).toBe('tenant#tenant-1#school#school-1');
    expect(card.gsi1pk).not.toMatch(/TENANT#|SCHOOL#/);
    expect(card.gsi1sk).toBe('result-card#ay-1#term-1#exam-1#enroll-1');
    expect(card.gsi1sk).not.toMatch(/RESULT_CARD#/);
    expect(card.gsi2pk).toBe('enrollment#enroll-1');
    expect(card.gsi2pk).not.toMatch(/ENROLLMENT#/);
    expect(card.gsi2sk).toBe('result-card#ay-1#term-1#exam-1');
    expect(card.gsi3pk).toBe('exam#exam-1');
    expect(card.gsi3pk).not.toMatch(/EXAM#/);
    expect(card.gsi3sk).toBe('result-card#enroll-1');
  });

  it('Invariant 2: courseScores[] denormalizes academicSubject', () => {
    const card = createResultCardEntity('tenant-1', 'card-1', {
      enrollmentId: 'e',
      examId: 'x',
      termId: 't',
      academicYearId: 'ay',
      schoolId: 's',
      studentId: 'st',
      courseScores: [
        buildCourseScore({ academicSubject: 'science' }),
        buildCourseScore({ academicSubject: 'nepali' }),
      ],
      totalScore: 0,
      totalMaxMarks: 0,
      termGpa: 0,
      overallGrade: 'C',
      status: 'draft',
      isTerminalExam: false,
      isActive: true,
      createdAt: 't',
      createdBy: 'u',
      updatedAt: 't',
      updatedBy: 'u',
      version: 1,
    });

    expect(card.courseScores).toHaveLength(2);
    expect(card.courseScores[0].academicSubject).toBe('science');
    expect(card.courseScores[1].academicSubject).toBe('nepali');
  });

  it('GSI2 enables cross-AY enrollment-centric query shape', () => {
    const ay1 = createResultCardEntity('tenant-1', 'card-ay1', {
      enrollmentId: 'enroll-a',
      examId: 'exam-ay1',
      termId: 'term-1',
      academicYearId: 'ay-2025',
      schoolId: 'school-1',
      studentId: 'student-1',
      courseScores: [],
      totalScore: 0,
      totalMaxMarks: 0,
      termGpa: 0,
      overallGrade: 'C',
      status: 'draft',
      isTerminalExam: false,
      isActive: true,
      createdAt: 't',
      createdBy: 'u',
      updatedAt: 't',
      updatedBy: 'u',
      version: 1,
    });

    const ay2 = createResultCardEntity('tenant-1', 'card-ay2', {
      enrollmentId: 'enroll-b',                 // DIFFERENT enrollmentId in AY2 (invariant 3)
      examId: 'exam-ay2',
      termId: 'term-1',
      academicYearId: 'ay-2026',
      schoolId: 'school-1',
      studentId: 'student-1',                   // SAME student
      courseScores: [],
      totalScore: 0,
      totalMaxMarks: 0,
      termGpa: 0,
      overallGrade: 'B',
      status: 'draft',
      isTerminalExam: false,
      isActive: true,
      createdAt: 't',
      createdBy: 'u',
      updatedAt: 't',
      updatedBy: 'u',
      version: 1,
    });

    // GSI2 partitions on enrollmentId — distinct partitions per AY
    expect(ay1.gsi2pk).toBe('enrollment#enroll-a');
    expect(ay2.gsi2pk).toBe('enrollment#enroll-b');
    expect(ay1.gsi2pk).not.toBe(ay2.gsi2pk);

    // Same exam keyed cards across AY would share GSI3 PK if same exam,
    // but here exam differs by AY so they don't.
    expect(ay1.gsi3pk).not.toBe(ay2.gsi3pk);
  });
});
