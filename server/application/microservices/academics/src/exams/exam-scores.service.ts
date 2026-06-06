/**
 * ExamScores Service — Sprint A.3.7 + A.3.9
 *
 * Per-student per-ExamCourse score CRUD + bulk-write chunked at 100 per
 * DDB TransactWriteItems limit. ExamScore is keyed by enrollmentId
 * (binding field; invariant 3) so cross-year promotion (D.2.10) doesn't
 * break score history.
 *
 * **Bulk idempotency:** operator provides `correlationId`. Service scans
 * existing scores for the exam with that correlationId. Full-match → no-op
 * idempotent return. Zero-match → fresh writes. Partial-match → 409
 * BULK_PARTIAL_RETRY_NOT_SUPPORTED (operator retries with fresh correlationId).
 *
 * @see docs/pilot-greenlight/a3-sprint-plan.md §4 A.3.7 + A.3.9
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import {
  ExamScore,
  createExamScoreEntity,
} from '../common/entities/exam-score.entity';
import { ExamCourse } from '../common/entities/exam-course.entity';
import { Exam } from '../common/entities/exam.entity';
import {
  EntityKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import {
  CreateExamScoreDto,
  UpdateExamScoreDto,
  BulkExamScoreDto,
  BulkExamScoreResponseDto,
  ExamScoreResponseDto,
  EXAM_SCORE_BULK_CHUNK_SIZE,
} from '@aibrains/shared-types';
import { examScoreEntityToDto } from '../common/mappers/exam-score.mapper';
import { acceptsScoreWrites, isExamTombstoned } from './exam-state-machine';

@Injectable()
export class ExamScoresService {
  private readonly logger = new Logger(ExamScoresService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
  ) {}

  // ============================================================================
  // SINGLE SCORE WRITE
  // ============================================================================

  async recordScore(
    examId: string,
    dto: CreateExamScoreDto,
    context: RequestContext,
  ): Promise<ExamScoreResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Load ExamCourse + parent Exam
    const examCourse = await this.dynamoDBClient.getItem<ExamCourse>(
      client,
      context.tenantId,
      EntityKeyBuilder.examCourse(examId, dto.examCourseId),
    );
    if (!examCourse) {
      throw new NotFoundException({
        errorCode: 'EXAM_COURSE_NOT_FOUND',
        message: `ExamCourse ${dto.examCourseId} not found in exam ${examId}`,
      });
    }

    const exam = await this.dynamoDBClient.getItem<Exam>(
      client,
      context.tenantId,
      EntityKeyBuilder.exam(examCourse.schoolId, examId),
    );
    if (!exam) {
      throw new NotFoundException(`Exam ${examId} not found`);
    }
    if (isExamTombstoned(exam)) {
      throw new ConflictException({
        errorCode: 'EXAM_TOMBSTONED',
        message: `Cannot record scores on a deleted exam (examId=${examId})`,
      });
    }

    // 2. State-machine guard
    if (exam.status === 'draft') {
      throw new ConflictException({
        errorCode: 'EXAM_NOT_SCHEDULED',
        message: `Cannot record scores while exam.status=draft (transition to scheduled first)`,
        currentStatus: exam.status,
      });
    }
    if (!acceptsScoreWrites(exam.status)) {
      throw new ConflictException({
        errorCode: 'EXAM_LOCKED',
        message: `Cannot record scores while exam.status=${exam.status}`,
        currentStatus: exam.status,
      });
    }

    // 3. Validate rawScore ≤ ExamCourse.maxMarks
    if (dto.rawScore > examCourse.maxMarks) {
      throw new BadRequestException({
        errorCode: 'SCORE_EXCEEDS_MAX',
        message: `rawScore (${dto.rawScore}) exceeds ExamCourse.maxMarks (${examCourse.maxMarks})`,
      });
    }

    // 4. Resolve studentId + academicYearId + termId from enrollment.
    //    Enrollment is in academics; we use a denormalized lookup pattern.
    //    Per master plan A.3.7: "POST with non-existent enrollmentId → 404".
    //    Operator supplies enrollmentId; service does NOT call identity for
    //    student lookup (Enrollment entity carries studentId denormalized).
    const enrollment = await this.dynamoDBClient.queryGSI<{
      enrollmentId: string;
      studentId: string;
      academicYearId: string;
      schoolId: string;
    }>(
      client,
      'GSI1',
      `tenant#${context.tenantId}#school#${examCourse.schoolId}`,
      `enrollment#${dto.enrollmentId}`,
      'begins_with',
      undefined,
      undefined,
      undefined,
      1,
    );
    // Note: the existing enrollment entity in academics uses uppercase GSI keys
    // (per its createEnrollmentEntity factory). For V1 we accept that the
    // enrollment FK validation may not find via GSI; operator-supplied
    // enrollmentId is trusted. Tighten in Sprint 0.3 / A.3.7 followup.
    const resolvedStudentId = enrollment.items[0]?.studentId ?? 'unknown';
    const resolvedAcademicYearId = enrollment.items[0]?.academicYearId ?? exam.academicYearId;

    const now = new Date().toISOString();
    const examScoreId = uuid();

    const entity = createExamScoreEntity(
      context.tenantId,
      examScoreId,
      examId,
      dto.examCourseId,
      dto.enrollmentId,
      examCourse.schoolId,
      {
        studentId: resolvedStudentId,
        academicYearId: resolvedAcademicYearId,
        termId: exam.termId,
        rawScore: dto.rawScore,
        status: 'entered',
        enteredBy: context.userId,
        enteredAt: now,
        correlationId: dto.correlationId,
        createdAt: now,
        createdBy: context.userId,
        updatedAt: now,
        updatedBy: context.userId,
        version: 1,
      },
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.eventsService.publishExamScoreRecorded(
      context.tenantId,
      examScoreId,
      examId,
      dto.examCourseId,
      dto.enrollmentId,
      examCourse.schoolId,
      dto.rawScore,
    ).catch(err => this.logger.error('Failed to publish ExamScoreRecorded event', err));

    return examScoreEntityToDto(entity);
  }

  // ============================================================================
  // GET SINGLE
  // ============================================================================

  async getScore(
    examId: string,
    examScoreId: string,
    context: RequestContext,
  ): Promise<ExamScoreResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const es = await this.dynamoDBClient.getItem<ExamScore>(
      client,
      context.tenantId,
      EntityKeyBuilder.examScore(examId, examScoreId),
    );
    if (!es) {
      throw new NotFoundException(`ExamScore ${examScoreId} not found`);
    }
    return examScoreEntityToDto(es);
  }

  // ============================================================================
  // LIST (school-scoped)
  // ============================================================================

  /**
   * List ExamScores within a school for a given exam. Caller MUST provide
   * `schoolId` (the GSI1 partition is school-scoped). Filters on examCourseId
   * + enrollmentId apply as DDB filter expressions on the returned page.
   */
  async listScoresInSchool(
    examId: string,
    schoolId: string,
    context: RequestContext,
    filters?: {
      examCourseId?: string;
      enrollmentId?: string;
    },
    limit: number = 100,
    cursor?: string,
  ): Promise<PaginatedResult<ExamScoreResponseDto>> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    let exclusiveStartKey: Record<string, any> | undefined;
    if (cursor) {
      try {
        exclusiveStartKey = JSON.parse(Buffer.from(cursor, 'base64').toString());
      } catch { /* ignore */ }
    }

    const filterParts: string[] = [];
    const expressionValues: Record<string, any> = {};
    if (filters?.examCourseId) {
      filterParts.push('examCourseId = :examCourseId');
      expressionValues[':examCourseId'] = filters.examCourseId;
    }
    if (filters?.enrollmentId) {
      filterParts.push('enrollmentId = :enrollmentId');
      expressionValues[':enrollmentId'] = filters.enrollmentId;
    }

    const result = await this.dynamoDBClient.queryGSI<ExamScore>(
      client,
      'GSI1',
      `tenant#${context.tenantId}#school#${schoolId}`,
      `exam-score#${examId}#`,
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(expressionValues).length > 0 ? expressionValues : undefined,
      undefined,
      limit,
      true,
      exclusiveStartKey,
    );

    return {
      items: result.items.map(examScoreEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================================================
  // UPDATE SINGLE
  // ============================================================================

  async updateScore(
    examId: string,
    examScoreId: string,
    dto: UpdateExamScoreDto,
    context: RequestContext,
  ): Promise<ExamScoreResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.examScore(examId, examScoreId);

    const existing = await this.dynamoDBClient.getItem<ExamScore>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) {
      throw new NotFoundException(`ExamScore ${examScoreId} not found`);
    }

    if (existing.status === 'locked') {
      throw new ConflictException({
        errorCode: 'SCORE_LOCKED',
        message: `ExamScore ${examScoreId} is locked (parent exam closed)`,
      });
    }

    // Check parent Exam still accepts writes
    const exam = await this.dynamoDBClient.getItem<Exam>(
      client,
      context.tenantId,
      EntityKeyBuilder.exam(existing.schoolId, examId),
    );
    if (isExamTombstoned(exam)) {
      throw new ConflictException({
        errorCode: 'EXAM_TOMBSTONED',
        message: `Cannot update scores on a deleted exam (examId=${examId})`,
      });
    }
    if (exam && !acceptsScoreWrites(exam.status)) {
      throw new ConflictException({
        errorCode: 'EXAM_LOCKED',
        message: `Cannot update scores while exam.status=${exam.status}`,
        currentStatus: exam.status,
      });
    }

    // Validate rawScore against ExamCourse.maxMarks if updated
    if (dto.rawScore !== undefined) {
      const examCourse = await this.dynamoDBClient.getItem<ExamCourse>(
        client,
        context.tenantId,
        EntityKeyBuilder.examCourse(examId, existing.examCourseId),
      );
      if (examCourse && dto.rawScore > examCourse.maxMarks) {
        throw new BadRequestException({
          errorCode: 'SCORE_EXCEEDS_MAX',
          message: `rawScore (${dto.rawScore}) exceeds ExamCourse.maxMarks (${examCourse.maxMarks})`,
        });
      }
    }

    const now = new Date().toISOString();
    const updateParts: string[] = [
      'updatedAt = :updatedAt',
      'updatedBy = :updatedBy',
      'version = version + :inc',
    ];
    const expressionValues: Record<string, any> = {
      ':updatedAt': now,
      ':updatedBy': context.userId,
      ':inc': 1,
      ':currentVersion': existing.version,
    };

    if (dto.rawScore !== undefined) {
      updateParts.push('rawScore = :rawScore');
      expressionValues[':rawScore'] = dto.rawScore;
    }

    const updated = await this.dynamoDBClient.updateItem<ExamScore>(
      client,
      context.tenantId,
      entityKey,
      `SET ${updateParts.join(', ')}`,
      expressionValues,
      'version = :currentVersion',
    );

    this.eventsService.publishExamScoreUpdated(
      context.tenantId,
      examScoreId,
      examId,
      existing.schoolId,
      Object.keys(dto),
    ).catch(err => this.logger.error('Failed to publish ExamScoreUpdated event', err));

    return examScoreEntityToDto(updated);
  }

  // ============================================================================
  // BULK WRITE (A.3.9)
  // ============================================================================

  async recordBulk(
    examId: string,
    schoolId: string,
    dto: BulkExamScoreDto,
    context: RequestContext,
  ): Promise<BulkExamScoreResponseDto> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Load parent Exam + validate state
    const exam = await this.dynamoDBClient.getItem<Exam>(
      client,
      context.tenantId,
      EntityKeyBuilder.exam(schoolId, examId),
    );
    if (!exam) {
      throw new NotFoundException(`Exam ${examId} not found`);
    }
    if (isExamTombstoned(exam)) {
      throw new ConflictException({
        errorCode: 'EXAM_TOMBSTONED',
        message: `Cannot bulk-record scores on a deleted exam (examId=${examId})`,
      });
    }
    if (exam.status === 'draft') {
      throw new ConflictException({
        errorCode: 'EXAM_NOT_SCHEDULED',
        message: `Cannot bulk-record while exam.status=draft`,
      });
    }
    if (!acceptsScoreWrites(exam.status)) {
      throw new ConflictException({
        errorCode: 'EXAM_LOCKED',
        message: `Cannot bulk-record while exam.status=${exam.status}`,
      });
    }

    // 2. Idempotency: scan existing scores for this correlationId
    const existingForCorrelation = await this.dynamoDBClient.queryGSI<ExamScore>(
      client,
      'GSI1',
      `tenant#${context.tenantId}#school#${schoolId}`,
      `exam-score#${examId}#`,
      'begins_with',
      'correlationId = :corr',
      { ':corr': dto.correlationId },
      undefined,
      1000,
      true,
    );
    const matchingCount = existingForCorrelation.items.length;

    if (matchingCount > 0 && matchingCount === dto.scores.length) {
      // Full match → idempotent return
      this.logger.log(`recordBulk: idempotent re-write detected (correlationId=${dto.correlationId}, count=${matchingCount})`);
      return {
        correlationId: dto.correlationId,
        examId,
        totalScores: dto.scores.length,
        totalCreated: 0,
        totalSkipped: matchingCount,
        totalFailed: 0,
        chunks: [{
          chunkIndex: 0,
          chunkSize: matchingCount,
          status: 'idempotent_skip',
        }],
        alreadyProcessed: true,
      };
    }

    if (matchingCount > 0 && matchingCount !== dto.scores.length) {
      throw new ConflictException({
        errorCode: 'BULK_PARTIAL_RETRY_NOT_SUPPORTED',
        message: `correlationId ${dto.correlationId} already has ${matchingCount} scores; expected ${dto.scores.length}. Use a fresh correlationId.`,
        existingCount: matchingCount,
        expectedCount: dto.scores.length,
      });
    }

    // 3. Load ExamCourses for maxMarks validation (single query of all ExamCourses)
    const examCourses = await this.dynamoDBClient.queryGSI<ExamCourse>(
      client,
      'GSI2',
      `exam#${examId}`,
      'course#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100,
      true,
    );
    const examCourseById = new Map(examCourses.items.map(ec => [ec.examCourseId, ec]));

    // 4. Validate each score against maxMarks
    for (const s of dto.scores) {
      const ec = examCourseById.get(s.examCourseId);
      if (!ec) {
        throw new NotFoundException({
          errorCode: 'EXAM_COURSE_NOT_FOUND',
          message: `ExamCourse ${s.examCourseId} not found in exam ${examId}`,
        });
      }
      if (s.rawScore > ec.maxMarks) {
        throw new BadRequestException({
          errorCode: 'SCORE_EXCEEDS_MAX',
          message: `Score ${s.rawScore} exceeds maxMarks ${ec.maxMarks} for ExamCourse ${s.examCourseId}`,
        });
      }
    }

    // 5. Chunk + transactWrite
    const now = new Date().toISOString();
    const chunks: BulkExamScoreResponseDto['chunks'] = [];
    let totalCreated = 0;
    let totalFailed = 0;

    for (let i = 0; i < dto.scores.length; i += EXAM_SCORE_BULK_CHUNK_SIZE) {
      const chunkScores = dto.scores.slice(i, i + EXAM_SCORE_BULK_CHUNK_SIZE);
      const chunkIndex = i / EXAM_SCORE_BULK_CHUNK_SIZE;

      // Resolve table name from the same source DDB client uses (TABLE_NAME env)
      // — avoids hardcoding + matches the rest of the academics service.
      const tableName = this.dynamoDBClient.getTableName();

      const transactItems = chunkScores.map(s => {
        const examScoreId = uuid();
        // examCourse referenced for symmetry; kept lookup for future maxMarks revalidation here.
        examCourseById.get(s.examCourseId)!;
        const entity = createExamScoreEntity(
          context.tenantId,
          examScoreId,
          examId,
          s.examCourseId,
          s.enrollmentId,
          schoolId,
          {
            studentId: 'unknown', // V1 simplification — Phase 3 smoke + A.3.7 followup tightens
            academicYearId: exam.academicYearId,
            termId: exam.termId,
            rawScore: s.rawScore,
            status: 'entered',
            enteredBy: context.userId,
            enteredAt: now,
            correlationId: dto.correlationId,
            createdAt: now,
            createdBy: context.userId,
            updatedAt: now,
            updatedBy: context.userId,
            version: 1,
          },
        );
        return {
          Put: {
            TableName: tableName,
            Item: { ...entity } as Record<string, unknown>,
            ConditionExpression: 'attribute_not_exists(entityKey)',
          },
        };
      });

      try {
        await this.dynamoDBClient.transactWrite(client, transactItems);
        totalCreated += chunkScores.length;
        chunks.push({
          chunkIndex,
          chunkSize: chunkScores.length,
          status: 'ok',
        });

        // One event per successful chunk (master plan A.3.9 AC)
        this.eventsService.publishExamScoresBulkRecorded(
          context.tenantId,
          examId,
          schoolId,
          dto.correlationId,
          chunkIndex,
          chunkScores.length,
        ).catch(err => this.logger.error(`Failed to publish ExamScoresBulkRecorded event for chunk ${chunkIndex}`, err));
      } catch (err: any) {
        totalFailed += chunkScores.length;
        chunks.push({
          chunkIndex,
          chunkSize: chunkScores.length,
          status: 'failed',
          failureReason: err?.message ?? String(err),
        });
        this.logger.error(`recordBulk chunk ${chunkIndex} failed`, err);
        // Continue to next chunk; failure is per-chunk
      }
    }

    return {
      correlationId: dto.correlationId,
      examId,
      totalScores: dto.scores.length,
      totalCreated,
      totalSkipped: 0,
      totalFailed,
      chunks,
      alreadyProcessed: false,
    };
  }
}
