/**
 * EnrollmentFlipService — Sprint D.2.10
 *
 * Atomic provisional→enrolled flip for AY2 enrollments created by D.2.6
 * commit. Triggered (synchronously, in-process) from
 * `EnrollmentTransitionHandlerService` on `result.published` for a
 * terminal exam.
 *
 * **Invariant 3 guarantees (THE primary invariant of this sprint):**
 *   1. `enrollmentId` is NEVER mutated by the flip. Only `status` (and
 *      audit fields) change.
 *   2. `gradeLevel` is NEVER mutated by the flip. The provisional row
 *      already carries the target gradeLevel from D.2.6.
 *   3. Existing Attendance / ExamScore / ResultCard rows under either
 *      AY1 or AY2 enrollmentIds remain untouched.
 *   4. For retained-cohort students: NO flip happens here (no provisional
 *      row was created during D.2.6 commit). The prior-AY enrollment
 *      retains its attendance/exam/result history intact.
 *
 * **Idempotency:** Update is guarded by `status = :provisional` condition
 * expression. A re-fired handler on already-flipped rows is a no-op
 * (ConditionalCheckFailed → counted as `skipped`, not `failed`).
 *
 * **Chunking:** TransactWriteItems chunked at 100. Per-chunk audit +
 * event. Per-chunk atomicity — chunk failure rolls back that chunk only.
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.10
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { Enrollment } from '../common/entities/enrollment.entity';
import { EntityKeyBuilder } from '../common/entities/base.entity';

const CHUNK_SIZE = 100;

export interface FlipContext {
  tenantId: string;
  userId: string;
  /** The cardId whose `result.published` event triggered this flip — for traceability. */
  triggeringCardId: string;
}

export interface FlipResult {
  flipped: number;
  skipped: number;
  failures: Array<{ enrollmentId: string; reason: string }>;
}

@Injectable()
export class EnrollmentFlipService {
  private readonly logger = new Logger(EnrollmentFlipService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: AcademicsEventsService,
  ) {}

  /**
   * Flip the supplied provisional enrollments to `enrolled`. Per-chunk
   * TransactWriteItems with `status = 'provisional'` precondition.
   *
   * Caller (D.2.9 handler) must hand in fully-loaded Enrollment rows so
   * we have the primary key + studentId for the Update target.
   */
  async promoteProvisionalToEnrolled(
    provisionals: Enrollment[],
    context: FlipContext,
  ): Promise<FlipResult> {
    this.logger.debug(
      `promoteProvisionalToEnrolled: entry, provisionals=${provisionals.length}, triggeringCardId=${context.triggeringCardId}`,
    );

    const result: FlipResult = { flipped: 0, skipped: 0, failures: [] };

    // Filter out any rows already flipped (defensive — caller should only
    // pass `status === 'provisional'` rows, but a race with another flip
    // could leave duplicates).
    const candidates = provisionals.filter((p) => p.status === 'provisional');
    if (candidates.length < provisionals.length) {
      const alreadyFlipped = provisionals.length - candidates.length;
      result.skipped += alreadyFlipped;
      this.logger.debug(
        `promoteProvisionalToEnrolled: ${alreadyFlipped} rows already non-provisional, skipped`,
      );
    }

    // Use the system DDB client — this flip is system-initiated from
    // ResultCardsService.publish via the transition handler, not from a
    // user request, so we don't have a JWT to assume an ABAC role with.
    // The system client bypasses ABAC (intentional for internal writes).
    const client = this.dynamoDBClient.getSystemClient();

    for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
      const chunk = candidates.slice(i, i + CHUNK_SIZE);
      const chunkResult = await this.flipChunk(client, chunk, context);
      result.flipped += chunkResult.flipped;
      result.skipped += chunkResult.skipped;
      result.failures.push(...chunkResult.failures);
    }

    this.eventsService.publishEnrollmentFlipped(
      context.tenantId,
      context.triggeringCardId,
      result.flipped,
      result.skipped,
      result.failures.length,
    ).catch((err) =>
      this.logger.error('Failed to publish EnrollmentFlipped event', err as Error),
    );

    this.logger.log(
      `promoteProvisionalToEnrolled: completed, flipped=${result.flipped}, skipped=${result.skipped}, failures=${result.failures.length}, triggeringCardId=${context.triggeringCardId}`,
    );
    return result;
  }

  /**
   * TransactWrite a single chunk. On TransactionCanceledException, fall
   * back to per-row Update so individual ConditionalCheckFailed errors
   * map cleanly to `skipped` (already-flipped) vs `failures` (other).
   */
  private async flipChunk(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    chunk: Enrollment[],
    context: FlipContext,
  ): Promise<FlipResult> {
    const tableName = this.dynamoDBClient.getTableName();
    const now = new Date().toISOString();

    const ops = chunk.map((enrollment) => ({
      Update: {
        TableName: tableName,
        Key: {
          tenantId: context.tenantId,
          entityKey: EntityKeyBuilder.enrollment(
            enrollment.schoolId,
            enrollment.academicYearId,
            enrollment.studentId,
          ),
        },
        UpdateExpression:
          'SET #status = :enrolled, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc',
        // Only flip rows that ARE provisional; idempotent on re-delivery.
        // Also assert priorEnrollmentId is set (provenance guard — D.2.10 AC).
        ConditionExpression: '#status = :provisional AND attribute_exists(priorEnrollmentId)',
        ExpressionAttributeValues: {
          ':enrolled': 'enrolled',
          ':provisional': 'provisional',
          ':updatedAt': now,
          ':updatedBy': context.userId,
          ':inc': 1,
        },
        ExpressionAttributeNames: { '#status': 'status' },
      },
    }));

    try {
      await this.dynamoDBClient.transactWrite(client, ops);
      return { flipped: chunk.length, skipped: 0, failures: [] };
    } catch (err: unknown) {
      // ONLY fall back to per-row Updates when the chunk was canceled
      // due to a TransactionCanceledException (typically a per-op
      // ConditionalCheckFailed — i.e., one or more rows were already
      // flipped). For all other failure modes (throughput, validation,
      // network, IAM, etc.) we must rethrow rather than convert one
      // transient chunk error into 100 per-row writes that will mostly
      // fail in the same way.
      const name = (err as { name?: string })?.name ?? '';
      if (name === 'TransactionCanceledException') {
        this.logger.warn(
          `flipChunk: chunk canceled (${err instanceof Error ? err.message : String(err)}); falling back to per-row Updates`,
        );
        return this.flipPerRow(client, chunk, context);
      }
      // Non-cancel error — propagate to the caller so the chunk's
      // failure surfaces in the FlipResult.failures aggregation upstream.
      throw err;
    }
  }

  /**
   * Per-row Update fallback — used after a chunk TransactionCanceledException
   * so we can attribute the failure to specific rows.
   */
  private async flipPerRow(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    chunk: Enrollment[],
    context: FlipContext,
  ): Promise<FlipResult> {
    const now = new Date().toISOString();
    const result: FlipResult = { flipped: 0, skipped: 0, failures: [] };

    for (const enrollment of chunk) {
      try {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          EntityKeyBuilder.enrollment(
            enrollment.schoolId,
            enrollment.academicYearId,
            enrollment.studentId,
          ),
          'SET #status = :enrolled, updatedAt = :updatedAt, updatedBy = :updatedBy, version = version + :inc',
          {
            ':enrolled': 'enrolled',
            ':provisional': 'provisional',
            ':updatedAt': now,
            ':updatedBy': context.userId,
            ':inc': 1,
          },
          '#status = :provisional AND attribute_exists(priorEnrollmentId)',
          { '#status': 'status' },
        );
        result.flipped += 1;
      } catch (err: unknown) {
        const name = (err as { name?: string })?.name ?? '';
        if (name === 'ConditionalCheckFailedException') {
          result.skipped += 1;
        } else {
          result.failures.push({
            enrollmentId: enrollment.enrollmentId,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return result;
  }
}
