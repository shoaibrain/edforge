/**
 * ResultCards Service — Sprint A.4.4 + A.4.5
 *
 * Handles operator-facing PATCH endpoints (conduct, remark, publish)
 * and GET/LIST. CREATE is intentionally absent — ResultCard rows are
 * written exclusively by the result-batch Lambda (A.4.3) in response to
 * `exam.closed` events.
 *
 * **State machine (A.4.5):**
 *   draft ─→ published  (single irreversible; terminal in V1)
 *
 * Re-publish attempt → 409 `RESULT_ALREADY_PUBLISHED` (NOT 200 no-op).
 * Difference from Exam state machine where same-state is 200 no-op:
 * publish is operationally significant — operator must KNOW it's done.
 *
 * **R42 mitigation:** ResultCard rows surface the correct studentId
 * (resolved at Lambda aggregation time from Enrollment, not from
 * ExamScore.studentId which may be 'unknown' for bulk-written A.3 rows).
 *
 * **Invariant 3:** keyed by enrollmentId. PATCH/GET endpoints require
 * the operator to supply `enrollmentId` (query param) so we can do an
 * efficient GetItem rather than a scan. The frontend (or the Lambda's
 * write path) already knows the enrollmentId for any card it touches.
 *
 * @see docs/pilot-greenlight/a4-sprint-plan.md §4 A.4.4 + A.4.5
 */

import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import {
  ResultCard,
} from '../common/entities/result-card.entity';
import {
  EntityKeyBuilder,
  RequestContext,
  PaginatedResult,
} from '../common/entities/base.entity';
import type {
  UpdateResultCardConductDto,
  UpdateResultCardRemarkDto,
  ResultCardPublishDto,
  ResultCardResponseDto,
  ResultCardFilterDto,
} from '@aibrains/shared-types';
import { resultCardEntityToDto } from '../common/mappers/result-card.mapper';

interface ResultCardListResult {
  items: ResultCardResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

@Injectable()
export class ResultCardsService {
  private readonly logger = new Logger(ResultCardsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
  ) {}

  // ==========================================================================
  // READ
  // ==========================================================================

  /**
   * Get a single ResultCard. Requires `enrollmentId` for efficient
   * GetItem (the entityKey is `RESULT_CARD#{enrollmentId}#{cardId}`).
   */
  async getResultCard(
    cardId: string,
    enrollmentId: string,
    context: RequestContext,
  ): Promise<ResultCardResponseDto> {
    this.logger.debug(`getResultCard: cardId=${cardId} enrollmentId=${enrollmentId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const entity = await this.dynamoDBClient.getItem<ResultCard>(
      client,
      context.tenantId,
      EntityKeyBuilder.resultCard(enrollmentId, cardId),
    );

    if (!entity || !entity.isActive) {
      throw new NotFoundException({
        errorCode: 'RESULT_CARD_NOT_FOUND',
        message: `ResultCard ${cardId} for enrollment ${enrollmentId} not found`,
      });
    }

    return resultCardEntityToDto(entity);
  }

  /**
   * List ResultCards with filters. Routing depends on the most specific
   * filter:
   *   - `examId` → GSI3 (exam-scope): `exam#{examId}` PK
   *   - `enrollmentId` → GSI2 (enrollment-scope cross-AY): `enrollment#{enrollmentId}` PK
   *   - `schoolId` → GSI1 (school-scope) with filter expressions
   *
   * At least ONE of {schoolId, examId, enrollmentId} MUST be provided.
   */
  async listResultCards(
    filter: ResultCardFilterDto,
    context: RequestContext,
    limit: number = 50,
    cursor?: string,
  ): Promise<ResultCardListResult> {
    if (!filter.schoolId && !filter.examId && !filter.enrollmentId) {
      throw new BadRequestException({
        errorCode: 'RESULT_CARD_FILTER_TOO_BROAD',
        message: 'one of schoolId, examId, or enrollmentId is required',
      });
    }
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const filterExpression = this.buildFilterExpression(filter);
    const filterValues = this.buildFilterValues(filter);
    const filterNames = this.buildFilterNames(filter);
    const exclusiveStartKey = this.decodeCursor(cursor);

    // Route to the most efficient index
    let result: PaginatedResult<ResultCard>;
    if (filter.examId) {
      result = await this.dynamoDBClient.queryGSI<ResultCard>(
        client,
        'GSI3',
        `exam#${filter.examId}`,
        'result-card#',
        'begins_with',
        filterExpression,
        filterValues,
        filterNames,
        limit,
        true,
        exclusiveStartKey,
      );
    } else if (filter.enrollmentId) {
      result = await this.dynamoDBClient.queryGSI<ResultCard>(
        client,
        'GSI2',
        `enrollment#${filter.enrollmentId}`,
        'result-card#',
        'begins_with',
        filterExpression,
        filterValues,
        filterNames,
        limit,
        true,
        exclusiveStartKey,
      );
    } else {
      // schoolId only — GSI1 school-scope
      result = await this.dynamoDBClient.queryGSI<ResultCard>(
        client,
        'GSI1',
        `tenant#${context.tenantId}#school#${filter.schoolId}`,
        'result-card#',
        'begins_with',
        filterExpression,
        filterValues,
        filterNames,
        limit,
        true,
        exclusiveStartKey,
      );
    }

    return {
      items: result.items
        .filter((e) => e.isActive)
        .map((e) => resultCardEntityToDto(e)),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ==========================================================================
  // UPDATE — conduct + remark (A.4.4)
  // ==========================================================================

  async updateConduct(
    cardId: string,
    enrollmentId: string,
    dto: UpdateResultCardConductDto,
    context: RequestContext,
  ): Promise<ResultCardResponseDto> {
    return this.patchOperatorField(
      cardId,
      enrollmentId,
      context,
      (entity) => {
        entity.conduct = dto.conduct;
      },
      'conduct',
    );
  }

  async updateRemark(
    cardId: string,
    enrollmentId: string,
    dto: UpdateResultCardRemarkDto,
    context: RequestContext,
  ): Promise<ResultCardResponseDto> {
    return this.patchOperatorField(
      cardId,
      enrollmentId,
      context,
      (entity) => {
        entity.classTeacherRemark = dto.classTeacherRemark;
      },
      'classTeacherRemark',
    );
  }

  /**
   * Internal helper shared by updateConduct + updateRemark. Reads,
   * guards against published cards, applies the mutator, writes,
   * publishes a `ResultCardUpdated` event, returns the DTO.
   */
  private async patchOperatorField(
    cardId: string,
    enrollmentId: string,
    context: RequestContext,
    mutator: (entity: ResultCard) => void,
    fieldName: string,
  ): Promise<ResultCardResponseDto> {
    this.logger.debug(`patch ${fieldName}: cardId=${cardId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const entity = await this.dynamoDBClient.getItem<ResultCard>(
      client,
      context.tenantId,
      EntityKeyBuilder.resultCard(enrollmentId, cardId),
    );
    if (!entity || !entity.isActive) {
      throw new NotFoundException({
        errorCode: 'RESULT_CARD_NOT_FOUND',
        message: `ResultCard ${cardId} for enrollment ${enrollmentId} not found`,
      });
    }
    if (entity.status === 'published') {
      throw new ConflictException({
        errorCode: 'RESULT_LOCKED',
        message: `ResultCard ${cardId} is published and cannot be modified`,
      });
    }

    mutator(entity);
    entity.updatedAt = new Date().toISOString();
    entity.updatedBy = context.userId;
    entity.version = (entity.version ?? 1) + 1;

    await this.dynamoDBClient.putItem(client, entity);

    this.eventsService
      .publishResultCardUpdated(
        context.tenantId,
        cardId,
        entity.enrollmentId,
        entity.schoolId,
        entity.examId,
        [fieldName],
      )
      .catch((err) =>
        this.logger.error(
          `Failed to publish ResultCardUpdated event for ${cardId}`,
          err,
        ),
      );

    return resultCardEntityToDto(entity);
  }

  // ==========================================================================
  // PUBLISH (A.4.5 state machine — single irreversible transition)
  // ==========================================================================

  async publishResultCard(
    cardId: string,
    enrollmentId: string,
    dto: ResultCardPublishDto,
    context: RequestContext,
  ): Promise<ResultCardResponseDto> {
    this.logger.debug(`publishResultCard: cardId=${cardId}`);
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const entity = await this.dynamoDBClient.getItem<ResultCard>(
      client,
      context.tenantId,
      EntityKeyBuilder.resultCard(enrollmentId, cardId),
    );
    if (!entity || !entity.isActive) {
      throw new NotFoundException({
        errorCode: 'RESULT_CARD_NOT_FOUND',
        message: `ResultCard ${cardId} for enrollment ${enrollmentId} not found`,
      });
    }

    if (entity.status === 'published') {
      throw new ConflictException({
        errorCode: 'RESULT_ALREADY_PUBLISHED',
        message: `ResultCard ${cardId} is already published`,
      });
    }
    // status is 'draft' by elimination (V1 only has 2 states)

    const now = new Date().toISOString();
    entity.status = 'published';
    entity.publishedAt = now;
    entity.publishedBy = context.userId;
    entity.updatedAt = now;
    entity.updatedBy = context.userId;
    entity.version = (entity.version ?? 1) + 1;

    await this.dynamoDBClient.putItem(client, entity);

    // Emit `result.published` per shared-types resultPublishedSchema —
    // C.9.5 cross-year handoff consumes `isTerminal`.
    this.eventsService
      .publishResultPublished(
        context.tenantId,
        cardId,
        entity.enrollmentId,
        entity.schoolId,
        entity.termId,
        entity.examId,
        entity.isTerminalExam,
        now,
        dto.notes,
      )
      .catch((err) =>
        this.logger.error(
          `Failed to publish ResultPublished event for ${cardId}`,
          err,
        ),
      );

    return resultCardEntityToDto(entity);
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * Build a DDB FilterExpression covering filter fields not already
   * baked into the chosen index PK / SK begins_with. `status` is a DDB
   * reserved word so we use `#status` (mapped via attribute names).
   */
  private buildFilterExpression(filter: ResultCardFilterDto): string | undefined {
    const parts: string[] = [];
    if (filter.termId) parts.push('termId = :termId');
    if (filter.academicYearId) parts.push('academicYearId = :academicYearId');
    if (filter.status) parts.push('#status = :status');
    if (filter.studentId) parts.push('studentId = :studentId');
    if (filter.isTerminalExam !== undefined) parts.push('isTerminalExam = :isTerminalExam');
    if (filter.isActive !== undefined) parts.push('isActive = :isActive');
    if (filter.schoolId) parts.push('schoolId = :schoolId');
    return parts.length > 0 ? parts.join(' AND ') : undefined;
  }

  private buildFilterValues(
    filter: ResultCardFilterDto,
  ): Record<string, unknown> | undefined {
    const out: Record<string, unknown> = {};
    if (filter.termId) out[':termId'] = filter.termId;
    if (filter.academicYearId) out[':academicYearId'] = filter.academicYearId;
    if (filter.status) out[':status'] = filter.status;
    if (filter.studentId) out[':studentId'] = filter.studentId;
    if (filter.isTerminalExam !== undefined) out[':isTerminalExam'] = filter.isTerminalExam;
    if (filter.isActive !== undefined) out[':isActive'] = filter.isActive;
    if (filter.schoolId) out[':schoolId'] = filter.schoolId;
    return Object.keys(out).length > 0 ? out : undefined;
  }

  /**
   * Map DDB reserved-word workaround when `status` is in the filter.
   */
  private buildFilterNames(
    filter: ResultCardFilterDto,
  ): Record<string, string> | undefined {
    if (filter.status) return { '#status': 'status' };
    return undefined;
  }

  /**
   * Decode base64-encoded LastEvaluatedKey cursor for DDB pagination.
   * Mirrors the encoding done by `DynamoDBClientService.queryGSI`.
   */
  private decodeCursor(cursor?: string): Record<string, unknown> | undefined {
    if (!cursor) return undefined;
    try {
      return JSON.parse(Buffer.from(cursor, 'base64').toString('utf8'));
    } catch {
      // Malformed cursor — caller can retry from the beginning
      return undefined;
    }
  }

}
