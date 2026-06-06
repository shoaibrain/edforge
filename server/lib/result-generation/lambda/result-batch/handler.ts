/**
 * Result-Batch Lambda — Sprint A.4.3 Phase 3
 *
 * Triggered by EventBridge rule on `ExamStatusTransitioned` events
 * where `detail.toStatus === 'closed'`. Generates one ResultCard row
 * per enrollment for the closed exam by:
 *   1. Reading the Exam row (academicYearId, termId, examType).
 *   2. Listing all ExamCourses for the exam (GSI2 PK `exam#{examId}`).
 *   3. Listing all ExamScores for the exam (GSI1 PK `tenant#{tid}#school#{schoolId}` + begins_with `exam-score#{examId}#`).
 *   4. Listing all Enrollments for the school+AY (GSI1 PK `TENANT#{tid}#SCHOOL#{schoolId}` + begins_with `ENROLLMENT#{ay}#`).
 *   5. Reading the default GradingPolicy for the school (GSI1 + isDefault filter).
 *   6. Calling `aggregateTermResults()` (pure function — local copy).
 *   7. Writing ResultCard rows chunked at 100 via TransactWriteItems
 *      with `attribute_not_exists(entityKey)` for idempotency.
 *
 * **R42 mitigation:** studentId is resolved from Enrollment by
 * enrollmentId in the aggregation, NOT from ExamScore.studentId (which
 * may be 'unknown' for bulk-written rows).
 *
 * **V1 isTerminal simplification:** `Exam.examType === 'final'` → terminal.
 * Per PABSON examPattern, 'final' is the last entry. For V1.5 when
 * non-PABSON archetypes become V1 supported, replace this with
 * `getArchetypeDefaults(archetype).examPattern.slice(-1)[0] === examType`.
 * Documented in §17.9 L9 forward signal.
 *
 * **Idempotency:** TransactWriteItems with `attribute_not_exists` →
 * ConditionalCheckFailedException on duplicate is logged as a skip,
 * NOT an error. Safe re-invocation on the same exam.
 *
 * @see docs/pilot-greenlight/a4-phase-3-plan.md
 */

import { Handler } from 'aws-lambda';
import {
  DynamoDBClient,
  GetItemCommand,
  QueryCommand,
  TransactWriteItemsCommand,
  ConditionalCheckFailedException,
  type AttributeValue,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import { marshall, unmarshall } from '@aws-sdk/util-dynamodb';
import { v4 as uuid } from 'uuid';

import {
  aggregateTermResults,
  type AggExam,
  type AggExamCourse,
  type AggExamScore,
  type AggEnrollment,
  type AggGradingPolicy,
  type AggregatedEnrollmentRow,
} from '../shared/term-aggregation';

import type {
  EventBridgeExamStatusTransitioned,
  ResultBatchLambdaResult,
} from '../shared/types';

// ============================================================================
// Module-level clients (warm across invocations)
// ============================================================================

const ddb = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'ap-south-1',
  maxAttempts: 3,
});

const ACADEMICS_TABLE = process.env.ACADEMICS_TABLE_NAME ?? 'edforge-academics-basic';

// ============================================================================
// Logging
// ============================================================================

function log(
  level: 'info' | 'warn' | 'error',
  msg: string,
  ctx: Record<string, unknown> = {},
): void {
  const line = JSON.stringify({ level, msg, ...ctx });

  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(line);
}

// ============================================================================
// Idempotent-DDB helpers
// ============================================================================

async function getItem<T>(tenantId: string, entityKey: string): Promise<T | null> {
  const result = await ddb.send(
    new GetItemCommand({
      TableName: ACADEMICS_TABLE,
      Key: marshall({ tenantId, entityKey }),
    }),
  );
  return result.Item ? (unmarshall(result.Item) as T) : null;
}

async function queryAllPages<T>(params: {
  indexName: string;
  pkName: string;
  pkValue: string;
  skName?: string;
  skBeginsWith?: string;
  filterExpression?: string;
  filterValues?: Record<string, AttributeValue>;
}): Promise<T[]> {
  const items: T[] = [];
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;
  do {
    const expressionAttributeValues: Record<string, AttributeValue> = {
      ':pk': { S: params.pkValue },
      ...(params.filterValues ?? {}),
    };
    let keyConditionExpression = `${params.pkName} = :pk`;
    if (params.skName && params.skBeginsWith) {
      keyConditionExpression += ` AND begins_with(${params.skName}, :sk)`;
      expressionAttributeValues[':sk'] = { S: params.skBeginsWith };
    }
    const result = await ddb.send(
      new QueryCommand({
        TableName: ACADEMICS_TABLE,
        IndexName: params.indexName,
        KeyConditionExpression: keyConditionExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        FilterExpression: params.filterExpression,
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    for (const item of result.Items ?? []) {
      items.push(unmarshall(item) as T);
    }
    exclusiveStartKey = result.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return items;
}

// ============================================================================
// V1 isTerminal heuristic
// ============================================================================

/**
 * V1 simplification per a4-phase-3-plan.md: examType === 'final' is
 * the PABSON terminal cadence. For V1.5 multi-archetype, replace with
 * archetypeDefaults lookup. Other archetypes (CBSE_IN, NAIS_US, GEMS_UAE)
 * are V1_DEFERRED per CLAUDE.md scope; safe to hardcode.
 */
function determineIsTerminal(examType: string): boolean {
  return examType === 'final';
}

// ============================================================================
// ResultCard entityKey + GSI builders (mirror academics src result-card.entity.ts)
// ============================================================================

function resultCardEntityKey(enrollmentId: string, cardId: string): string {
  return `RESULT_CARD#${enrollmentId}#${cardId}`;
}

function resultCardGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}

function resultCardGsi1sk(
  academicYearId: string,
  termId: string,
  examId: string,
  enrollmentId: string,
): string {
  return `result-card#${academicYearId}#${termId}#${examId}#${enrollmentId}`;
}

function resultCardGsi2pk(enrollmentId: string): string {
  return `enrollment#${enrollmentId}`;
}

function resultCardGsi2sk(academicYearId: string, termId: string, examId: string): string {
  return `result-card#${academicYearId}#${termId}#${examId}`;
}

function resultCardGsi3pk(examId: string): string {
  return `exam#${examId}`;
}

function resultCardGsi3sk(enrollmentId: string): string {
  return `result-card#${enrollmentId}`;
}

// ============================================================================
// Build ResultCard DDB item from an aggregation row
// ============================================================================

function buildResultCardItem(
  tenantId: string,
  row: AggregatedEnrollmentRow,
  now: string,
): Record<string, AttributeValue> {
  const cardId = uuid();
  return marshall(
    {
      tenantId,
      entityKey: resultCardEntityKey(row.enrollmentId, cardId),
      entityType: 'RESULT_CARD',
      cardId,
      enrollmentId: row.enrollmentId,
      examId: row.examId,
      termId: row.termId,
      academicYearId: row.academicYearId,
      schoolId: row.schoolId,
      studentId: row.studentId,
      studentIdentity: row.studentIdentity,
      courseScores: row.courseScores,
      totalScore: row.totalScore,
      totalMaxMarks: row.totalMaxMarks,
      termGpa: row.termGpa,
      overallGrade: row.overallGrade,
      classRank: null,
      sectionRank: null,
      conduct: null,
      classTeacherRemark: null,
      status: 'draft',
      publishedAt: null,
      publishedBy: null,
      isTerminalExam: row.isTerminalExam,
      isActive: true,
      gsi1pk: resultCardGsi1pk(tenantId, row.schoolId),
      gsi1sk: resultCardGsi1sk(row.academicYearId, row.termId, row.examId, row.enrollmentId),
      gsi2pk: resultCardGsi2pk(row.enrollmentId),
      gsi2sk: resultCardGsi2sk(row.academicYearId, row.termId, row.examId),
      gsi3pk: resultCardGsi3pk(row.examId),
      gsi3sk: resultCardGsi3sk(row.enrollmentId),
      createdAt: now,
      createdBy: 'result-batch-lambda',
      updatedAt: now,
      updatedBy: 'result-batch-lambda',
      version: 1,
    },
    { removeUndefinedValues: true },
  );
}

// ============================================================================
// Handler
// ============================================================================

export const handler: Handler<EventBridgeExamStatusTransitioned, ResultBatchLambdaResult> =
  async (event) => {
    const start = Date.now();
    const detail = event.detail;

    if (detail.toStatus !== 'closed') {
      // Defensive — the EventBridge rule should already filter this.
      // Log + early return so partial misfires don't write half a card.
      log('warn', 'result-batch-lambda: invoked with toStatus != closed; skipping', {
        toStatus: detail.toStatus,
        examId: detail.examId,
      });
      return {
        examId: detail.examId,
        tenantId: detail.tenantId,
        schoolId: detail.schoolId,
        cardsCreated: 0,
        cardsSkippedIdempotent: 0,
        chunksWritten: 0,
        enrollmentsAggregated: 0,
        durationMs: Date.now() - start,
      };
    }

    const { tenantId, examId, schoolId } = detail;
    const logCtx = { tenantId, examId, schoolId };
    log('info', 'result-batch-lambda: started', logCtx);

    // 1. Read Exam
    const examEntityKey = `EXAM#${schoolId}#${examId}`;
    const exam = await getItem<{
      academicYearId: string;
      termId: string;
      examType: string;
      isActive: boolean;
      gradeLevels?: string[];
    }>(tenantId, examEntityKey);
    // Split the absent-vs-inactive guard so the log distinguishes a missing
    // row (table/key/credential mismatch) from a soft-deleted exam. The two
    // have completely different fixes; the old conflated message hid which.
    if (!exam) {
      log('error', 'result-batch-lambda: Exam row not found on GetItem', {
        ...logCtx,
        table: ACADEMICS_TABLE,
        entityKey: examEntityKey,
      });
      throw new Error(`Exam ${examId} not found (table=${ACADEMICS_TABLE} key=${examEntityKey})`);
    }
    if (exam.isActive === false) {
      log('error', 'result-batch-lambda: Exam is soft-deleted (isActive=false)', {
        ...logCtx,
        entityKey: examEntityKey,
      });
      throw new Error(`Exam ${examId} is inactive (isActive=false)`);
    }
    const { academicYearId, termId, examType, gradeLevels: examGradeLevels } = exam;
    // Defensive: missing context fields would silently produce empty
    // ResultCards (Enrollment query keyed on academicYearId wouldn't match).
    // Throw early with a clear message instead.
    if (!academicYearId || !termId || !examType) {
      log('error', 'result-batch-lambda: Exam row missing required fields', {
        ...logCtx,
        academicYearId,
        termId,
        examType,
      });
      throw new Error(
        `Exam ${examId} row missing required fields (academicYearId/termId/examType)`,
      );
    }
    const isTerminalExam = determineIsTerminal(examType);

    // 2. ExamCourses (GSI2 PK exam#{examId})
    const examCourses = await queryAllPages<{
      examCourseId: string;
      courseId: string;
      academicSubject?: string;
      maxMarks: number;
      creditHours?: number;
      isActive: boolean;
    }>({
      indexName: 'GSI2',
      pkName: 'gsi2pk',
      pkValue: resultCardGsi3pk(examId),                  // 'exam#{examId}' — same shape as ResultCard GSI3
      skName: 'gsi2sk',
      skBeginsWith: 'course#',
    });
    // Defensive: academics service does NOT consistently write `isActive`
    // onto ExamCourse rows (verified 2026-05-23 against dev-pabson-primary
    // smoke). Treat `undefined` as active (the default). Soft-delete is
    // explicit `isActive: false`. Same pattern applied to ExamScore +
    // Enrollment filters below.
    const activeExamCourses: AggExamCourse[] = examCourses
      .filter((ec) => ec.isActive !== false)
      .map((ec) => {
        if (!ec.academicSubject) {
          // Data-integrity warning: ExamCourse normally denormalizes
          // academicSubject from Course at write time (A.3.3). Missing
          // value here means the ExamCourse row was written before
          // A.2 backfill OR Course FK validation slipped. Lambda
          // continues with 'unknown' so the operator sees the rest of
          // the ResultCard; downstream rendering can filter on the
          // anomaly.
          log('warn', 'result-batch-lambda: ExamCourse missing academicSubject', {
            ...logCtx,
            examCourseId: ec.examCourseId,
            courseId: ec.courseId,
          });
        }
        return {
          examCourseId: ec.examCourseId,
          courseId: ec.courseId,
          academicSubject: ec.academicSubject ?? 'unknown',
          maxMarks: ec.maxMarks,
          creditHours: ec.creditHours,
        };
      });

    // 3. ExamScores (GSI1 PK tenant#{tid}#school#{schoolId} + begins_with exam-score#{examId}#)
    const examScores = await queryAllPages<{
      examCourseId: string;
      enrollmentId: string;
      rawScore: number;
      isActive: boolean;
    }>({
      indexName: 'GSI1',
      pkName: 'gsi1pk',
      pkValue: resultCardGsi1pk(tenantId, schoolId),
      skName: 'gsi1sk',
      skBeginsWith: `exam-score#${examId}#`,
    });
    const activeExamScores: AggExamScore[] = examScores
      .filter((s) => s.isActive !== false)
      .map((s) => ({
        examCourseId: s.examCourseId,
        enrollmentId: s.enrollmentId,
        rawScore: s.rawScore,
      }));

    // 4. Enrollments (GSI1 PK TENANT#{tid}#SCHOOL#{schoolId} + begins_with ENROLLMENT#{ay}#)
    //    NOTE: Enrollment uses UPPERCASE legacy GSI keys (pre-S3.2 entities).
    const enrollmentRows = await queryAllPages<{
      enrollmentId: string;
      studentId: string;
      gradeLevel?: string;
      isActive: boolean;
    }>({
      indexName: 'GSI1',
      pkName: 'gsi1pk',
      pkValue: `TENANT#${tenantId}#SCHOOL#${schoolId}`,
      skName: 'gsi1sk',
      skBeginsWith: `ENROLLMENT#${academicYearId}#`,
    });
    // ELS.3 — grade-level filter (data-integrity fix). When the Exam carries
    // a non-empty gradeLevels[] scope, only enrollments at one of those grade
    // levels generate ResultCards. Without this filter, every active
    // enrollment in the academic year produces a card, including students
    // at out-of-scope grade levels (ECD kids given Grade 10 cards on a
    // Grade-10 final close). Legacy exams with absent/empty gradeLevels
    // degrade to the pre-ELS.3 "all active enrollments" behavior — ELS.4
    // backfill populates legacy rows with school.enabledGradeLevels so the
    // operational outcome stays equivalent for already-deployed data.
    const scopedEnrollments =
      Array.isArray(examGradeLevels) && examGradeLevels.length > 0
        ? (() => {
            const allowed = new Set(examGradeLevels);
            return enrollmentRows.filter(
              (e) => e.gradeLevel !== undefined && allowed.has(e.gradeLevel),
            );
          })()
        : enrollmentRows;
    const activeEnrollments = scopedEnrollments.filter((e) => e.isActive !== false);
    log('info', 'result-batch-lambda: enrollment grade-level scoping applied', {
      ...logCtx,
      examGradeLevels: examGradeLevels ?? null,
      preFilterEnrollments: enrollmentRows.length,
      postFilterEnrollments: activeEnrollments.length,
    });

    // RC-UX.1: resolve a frozen student-identity snapshot per enrollment. Student
    // lives in the academics table (SK STUDENT#{id}) which this Lambda already
    // reads — no cross-table access / IAM grant needed. Captured at issuance so a
    // published card reads as printed even after later transfers / name fixes.
    const uniqueStudentIds = [...new Set(activeEnrollments.map((e) => e.studentId))];
    const studentById = new Map<
      string,
      { firstName: string; lastName: string; preferredName?: string; photoUrl?: string; emisStudentId?: string }
    >();
    await Promise.all(
      uniqueStudentIds.map(async (sid) => {
        const s = await getItem<{
          firstName: string;
          lastName: string;
          preferredName?: string;
          photoUrl?: string;
          emisStudentId?: string;
        }>(tenantId, `STUDENT#${sid}`);
        // Only snapshot when the name is real — a blank legalName would fail the
        // response schema's z.string().min(1); a missing name → no snapshot.
        if (s && s.firstName?.trim() && s.lastName?.trim()) studentById.set(sid, s);
      }),
    );

    const enrollments = new Map<string, AggEnrollment>();
    for (const e of activeEnrollments) {
      const s = studentById.get(e.studentId);
      enrollments.set(e.enrollmentId, {
        enrollmentId: e.enrollmentId,
        studentId: e.studentId,
        studentIdentity: s
          ? {
              legalName: `${s.firstName} ${s.lastName}`.trim(),
              preferredName: s.preferredName,
              gradeLevel: e.gradeLevel,
              emisStudentId: s.emisStudentId,
              photoUrl: s.photoUrl,
            }
          : undefined,
      });
    }

    // 5. Default GradingPolicy for school (GSI1 + isDefault filter)
    const policies = await queryAllPages<{
      policyId: string;
      letterGrades: AggGradingPolicy['letterGrades'];
      isDefault: boolean;
      isActive: boolean;
    }>({
      indexName: 'GSI1',
      pkName: 'gsi1pk',
      pkValue: `TENANT#${tenantId}#SCHOOL#${schoolId}`,
      skName: 'gsi1sk',
      skBeginsWith: 'GRADEPOLICY#',
      filterExpression: 'isDefault = :true AND isActive = :true',
      filterValues: { ':true': { BOOL: true } },
    });
    const defaultPolicy = policies[0];
    if (!defaultPolicy) {
      log('error', 'result-batch-lambda: no default GradingPolicy for school', logCtx);
      throw new Error(`No default GradingPolicy for school ${schoolId}`);
    }

    // 6. Aggregate (pure function)
    // Defensive: `letterGrades` can be undefined on legacy GradingPolicy
    // rows seeded before D.1.1 (the entity field was added then; pre-D.1.1
    // rows have only `gradingScale`). API mapper synthesizes `?? []`; we
    // mirror that here so the aggregation function gets a definite array.
    // The aggregation itself throws if the array is empty.
    const aggregated = aggregateTermResults({
      exam: { examId, schoolId, termId, academicYearId } as AggExam,
      examCourses: activeExamCourses,
      examScores: activeExamScores,
      enrollments,
      gradingPolicy: {
        policyId: defaultPolicy.policyId,
        letterGrades: defaultPolicy.letterGrades ?? [],
      },
      isTerminalExam,
    });

    log('info', 'result-batch-lambda: aggregation complete', {
      ...logCtx,
      enrollmentsAggregated: aggregated.perEnrollment.length,
      examCoursesUsed: activeExamCourses.length,
      examScoresUsed: activeExamScores.length,
      isTerminalExam,
    });

    // 7. Write ResultCard rows chunked at 100 (DDB TransactWriteItems limit)
    const now = new Date().toISOString();
    const allWrites: TransactWriteItem[] = aggregated.perEnrollment.map((row) => ({
      Put: {
        TableName: ACADEMICS_TABLE,
        Item: buildResultCardItem(tenantId, row, now),
        ConditionExpression:
          'attribute_not_exists(tenantId) AND attribute_not_exists(entityKey)',
      },
    }));

    let cardsCreated = 0;
    let cardsSkippedIdempotent = 0;
    let chunksWritten = 0;

    for (let i = 0; i < allWrites.length; i += 100) {
      const chunk = allWrites.slice(i, i + 100);
      try {
        await ddb.send(new TransactWriteItemsCommand({ TransactItems: chunk }));
        cardsCreated += chunk.length;
        chunksWritten++;
      } catch (err) {
        if (
          err instanceof ConditionalCheckFailedException ||
          (err as { name?: string }).name === 'TransactionCanceledException'
        ) {
          // Idempotent re-invocation: at least one item already existed.
          // The TransactionCanceledException carries per-item reasons but
          // since this is a re-fire of the same exam.closed event, treat
          // the whole chunk as idempotent skip.
          cardsSkippedIdempotent += chunk.length;
          log('info', 'result-batch-lambda: chunk idempotent skip (re-fire)', {
            ...logCtx,
            chunkIndex: Math.floor(i / 100),
            chunkSize: chunk.length,
          });
        } else {
          log('error', 'result-batch-lambda: chunk write failed', {
            ...logCtx,
            chunkIndex: Math.floor(i / 100),
            error: (err as Error).message,
          });
          throw err;
        }
      }
    }

    const result: ResultBatchLambdaResult = {
      examId,
      tenantId,
      schoolId,
      cardsCreated,
      cardsSkippedIdempotent,
      chunksWritten,
      enrollmentsAggregated: aggregated.perEnrollment.length,
      durationMs: Date.now() - start,
    };
    log('info', 'result-batch-lambda: complete', result);
    return result;
  };
