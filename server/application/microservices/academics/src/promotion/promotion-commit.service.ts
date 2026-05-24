/**
 * PromotionCommitService — Sprint D.2.6
 *
 * Atomically commits operator-reviewed promotion decisions. Chunked at
 * 100 ops per `TransactWriteItems` (DDB hard limit). Per-chunk audit +
 * event; failures surface per-decision so the operator can investigate
 * which rows failed and retry them.
 *
 * **What each decision writes:**
 *
 * | decision         | AY1 Enrollment (Update)     | AY2 Provisional (Put) |
 * |------------------|-----------------------------|------------------------|
 * | promoted         | promotionDecision='promoted'| YES — provisional row created with priorEnrollmentId |
 * | conditional      | promotionDecision='conditional' | YES — same as promoted (V1 treats them operationally identical per d2-sprint-plan §8 #7) |
 * | retained         | promotionDecision='retained'| no AY2 row (operator may manually re-enroll in AY1 grade later) |
 * | graduated        | promotionDecision='graduated', status='graduated' | no AY2 row |
 * | withdrawn        | promotionDecision='withdrawn', status='withdrawn' | no AY2 row |
 * | transferred_out  | promotionDecision='transferred_out', status='transferred' | no AY2 row |
 *
 * **Write-once enforcement (D.2.7 AC):** the Update on AY1 enrollments
 * is guarded by `attribute_not_exists(promotionDecision)` so a second
 * commit on the same enrollment surfaces as a per-decision failure
 * (operator was racing the same student through two parallel sessions).
 *
 * **GSI10 (D.2.7) population:** the new provisional Enrollment's factory
 * (`createEnrollmentEntity`) auto-populates `gsi10pk`/`gsi10sk` when
 * `priorEnrollmentId` is set. No explicit GSI write needed here.
 *
 * **Atomicity:** Per chunk, all ops succeed together or all roll back.
 * Chunks are independent — chunk N+1 still runs if chunk N succeeded
 * (the operator only retries the failed chunk's enrollmentIds).
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.6
 */

import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import {
  EntityKeyBuilder,
  RequestContext,
} from '../common/entities/base.entity';
import {
  Enrollment,
  createEnrollmentEntity,
} from '../common/entities/enrollment.entity';
import type {
  PromotionCommitRequestDto,
  PromotionCommitResponseDto,
  PromotionCommitDecisionDto,
  PromotionDecision,
} from '@aibrains/shared-types';

const CHUNK_SIZE = 100; // DDB TransactWriteItems hard limit
const COHORT_CAP = 500;

interface ChunkResult {
  ok: boolean;
  reason?: string;
}

interface CommitFailure {
  enrollmentId: string;
  reason: string;
}

@Injectable()
export class PromotionCommitService {
  private readonly logger = new Logger(PromotionCommitService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
  ) {}

  /**
   * Commit operator-reviewed decisions. Returns aggregate counts +
   * per-enrollment failure list for retry.
   */
  async commit(
    schoolId: string,
    fromAyId: string,
    targetAyId: string,
    body: PromotionCommitRequestDto,
    context: RequestContext,
  ): Promise<PromotionCommitResponseDto> {
    this.logger.debug(
      `commit: entry schoolId=${schoolId} fromAyId=${fromAyId} targetAyId=${targetAyId} decisions=${body.decisions.length}`,
    );

    if (fromAyId === targetAyId) {
      throw new BadRequestException(
        'fromAyId and targetAyId must differ for a cross-year promotion commit',
      );
    }
    if (body.decisions.length > COHORT_CAP) {
      // Shared-types schema also caps at 500; second-line defense at service.
      throw new BadRequestException(
        `Decisions count ${body.decisions.length} exceeds cap of ${COHORT_CAP}`,
      );
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Pre-fetch every source AY1 enrollment so we can populate the new
    // AY2 provisional row's studentId, sectionId, etc. without a second
    // GetItem inside the transaction. Misses surface as per-decision
    // failures.
    const prereadByEnrollmentId = new Map<string, Enrollment>();
    const preReadFailures: CommitFailure[] = [];
    for (const decision of body.decisions) {
      const existing = await this.findEnrollmentById(
        client,
        context.tenantId,
        schoolId,
        fromAyId,
        decision.enrollmentId,
      );
      if (existing) {
        prereadByEnrollmentId.set(decision.enrollmentId, existing);
      } else {
        preReadFailures.push({
          enrollmentId: decision.enrollmentId,
          reason: 'source AY1 enrollment not found',
        });
      }
    }

    // Chunk + TransactWrite + collect failures.
    let committedCount = 0;
    let chunksSucceeded = 0;
    const allFailures: CommitFailure[] = [...preReadFailures];

    const validDecisions = body.decisions.filter(
      (d) => prereadByEnrollmentId.has(d.enrollmentId),
    );
    const chunksTotal = Math.ceil(validDecisions.length / CHUNK_SIZE);

    for (let i = 0; i < validDecisions.length; i += CHUNK_SIZE) {
      const chunk = validDecisions.slice(i, i + CHUNK_SIZE);
      const chunkIndex = i / CHUNK_SIZE;
      const result = await this.writeChunk(
        client,
        chunk,
        prereadByEnrollmentId,
        schoolId,
        fromAyId,
        targetAyId,
        context,
      );

      if (result.ok) {
        chunksSucceeded += 1;
        committedCount += chunk.length;
        this.eventsService.publishEnrollmentPromoted(
          context.tenantId, schoolId, fromAyId, targetAyId,
          chunkIndex, chunk.length, chunk.length,
        ).catch((err) =>
          this.logger.error('Failed to publish EnrollmentPromoted event', err as Error),
        );
      } else {
        // Whole chunk rolled back. Mark every decision in the chunk as
        // failed so the operator can retry. The TransactionCanceledException
        // body identifies the cancelling op index; for clean error surface
        // we just mark every row in the chunk.
        for (const d of chunk) {
          allFailures.push({
            enrollmentId: d.enrollmentId,
            reason: result.reason ?? 'chunk transaction canceled',
          });
        }
      }
    }

    return {
      fromAyId,
      targetAyId,
      schoolId,
      committedCount,
      chunksTotal,
      chunksSucceeded,
      failures: allFailures.length > 0 ? allFailures : undefined,
    };
  }

  /**
   * Build the TransactWrite ops for a chunk and execute.
   */
  private async writeChunk(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    chunk: PromotionCommitDecisionDto[],
    prereadByEnrollmentId: Map<string, Enrollment>,
    schoolId: string,
    fromAyId: string,
    targetAyId: string,
    context: RequestContext,
  ): Promise<ChunkResult> {
    const tableName = this.dynamoDBClient.getTableName();
    const now = new Date().toISOString();
    const ops: Array<Record<string, unknown>> = [];

    for (const decision of chunk) {
      const ay1 = prereadByEnrollmentId.get(decision.enrollmentId);
      if (!ay1) continue; // already in preReadFailures

      // 1. PATCH the AY1 enrollment with the decision + (for terminal
      //    decisions) a status transition.
      const targetStatus = this.statusForDecision(decision.decision);
      const updateExprParts = [
        'promotionDecision = :decision',
        'updatedAt = :updatedAt',
        'updatedBy = :updatedBy',
        'version = version + :inc',
      ];
      const updateValues: Record<string, unknown> = {
        ':decision': decision.decision,
        ':updatedAt': now,
        ':updatedBy': context.userId,
        ':inc': 1,
      };
      if (targetStatus) {
        updateExprParts.push('#status = :newStatus');
        updateValues[':newStatus'] = targetStatus;
      }
      ops.push({
        Update: {
          TableName: tableName,
          Key: {
            tenantId: context.tenantId,
            entityKey: EntityKeyBuilder.enrollment(schoolId, fromAyId, ay1.studentId),
          },
          UpdateExpression: `SET ${updateExprParts.join(', ')}`,
          // Write-once guard on promotionDecision per D.2.7 AC.
          ConditionExpression: 'attribute_not_exists(promotionDecision)',
          ExpressionAttributeValues: updateValues,
          ExpressionAttributeNames: targetStatus ? { '#status': 'status' } : undefined,
        },
      });

      // 2. For promoted / conditional decisions, also Put the AY2
      //    provisional enrollment row (factory populates GSI10 sparsely
      //    via `priorEnrollmentId`).
      if (decision.decision === 'promoted' || decision.decision === 'conditional') {
        if (!decision.targetGradeLevel) {
          // Schema-refine already enforced this; defensive only.
          continue;
        }
        const newEnrollmentId = uuid();
        const provisional = createEnrollmentEntity(
          context.tenantId,
          newEnrollmentId,
          ay1.studentId,
          schoolId,
          targetAyId,
          {
            studentName: ay1.studentName,
            gradeLevel: decision.targetGradeLevel,
            status: 'provisional',
            entryDate: now.split('T')[0]!,
            enrollmentDate: now.split('T')[0]!,
            startDate: now.split('T')[0]!,
            enrollmentType: 'returning',
            priorEnrollmentId: ay1.enrollmentId,
            sectionId: undefined, // operator assigns section post-flip
            createdAt: now,
            createdBy: context.userId,
            updatedAt: now,
            updatedBy: context.userId,
            version: 1,
          },
        );
        ops.push({
          Put: {
            TableName: tableName,
            Item: provisional as unknown as Record<string, unknown>,
            ConditionExpression: 'attribute_not_exists(entityKey)',
          },
        });
      }
    }

    if (ops.length === 0) {
      return { ok: true };
    }

    try {
      await this.dynamoDBClient.transactWrite(client, ops);
      return { ok: true };
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`writeChunk: chunk canceled — ${reason}`);
      return { ok: false, reason };
    }
  }

  /**
   * Map decision → target status for AY1 row. Returns undefined for
   * decisions that don't change AY1 status (promoted/conditional/retained
   * — AY1 stays whatever it was; new AY2 row takes over).
   */
  private statusForDecision(decision: PromotionDecision): string | undefined {
    switch (decision) {
      case 'graduated':       return 'graduated';
      case 'withdrawn':       return 'withdrawn';
      case 'transferred_out': return 'transferred';
      // promoted / conditional / retained: AY1 status unchanged
      default:                return undefined;
    }
  }

  /**
   * Resolves an enrollment by enrollmentId within (schoolId, fromAyId).
   * Uses GSI1 begins_with for the AY1+gradeLevel range, then filters by
   * enrollmentId. For V1 cohort sizes this is bounded by COHORT_CAP.
   *
   * **No Limit on the query.** DynamoDB applies `Limit` BEFORE
   * `FilterExpression`, so any `Limit: 1` here would return the FIRST
   * key-matching item and then filter — yielding empty if that one
   * item's enrollmentId doesn't match, even though a matching row
   * exists further in the cohort. The (schoolId, fromAyId) partition
   * is bounded by V1 enrollment volume (PABSON school ~500 students
   * max per AY) and fits within DDB's 1 MB page default; no pagination
   * needed for V1. If V1.5 ever exceeds the page, switch to bulk-fetch
   * + in-memory map at the commit() entry rather than N queries here.
   */
  private async findEnrollmentById(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    tenantId: string,
    schoolId: string,
    fromAyId: string,
    enrollmentId: string,
  ): Promise<Enrollment | null> {
    const result = await this.dynamoDBClient.queryGSI<Enrollment>(
      client,
      'GSI1',
      `TENANT#${tenantId}#SCHOOL#${schoolId}`,
      `ENROLLMENT#${fromAyId}#`,
      'begins_with',
      'enrollmentId = :enrollmentId',
      { ':enrollmentId': enrollmentId },
      undefined,
      undefined, // no Limit — DDB Limit applies before FilterExpression
    );
    return result.items[0] ?? null;
  }
}
