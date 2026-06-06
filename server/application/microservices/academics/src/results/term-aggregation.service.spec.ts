/**
 * Term Aggregation Service Spec — Sprint A.4.1
 *
 * Covers:
 *   - Pure function assertion: no DDB SDK imports anywhere in
 *     term-aggregation.service.ts (enforced by source-text grep)
 *   - Archetype-blind: zero `tenant.archetype` reads (enforced by
 *     source-text grep against archetype-related accessors)
 *   - Per-course derivation: rawScore → percentage → letterGradeEntry
 *   - Boundary: rawScore = passingMarks (passing) vs passingMarks-1 (failing)
 *   - Missing score → NG / Not-Graded sentinel
 *   - Weighted termGpa via creditHours
 *   - **R42 mitigation:** studentId is sourced from Enrollment, not ExamScore
 *   - Empty inputs (no courses → 0/0/0; no scores → all-NG)
 */

import { Test, TestingModule } from '@nestjs/testing';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
  TermAggregationService,
  deriveLetterForPercentage,
  resolveNotGradedLetter,
} from './term-aggregation.service';
import type { LetterGradeEntryDto } from '@aibrains/shared-types';
import { Exam } from '../common/entities/exam.entity';
import { ExamCourse } from '../common/entities/exam-course.entity';
import { ExamScore } from '../common/entities/exam-score.entity';
import { Enrollment } from '../common/entities/enrollment.entity';
import { GradingPolicyEntity } from '../common/entities/grading-policy.entity';

// ============================================
// Fixtures — Nepal CEHRD scale per D.1 PABSON profile
// ============================================

const PABSON_LETTERS: LetterGradeEntryDto[] = [
  { letter: 'A+', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0, isPassing: true },
  { letter: 'A',  minPercentage: 80, maxPercentage: 89,  gpaPoints: 3.6, isPassing: true },
  { letter: 'B+', minPercentage: 70, maxPercentage: 79,  gpaPoints: 3.2, isPassing: true },
  { letter: 'B',  minPercentage: 60, maxPercentage: 69,  gpaPoints: 2.8, isPassing: true },
  { letter: 'C+', minPercentage: 50, maxPercentage: 59,  gpaPoints: 2.4, isPassing: true },
  { letter: 'C',  minPercentage: 40, maxPercentage: 49,  gpaPoints: 2.0, isPassing: true },
  { letter: 'D',  minPercentage: 32, maxPercentage: 39,  gpaPoints: 1.6, isPassing: true },
  { letter: 'E',  minPercentage: 0,  maxPercentage: 31,  gpaPoints: 0.8, isPassing: false },
  { letter: 'NG', minPercentage: 0,  maxPercentage: 0,   gpaPoints: 0,   isPassing: false, isTerminalFail: true },
];

function buildGradingPolicy(overrides: Partial<GradingPolicyEntity> = {}): GradingPolicyEntity {
  return {
    tenantId: 'tenant-1',
    entityKey: 'GRADEPOLICY#school-1#policy-1',
    entityType: 'GRADEPOLICY',
    policyId: 'policy-1',
    schoolId: 'school-1',
    policyName: 'PABSON CEHRD',
    gpaScale: '4.0',
    letterGrades: PABSON_LETTERS,
    categoryWeights: [],
    roundingRule: 'nearest',
    minimumPassingGrade: 32,
    isDefault: true,
    isActive: true,
    gsi1pk: 'TENANT#tenant-1#SCHOOL#school-1',
    gsi1sk: 'GRADEPOLICY#PABSON CEHRD',
    createdAt: '2026-01-01T00:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-01-01T00:00:00.000Z',
    updatedBy: 'system',
    version: 1,
    ...overrides,
  };
}

function buildExam(overrides: Partial<Exam> = {}): Exam {
  return {
    tenantId: 'tenant-1',
    entityKey: 'EXAM#school-1#exam-1',
    entityType: 'EXAM',
    examId: 'exam-1',
    examName: 'Term-1',
    schoolId: 'school-1',
    academicYearId: 'ay-1',
    termId: 'term-1',
    examType: 'terminal',
    startDate: '2026-06-01',
    endDate: '2026-06-10',
    status: 'closed',
    isActive: true,
    gsi1pk: 'tenant#tenant-1#school#school-1',
    gsi1sk: 'exam#ay-1#term-1#TERM-1',
    gsi2pk: 'term#term-1',
    gsi2sk: 'exam#closed#2026-06-01',
    createdAt: '2026-05-01T00:00:00.000Z',
    createdBy: 'user-1',
    updatedAt: '2026-05-01T00:00:00.000Z',
    updatedBy: 'user-1',
    version: 1,
    ...overrides,
  };
}

function buildExamCourse(
  examCourseId: string,
  courseId: string,
  maxMarks: number,
  overrides: Partial<ExamCourse> = {},
): ExamCourse {
  return {
    tenantId: 'tenant-1',
    entityKey: `EXAM_COURSE#exam-1#${examCourseId}`,
    entityType: 'EXAM_COURSE',
    examCourseId,
    examId: 'exam-1',
    schoolId: 'school-1',
    courseId,
    courseName: `Course-${courseId}`,
    courseCode: courseId.toUpperCase(),
    academicSubject: 'mathematics',
    maxMarks,
    passingMarks: 32,
    creditHours: 1,
    isActive: true,
    gsi1pk: 'tenant#tenant-1#school#school-1',
    gsi1sk: `exam-course#exam-1#${courseId.toUpperCase()}`,
    gsi2pk: 'exam#exam-1',
    gsi2sk: `course#${courseId.toUpperCase()}`,
    createdAt: '2026-05-01T00:00:00.000Z',
    createdBy: 'user-1',
    updatedAt: '2026-05-01T00:00:00.000Z',
    updatedBy: 'user-1',
    version: 1,
    ...overrides,
  } as ExamCourse;
}

function buildExamScore(
  examScoreId: string,
  examCourseId: string,
  enrollmentId: string,
  rawScore: number,
  overrides: Partial<ExamScore> = {},
): ExamScore {
  return {
    tenantId: 'tenant-1',
    entityKey: `EXAM_SCORE#exam-1#${examScoreId}`,
    entityType: 'EXAM_SCORE',
    examScoreId,
    examId: 'exam-1',
    examCourseId,
    enrollmentId,
    schoolId: 'school-1',
    studentId: 'unknown',                       // R42: bulk-handler default
    rawScore,
    status: 'locked',
    enteredBy: 'user-1',
    enteredAt: '2026-06-01T00:00:00.000Z',
    isActive: true,
    gsi1pk: 'tenant#tenant-1#school#school-1',
    gsi1sk: `exam-score#exam-1#${examCourseId}#${enrollmentId}`,
    gsi2pk: 'student#unknown',
    gsi2sk: 'exam-score#ay-1#term-1#exam-1',
    gsi3pk: `enrollment#${enrollmentId}`,
    gsi3sk: 'exam-score#exam-1',
    createdAt: '2026-06-01T00:00:00.000Z',
    createdBy: 'user-1',
    updatedAt: '2026-06-01T00:00:00.000Z',
    updatedBy: 'user-1',
    version: 1,
    ...overrides,
  } as ExamScore;
}

function buildEnrollment(enrollmentId: string, studentId: string): Enrollment {
  return {
    tenantId: 'tenant-1',
    entityKey: `ENROLLMENT#school-1#ay-1#${studentId}`,
    entityType: 'ENROLLMENT',
    enrollmentId,
    studentId,
    schoolId: 'school-1',
    academicYearId: 'ay-1',
    gradeLevel: '9',
    enrollmentDate: '2026-04-01',
    status: 'enrolled',
    isActive: true,
    createdAt: '2026-04-01T00:00:00.000Z',
    createdBy: 'system',
    updatedAt: '2026-04-01T00:00:00.000Z',
    updatedBy: 'system',
    version: 1,
  } as unknown as Enrollment;
}

// ============================================
// Pure function structural assertions
// ============================================

describe('term-aggregation source-text invariants', () => {
  const rawSrc = readFileSync(
    join(__dirname, 'term-aggregation.service.ts'),
    'utf8',
  );

  // Strip all comments (both /* ... */ and // ...) so we only inspect
  // executable code — the doc-comments above explicitly mention
  // `tenant.archetype` and `TenantMetadataReader` as anti-patterns,
  // which would false-positive the grep otherwise.
  const src = rawSrc
    .replace(/\/\*[\s\S]*?\*\//g, '')              // block comments
    .replace(/^\s*\/\/.*$/gm, '');                 // line comments

  it('has zero DynamoDB SDK imports (pure-function invariant)', () => {
    expect(src).not.toMatch(/@aws-sdk\/client-dynamodb/);
    expect(src).not.toMatch(/@aws-sdk\/lib-dynamodb/);
    expect(src).not.toMatch(/DynamoDBClientService/);
  });

  it('has zero tenant.archetype reads (invariant 12)', () => {
    expect(src).not.toMatch(/tenant\.archetype/);
    expect(src).not.toMatch(/TenantMetadataReader/);
    expect(src).not.toMatch(/archetype\s*===\s*['"]/);
    expect(src).not.toMatch(/getArchetypeDefaults/);
  });

  it('has zero pilot-specific names (invariant 13)', () => {
    expect(src).not.toMatch(/saraswati/i);
    expect(src).not.toMatch(/pabson-saraswati/i);
  });
});

// ============================================
// deriveLetterForPercentage
// ============================================

describe('deriveLetterForPercentage', () => {
  it('finds A+ for 100%', () => {
    expect(deriveLetterForPercentage(100, PABSON_LETTERS).letter).toBe('A+');
  });

  it('finds A+ for 90% (boundary)', () => {
    expect(deriveLetterForPercentage(90, PABSON_LETTERS).letter).toBe('A+');
  });

  it('finds A for 89% (boundary)', () => {
    expect(deriveLetterForPercentage(89, PABSON_LETTERS).letter).toBe('A');
  });

  it('finds D for 32% (passing boundary)', () => {
    const e = deriveLetterForPercentage(32, PABSON_LETTERS);
    expect(e.letter).toBe('D');
    expect(e.isPassing).toBe(true);
  });

  it('finds E for 31% (failing boundary)', () => {
    const e = deriveLetterForPercentage(31, PABSON_LETTERS);
    expect(e.letter).toBe('E');
    expect(e.isPassing).toBe(false);
  });

  it('finds the lowest entry for 0%', () => {
    // PABSON_LETTERS has both E (0-31) and NG (0-0) at minPercentage=0;
    // first match in the list (E) is what the function returns.
    expect(deriveLetterForPercentage(0, PABSON_LETTERS).letter).toBe('E');
  });

  it('falls back to lowest entry for out-of-range percentage (>100)', () => {
    expect(deriveLetterForPercentage(150, PABSON_LETTERS).letter).toBeDefined();
  });

  it('throws when letterGrades is empty', () => {
    expect(() => deriveLetterForPercentage(80, [])).toThrow(/empty/);
  });
});

// ============================================
// resolveNotGradedLetter
// ============================================

describe('resolveNotGradedLetter', () => {
  it('returns the NG entry when isTerminalFail is defined', () => {
    expect(resolveNotGradedLetter(PABSON_LETTERS).letter).toBe('NG');
  });

  it('falls back to first non-passing when no isTerminalFail entry', () => {
    const noNg = PABSON_LETTERS.filter((l) => !l.isTerminalFail);
    expect(resolveNotGradedLetter(noNg).letter).toBe('E');
  });
});

// ============================================
// Main aggregation
// ============================================

describe('TermAggregationService.aggregateTermResults', () => {
  let service: TermAggregationService;

  beforeEach(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      providers: [TermAggregationService],
    }).compile();
    service = moduleRef.get(TermAggregationService);
  });

  it('aggregates one enrollment with full scores → correct totals + termGpa', () => {
    const exam = buildExam();
    const ec1 = buildExamCourse('ec-1', 'c-math', 100);
    const ec2 = buildExamCourse('ec-2', 'c-eng', 100, { creditHours: 2 });
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-real-1')],
    ]);
    const scores = [
      buildExamScore('s-1', 'ec-1', 'enroll-1', 85),     // A, gpa 3.6
      buildExamScore('s-2', 'ec-2', 'enroll-1', 75),     // B+, gpa 3.2
    ];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec1, ec2],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });

    expect(out.perEnrollment).toHaveLength(1);
    const row = out.perEnrollment[0];
    expect(row.totalScore).toBe(160);
    expect(row.totalMaxMarks).toBe(200);
    // Weighted: (3.6 * 1 + 3.2 * 2) / (1 + 2) = (3.6 + 6.4) / 3 = 10.0 / 3 ≈ 3.333
    expect(row.termGpa).toBeCloseTo(3.333, 2);
    // Overall percentage = 160/200 * 100 = 80% → A
    expect(row.overallGrade).toBe('A');
    expect(row.courseScores).toHaveLength(2);
  });

  const DIVISION_BANDS = [
    { label: 'Distinction', minPercentage: 85 },
    { label: 'First Division', minPercentage: 65 },
    { label: 'Second Division', minPercentage: 50 },
    { label: 'Third Division', minPercentage: 40 },
  ];

  it('P1.5a division scheme: pass all subjects → division band + percentage', () => {
    const exam = buildExam();
    const ec1 = buildExamCourse('ec-1', 'c-math', 100, { passingMarks: 40 });
    const ec2 = buildExamCourse('ec-2', 'c-eng', 100, { passingMarks: 40 });
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-real-1')],
    ]);
    const scores = [
      buildExamScore('s-1', 'ec-1', 'enroll-1', 80),
      buildExamScore('s-2', 'ec-2', 'enroll-1', 50),
    ];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec1, ec2],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy({ schemeType: 'division', divisions: DIVISION_BANDS }),
      isTerminalExam: false,
    });

    const row = out.perEnrollment[0];
    // 130/200 = 65% → First Division; both subjects ≥ passingMarks(40) → pass
    expect(row.percentage).toBe(65);
    expect(row.result).toBe('pass');
    expect(row.division).toBe('First Division');
  });

  it('P1.5a division scheme: fail any subject → result fail, division withheld', () => {
    const exam = buildExam();
    const ec1 = buildExamCourse('ec-1', 'c-math', 100, { passingMarks: 40 });
    const ec2 = buildExamCourse('ec-2', 'c-eng', 100, { passingMarks: 40 });
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-real-1')],
    ]);
    const scores = [
      buildExamScore('s-1', 'ec-1', 'enroll-1', 80),
      buildExamScore('s-2', 'ec-2', 'enroll-1', 30), // below passingMarks(40)
    ];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec1, ec2],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy({ schemeType: 'division', divisions: DIVISION_BANDS }),
      isTerminalExam: false,
    });

    const row = out.perEnrollment[0];
    expect(row.result).toBe('fail');
    expect(row.division).toBeNull();
  });

  it('P1.5a division scheme: missing score for a subject (NG) → result fail, division withheld', () => {
    const exam = buildExam();
    const ec1 = buildExamCourse('ec-1', 'c-math', 100, { passingMarks: 40 });
    const ec2 = buildExamCourse('ec-2', 'c-eng', 100, { passingMarks: 40 });
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-real-1')],
    ]);
    // Only ec-1 has a score; ec-2 is ungraded (no ExamScore row at all).
    const scores = [
      buildExamScore('s-1', 'ec-1', 'enroll-1', 90),
    ];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec1, ec2],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy({ schemeType: 'division', divisions: DIVISION_BANDS }),
      isTerminalExam: false,
    });

    const row = out.perEnrollment[0];
    expect(row.result).toBe('fail');
    expect(row.division).toBeNull();
  });

  it('P1.5b components: theory+practical both pass → subject pass + components breakdown', () => {
    const exam = buildExam();
    // Pre-Voc-style split: theory 100/40 + practical 50/20; subject maxMarks 150.
    const ec = buildExamCourse('ec-pv', 'c-pv', 150, {
      passingMarks: 60,
      components: [
        { code: 'theory', label: 'Theory', fullMarks: 100, passMarks: 40 },
        { code: 'practical', label: 'Practical', fullMarks: 50, passMarks: 20 },
      ],
    });
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-real-1')],
    ]);
    // theory 78 (≥40 ✓), practical 41 (≥20 ✓); rawScore = 119.
    const scores = [
      buildExamScore('s-1', 'ec-pv', 'enroll-1', 119, {
        componentScores: { theory: 78, practical: 41 },
      }),
    ];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy({ schemeType: 'division', divisions: DIVISION_BANDS }),
      isTerminalExam: false,
    });

    const cs = out.perEnrollment[0].courseScores[0];
    expect(cs.pass).toBe(true);
    expect(cs.passMarks).toBe(60);
    expect(cs.components).toHaveLength(2);
    expect(cs.components![0]).toMatchObject({ code: 'theory', obtained: 78, pass: true });
    expect(cs.components![1]).toMatchObject({ code: 'practical', obtained: 41, pass: true });
    // 119/150 = 79.33% → First Division
    expect(out.perEnrollment[0].result).toBe('pass');
    expect(out.perEnrollment[0].division).toBe('First Division');
  });

  it('P1.5b components: failing ONE component fails the subject (Nepal rule) → result fail', () => {
    const exam = buildExam();
    const ec = buildExamCourse('ec-pv', 'c-pv', 150, {
      passingMarks: 60,
      components: [
        { code: 'theory', label: 'Theory', fullMarks: 100, passMarks: 40 },
        { code: 'practical', label: 'Practical', fullMarks: 50, passMarks: 20 },
      ],
    });
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-real-1')],
    ]);
    // theory 90 (✓) but practical 15 (<20 ✗) — subject total 105 ≥ passingMarks(60)
    // would pass a flat check, but the per-component rule must FAIL the subject.
    const scores = [
      buildExamScore('s-1', 'ec-pv', 'enroll-1', 105, {
        componentScores: { theory: 90, practical: 15 },
      }),
    ];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy({ schemeType: 'division', divisions: DIVISION_BANDS }),
      isTerminalExam: false,
    });

    const cs = out.perEnrollment[0].courseScores[0];
    expect(cs.pass).toBe(false);
    expect(cs.components![1]).toMatchObject({ code: 'practical', obtained: 15, pass: false });
    expect(out.perEnrollment[0].result).toBe('fail');
    expect(out.perEnrollment[0].division).toBeNull();
  });

  it('P1b Absent: missing score row → notGraded course-score (distinct non-failing state)', () => {
    const exam = buildExam();
    const ec1 = buildExamCourse('ec-1', 'c-math', 100, { passingMarks: 40 });
    const ec2 = buildExamCourse('ec-2', 'c-eng', 100, { passingMarks: 40 });
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-real-1')],
    ]);
    const scores = [buildExamScore('s-1', 'ec-1', 'enroll-1', 80)]; // ec-2 absent

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec1, ec2],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy({ schemeType: 'division', divisions: DIVISION_BANDS }),
      isTerminalExam: false,
    });

    const absent = out.perEnrollment[0].courseScores.find((c) => c.examCourseId === 'ec-2')!;
    expect(absent.notGraded).toBe(true);
    expect(absent.pass).toBe(false);
    expect(absent.rawScore).toBe(0);
    // Absent must not inflate the obtained total (only graded subjects count).
    expect(out.perEnrollment[0].totalScore).toBe(80);
    // and it withholds the division (a roster row with a gap is not a pass).
    expect(out.perEnrollment[0].result).toBe('fail');
  });

  it('P1a: carries subjectArea + courseName and never emits an "unknown" subject', () => {
    // Course created with only the required subjectArea (no granular academicSubject) —
    // exactly the ENG/NEP case that previously rendered "unknown".
    const exam = buildExam();
    const ec = buildExamCourse('ec-nep', 'c-nep', 100, {
      academicSubject: undefined,
      subjectArea: 'world_languages',
      courseName: 'Nepali (incl. Vyakaran)',
    });
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-real-1')],
    ]);
    const scores = [buildExamScore('s-1', 'ec-nep', 'enroll-1', 80)];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });

    const cs = out.perEnrollment[0].courseScores[0];
    expect(cs.academicSubject).toBeUndefined();
    expect(cs.subjectArea).toBe('world_languages');
    expect(cs.courseName).toBe('Nepali (incl. Vyakaran)');
    // The renderer resolves academicSubject ?? subjectArea ?? courseName — never 'unknown'.
    expect(cs.academicSubject ?? cs.subjectArea ?? cs.courseName).not.toBe('unknown');
  });

  it('R42 mitigation: resolves studentId from Enrollment, not ExamScore', () => {
    // ExamScore carries studentId='unknown' (A.3 bulk default)
    // Enrollment carries the correct value
    // ResultCard MUST surface the Enrollment value
    const exam = buildExam();
    const ec = buildExamCourse('ec-1', 'c-math', 100);
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-real-r42')],
    ]);
    const scores = [
      buildExamScore('s-1', 'ec-1', 'enroll-1', 85, { studentId: 'unknown' }),
    ];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });

    expect(out.perEnrollment[0].studentId).toBe('student-real-r42');
    expect(out.perEnrollment[0].studentId).not.toBe('unknown');
  });

  it('missing ExamScore for an ExamCourse → NG row', () => {
    const exam = buildExam();
    const ec1 = buildExamCourse('ec-1', 'c-math', 100);
    const ec2 = buildExamCourse('ec-2', 'c-eng', 100);
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-1')],
    ]);
    // Only score for ec-1; ec-2 missing
    const scores = [buildExamScore('s-1', 'ec-1', 'enroll-1', 85)];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec1, ec2],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });

    const row = out.perEnrollment[0];
    expect(row.courseScores).toHaveLength(2);
    const missing = row.courseScores.find((cs) => cs.examCourseId === 'ec-2');
    expect(missing).toBeDefined();
    expect(missing!.grade).toBe('NG');
    expect(missing!.isPassing).toBe(false);
    expect(missing!.isTerminalFail).toBe(true);
    expect(missing!.rawScore).toBe(0);
    // totalMaxMarks still counts the missing course (the student "was due to take it")
    expect(row.totalMaxMarks).toBe(200);
    expect(row.totalScore).toBe(85);
  });

  it('boundary: rawScore = passing (32% of 100) → D and isPassing=true', () => {
    const exam = buildExam();
    const ec = buildExamCourse('ec-1', 'c-math', 100);
    const enrollments = new Map([['enroll-1', buildEnrollment('enroll-1', 'student-1')]]);
    const scores = [buildExamScore('s-1', 'ec-1', 'enroll-1', 32)];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });

    expect(out.perEnrollment[0].courseScores[0].grade).toBe('D');
    expect(out.perEnrollment[0].courseScores[0].isPassing).toBe(true);
  });

  it('boundary: rawScore = passing - 1 (31% of 100) → E and isPassing=false', () => {
    const exam = buildExam();
    const ec = buildExamCourse('ec-1', 'c-math', 100);
    const enrollments = new Map([['enroll-1', buildEnrollment('enroll-1', 'student-1')]]);
    const scores = [buildExamScore('s-1', 'ec-1', 'enroll-1', 31)];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });

    expect(out.perEnrollment[0].courseScores[0].grade).toBe('E');
    expect(out.perEnrollment[0].courseScores[0].isPassing).toBe(false);
  });

  it('aggregates multiple enrollments independently', () => {
    const exam = buildExam();
    const ec = buildExamCourse('ec-1', 'c-math', 100);
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-1')],
      ['enroll-2', buildEnrollment('enroll-2', 'student-2')],
      ['enroll-3', buildEnrollment('enroll-3', 'student-3')],
    ]);
    const scores = [
      buildExamScore('s-1', 'ec-1', 'enroll-1', 95),
      buildExamScore('s-2', 'ec-1', 'enroll-2', 65),
      buildExamScore('s-3', 'ec-1', 'enroll-3', 25),
    ];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });

    expect(out.perEnrollment).toHaveLength(3);
    const byEnroll = new Map(out.perEnrollment.map((r) => [r.enrollmentId, r]));
    expect(byEnroll.get('enroll-1')!.overallGrade).toBe('A+');
    expect(byEnroll.get('enroll-2')!.overallGrade).toBe('B');
    expect(byEnroll.get('enroll-3')!.overallGrade).toBe('E');
    expect(byEnroll.get('enroll-3')!.courseScores[0].isPassing).toBe(false);
  });

  it('flags isTerminalExam through to every aggregation row', () => {
    const exam = buildExam();
    const ec = buildExamCourse('ec-1', 'c-math', 100);
    const enrollments = new Map([['enroll-1', buildEnrollment('enroll-1', 'student-1')]]);

    const terminalOut = service.aggregateTermResults({
      exam,
      examCourses: [ec],
      examScores: [buildExamScore('s-1', 'ec-1', 'enroll-1', 50)],
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: true,
    });
    expect(terminalOut.perEnrollment[0].isTerminalExam).toBe(true);

    const nonTerminalOut = service.aggregateTermResults({
      exam,
      examCourses: [ec],
      examScores: [buildExamScore('s-1', 'ec-1', 'enroll-1', 50)],
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });
    expect(nonTerminalOut.perEnrollment[0].isTerminalExam).toBe(false);
  });

  it('empty enrollments → empty perEnrollment[]', () => {
    const out = service.aggregateTermResults({
      exam: buildExam(),
      examCourses: [buildExamCourse('ec-1', 'c-math', 100)],
      examScores: [],
      enrollments: new Map(),
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });
    expect(out.perEnrollment).toHaveLength(0);
  });

  it('empty examCourses → enrollment row with 0/0/0', () => {
    const out = service.aggregateTermResults({
      exam: buildExam(),
      examCourses: [],
      examScores: [],
      enrollments: new Map([['enroll-1', buildEnrollment('enroll-1', 'student-1')]]),
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });
    expect(out.perEnrollment[0].courseScores).toHaveLength(0);
    expect(out.perEnrollment[0].totalScore).toBe(0);
    expect(out.perEnrollment[0].totalMaxMarks).toBe(0);
    expect(out.perEnrollment[0].termGpa).toBe(0);
  });

  it('enrollment with NO scores at all → all-NG courseScores[]', () => {
    const exam = buildExam();
    const ec1 = buildExamCourse('ec-1', 'c-math', 100);
    const ec2 = buildExamCourse('ec-2', 'c-eng', 100);
    const enrollments = new Map([
      ['enroll-1', buildEnrollment('enroll-1', 'student-no-show')],
    ]);

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec1, ec2],
      examScores: [],
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });

    const row = out.perEnrollment[0];
    expect(row.courseScores).toHaveLength(2);
    row.courseScores.forEach((cs) => {
      expect(cs.grade).toBe('NG');
      expect(cs.isPassing).toBe(false);
    });
    expect(row.totalScore).toBe(0);
    expect(row.totalMaxMarks).toBe(200);  // courses still counted
  });

  it('throws when GradingPolicy.letterGrades is empty', () => {
    expect(() =>
      service.aggregateTermResults({
        exam: buildExam(),
        examCourses: [],
        examScores: [],
        enrollments: new Map(),
        gradingPolicy: buildGradingPolicy({ letterGrades: [] }),
        isTerminalExam: false,
      }),
    ).toThrow(/no letterGrades/);
  });

  it('respects creditHours weighting in termGpa', () => {
    const exam = buildExam();
    const ec1 = buildExamCourse('ec-1', 'c-math', 100, { creditHours: 3 });   // weight 3
    const ec2 = buildExamCourse('ec-2', 'c-eng', 100, { creditHours: 1 });    // weight 1
    const enrollments = new Map([['enroll-1', buildEnrollment('enroll-1', 'student-1')]]);
    const scores = [
      buildExamScore('s-1', 'ec-1', 'enroll-1', 95),    // A+, gpa 4.0
      buildExamScore('s-2', 'ec-2', 'enroll-1', 50),    // C+, gpa 2.4
    ];

    const out = service.aggregateTermResults({
      exam,
      examCourses: [ec1, ec2],
      examScores: scores,
      enrollments,
      gradingPolicy: buildGradingPolicy(),
      isTerminalExam: false,
    });

    // Weighted: (4.0 * 3 + 2.4 * 1) / (3 + 1) = (12.0 + 2.4) / 4 = 14.4 / 4 = 3.6
    expect(out.perEnrollment[0].termGpa).toBeCloseTo(3.6, 2);
  });
});
