/**
 * Result-Batch Lambda Spec — Sprint A.4.3 Phase 3
 *
 * Covers:
 *   - Happy path: 2 enrollments × 2 ExamCourses + scores → 2 ResultCards written
 *   - isTerminal heuristic: examType='final' → true, examType='unit_test' → false
 *   - R42: studentId from Enrollment, NOT from ExamScore
 *   - Idempotent re-fire: ConditionalCheckFailed → skipped (NOT error)
 *   - Defensive: toStatus != 'closed' → early no-op return
 *   - Exam not found → throws
 *   - No default GradingPolicy → throws
 *
 * Mocks the AWS SDK DynamoDB client. The pure-function aggregation
 * (term-aggregation.ts) is exercised inline; its own spec lives in
 * `microservices/academics/src/results/term-aggregation.service.spec.ts`.
 */

import { mockClient } from 'aws-sdk-client-mock';
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { marshall } from '@aws-sdk/util-dynamodb';

import { handler } from './handler';
import type { EventBridgeExamStatusTransitioned } from '../shared/types';

const ddbMock = mockClient(DynamoDBClient);

const TENANT = 'tenant-1';
const SCHOOL = '11111111-1111-1111-1111-111111111111';
const EXAM = '22222222-2222-2222-2222-222222222222';
const AY = '33333333-3333-3333-3333-333333333333';
const TERM = '44444444-4444-4444-4444-444444444444';

const PABSON_LETTERS = [
  { letter: 'A+', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0, isPassing: true },
  { letter: 'A', minPercentage: 80, maxPercentage: 89, gpaPoints: 3.6, isPassing: true },
  { letter: 'B', minPercentage: 60, maxPercentage: 79, gpaPoints: 2.8, isPassing: true },
  { letter: 'D', minPercentage: 32, maxPercentage: 59, gpaPoints: 1.6, isPassing: true },
  { letter: 'E', minPercentage: 0, maxPercentage: 31, gpaPoints: 0.8, isPassing: false },
  {
    letter: 'NG',
    minPercentage: 0,
    maxPercentage: 0,
    gpaPoints: 0,
    isPassing: false,
    isTerminalFail: true,
  },
];

function buildEvent(
  toStatus = 'closed',
): EventBridgeExamStatusTransitioned {
  return {
    source: 'edforge.academics-service',
    'detail-type': 'ExamStatusTransitioned',
    detail: {
      eventType: 'ExamStatusTransitioned',
      timestamp: '2026-06-01T12:00:00.000Z',
      tenantId: TENANT,
      examId: EXAM,
      schoolId: SCHOOL,
      fromStatus: 'in_progress',
      toStatus,
    },
  };
}

function setupHappyPath(
  examType: 'final' | 'unit_test' = 'final',
): void {
  // Exam row
  ddbMock.on(GetItemCommand).resolves({
    Item: marshall({
      examId: EXAM,
      schoolId: SCHOOL,
      academicYearId: AY,
      termId: TERM,
      examType,
      isActive: true,
    }),
  });

  // Order matters: ExamCourses (GSI2), ExamScores (GSI1 exam-score#), Enrollments (GSI1 ENROLLMENT#), Policy (GSI1 GRADEPOLICY#)
  ddbMock
    .on(QueryCommand)
    // ExamCourses
    .resolvesOnce({
      Items: [
        marshall({
          examCourseId: 'ec-1',
          courseId: 'c-math',
          academicSubject: 'mathematics',
          maxMarks: 100,
          creditHours: 1,
          isActive: true,
        }),
        marshall({
          examCourseId: 'ec-2',
          courseId: 'c-eng',
          academicSubject: 'english',
          maxMarks: 100,
          creditHours: 1,
          isActive: true,
        }),
      ],
    })
    // ExamScores
    .resolvesOnce({
      Items: [
        marshall({
          examCourseId: 'ec-1',
          enrollmentId: 'enroll-1',
          rawScore: 85,
          isActive: true,
        }),
        marshall({
          examCourseId: 'ec-2',
          enrollmentId: 'enroll-1',
          rawScore: 75,
          isActive: true,
        }),
        marshall({
          examCourseId: 'ec-1',
          enrollmentId: 'enroll-2',
          rawScore: 50,
          isActive: true,
        }),
        marshall({
          examCourseId: 'ec-2',
          enrollmentId: 'enroll-2',
          rawScore: 45,
          isActive: true,
        }),
      ],
    })
    // Enrollments — note: ExamScore.studentId='unknown' would be irrelevant;
    // Lambda resolves studentId from this Enrollment row (R42 mitigation).
    .resolvesOnce({
      Items: [
        marshall({
          enrollmentId: 'enroll-1',
          studentId: 'student-real-1',
          isActive: true,
        }),
        marshall({
          enrollmentId: 'enroll-2',
          studentId: 'student-real-2',
          isActive: true,
        }),
      ],
    })
    // GradingPolicy
    .resolvesOnce({
      Items: [
        marshall({
          policyId: 'policy-1',
          letterGrades: PABSON_LETTERS,
          isDefault: true,
          isActive: true,
        }),
      ],
    });

  ddbMock.on(TransactWriteItemsCommand).resolves({});
}

describe('result-batch-lambda', () => {
  beforeEach(() => {
    ddbMock.reset();
  });

  it('happy path: 2 enrollments × 2 courses → 2 ResultCards written', async () => {
    setupHappyPath('final');
    const result = await handler(buildEvent(), {} as any, () => {});
    expect(result).toBeDefined();
    if (!result) throw new Error('handler returned undefined');
    expect(result.cardsCreated).toBe(2);
    expect(result.cardsSkippedIdempotent).toBe(0);
    expect(result.chunksWritten).toBe(1);
    expect(result.enrollmentsAggregated).toBe(2);
    expect(ddbMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(1);
  });

  it('R42: studentId on ResultCard is from Enrollment, not ExamScore', async () => {
    setupHappyPath('final');
    await handler(buildEvent(), {} as any, () => {});
    const txn = ddbMock.commandCalls(TransactWriteItemsCommand)[0]?.args[0]?.input;
    const items = (txn?.TransactItems ?? []).map((t) => t.Put?.Item);
    const studentIds = items
      .map((i) => i?.studentId?.S)
      .filter((v): v is string => !!v);
    expect(studentIds.sort()).toEqual(['student-real-1', 'student-real-2']);
    expect(studentIds).not.toContain('unknown');
  });

  it('isTerminal: examType=final → ResultCard.isTerminalExam = true', async () => {
    setupHappyPath('final');
    await handler(buildEvent(), {} as any, () => {});
    const txn = ddbMock.commandCalls(TransactWriteItemsCommand)[0]?.args[0]?.input;
    const items = (txn?.TransactItems ?? []).map((t) => t.Put?.Item);
    items.forEach((item) => {
      expect(item?.isTerminalExam?.BOOL).toBe(true);
    });
  });

  it('isTerminal: examType=unit_test → ResultCard.isTerminalExam = false', async () => {
    setupHappyPath('unit_test');
    await handler(buildEvent(), {} as any, () => {});
    const txn = ddbMock.commandCalls(TransactWriteItemsCommand)[0]?.args[0]?.input;
    const items = (txn?.TransactItems ?? []).map((t) => t.Put?.Item);
    items.forEach((item) => {
      expect(item?.isTerminalExam?.BOOL).toBe(false);
    });
  });

  it('TransactWrite includes attribute_not_exists guard for idempotency', async () => {
    setupHappyPath('final');
    await handler(buildEvent(), {} as any, () => {});
    const txn = ddbMock.commandCalls(TransactWriteItemsCommand)[0]?.args[0]?.input;
    const items = txn?.TransactItems ?? [];
    items.forEach((t) => {
      expect(t.Put?.ConditionExpression).toContain('attribute_not_exists');
    });
  });

  it('defensive: toStatus != closed → early return with 0 cards', async () => {
    const result = await handler(buildEvent('in_progress'), {} as any, () => {});
    expect(result).toBeDefined();
    if (!result) throw new Error('handler returned undefined');
    expect(result.cardsCreated).toBe(0);
    expect(result.chunksWritten).toBe(0);
    expect(ddbMock.commandCalls(GetItemCommand)).toHaveLength(0);
    expect(ddbMock.commandCalls(TransactWriteItemsCommand)).toHaveLength(0);
  });

  it('Exam not found → throws', async () => {
    ddbMock.on(GetItemCommand).resolves({ Item: undefined });
    await expect(handler(buildEvent(), {} as any, () => {})).rejects.toThrow(/Exam.*not found/);
  });

  it('Exam isActive=false → throws', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        examId: EXAM,
        academicYearId: AY,
        termId: TERM,
        examType: 'final',
        isActive: false,
      }),
    });
    await expect(handler(buildEvent(), {} as any, () => {})).rejects.toThrow(/not found or inactive/);
  });

  it('No default GradingPolicy → throws', async () => {
    ddbMock.on(GetItemCommand).resolves({
      Item: marshall({
        examId: EXAM,
        schoolId: SCHOOL,
        academicYearId: AY,
        termId: TERM,
        examType: 'final',
        isActive: true,
      }),
    });
    // ExamCourses
    ddbMock
      .on(QueryCommand)
      .resolvesOnce({
        Items: [
          marshall({
            examCourseId: 'ec-1',
            courseId: 'c-math',
            academicSubject: 'mathematics',
            maxMarks: 100,
            isActive: true,
          }),
        ],
      })
      // ExamScores (empty)
      .resolvesOnce({ Items: [] })
      // Enrollments (single)
      .resolvesOnce({
        Items: [
          marshall({
            enrollmentId: 'enroll-1',
            studentId: 'student-1',
            isActive: true,
          }),
        ],
      })
      // GradingPolicy → EMPTY
      .resolvesOnce({ Items: [] });

    await expect(handler(buildEvent(), {} as any, () => {})).rejects.toThrow(
      /No default GradingPolicy/,
    );
  });

  it('Idempotent re-fire: ConditionalCheckFailed → skipped, not error', async () => {
    setupHappyPath('final');
    // Override TransactWrite to throw on first call
    ddbMock
      .on(TransactWriteItemsCommand)
      .rejectsOnce(
        new ConditionalCheckFailedException({
          $metadata: {},
          message: 'The conditional request failed',
        }),
      );

    const result = await handler(buildEvent(), {} as any, () => {});
    expect(result).toBeDefined();
    if (!result) throw new Error('handler returned undefined');
    expect(result.cardsCreated).toBe(0);
    expect(result.cardsSkippedIdempotent).toBe(2);
  });
});
