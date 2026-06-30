/**
 * Sequence Generator Service
 *
 * Generates sequential, human-readable numbers for invoices and receipts.
 * Uses DynamoDB atomic counter (UpdateItem with ADD) for thread-safe sequences.
 *
 * Format: INV-{schoolPrefix}-{YYMM}-{seq} e.g. INV-ACD-2503-0001
 *         RCP-{schoolPrefix}-{YYMM}-{seq} e.g. RCP-ACD-2503-0001
 *
 * Sprint E.1a — added `incrementSequenceBy(... n)`: a SINGLE atomic ADD
 * of `n` that reserves a contiguous block of sequence values. The bulk
 * worker calls this once per job instead of `nextInvoiceNumber` per
 * student, collapsing 1200 individual hits on the
 * `SEQUENCE#{schoolId}#INVOICE#{YYMM}` partition row into ONE.
 *
 * The pre-E.1a `nextInvoiceNumber` shape is preserved for the existing
 * sync `generate()` callers; only the bulk worker uses the batch-reserve
 * path. Both methods share the same retry-on-throttle envelope.
 */

import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBDocumentClient, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { EntityKeyBuilder } from '../entities/base.entity';
import { FinanceMetricsService } from './finance-metrics.service';

/**
 * CW metric namespace for #344 sequence-reservation observability.
 * Matches the existing `Edforge/Analytics` pattern from the analytics
 * Lambdas (`server/lib/analytics/lambda/rollup/handler.ts`).
 */
const METRICS_NAMESPACE = 'Edforge/Finance/Sequence';

/**
 * Sprint E.1a — hard cap on the batch-reserve size. Matches the
 * bulk-generate DTO cap (`bulkGenerateInvoiceSchema.studentIds.max(5000)`)
 * so a single worker call can pre-allocate the whole range without
 * splitting. Anything past 5000 is a DTO-level rejection upstream.
 */
const MAX_BATCH_RESERVE = 5000;

/**
 * Sprint E.1a — retry envelope for the throttle-prone classes returned
 * by DDB. Mirrors the shape of `DynamoDBClientService.batchWriteItems`
 * (jittered exponential) so the system behavior is uniform: bounded
 * retries on transient throughput pressure, immediate throw on real
 * errors (ConditionalCheckFailedException, ValidationException).
 *
 * Base delays 50/200/800 ms ±50% jitter, max 3 attempts (4 total
 * including the original); base * 2^attempt cap. The cap floor on the
 * first attempt is intentional — the BLOCKER finding in the Sprint E.1
 * audit was that `incrementSequence` threw on FIRST throttle with no
 * retry; the worker would then fail on the per-job sequence reservation
 * (which is the ONLY pre-flight call), abandoning the entire batch.
 */
const RETRYABLE_DDB_ERRORS = new Set([
  'ProvisionedThroughputExceededException',
  'ItemCollectionSizeLimitExceededException',
  'ThrottlingException',
  // RequestLimitExceeded fires when an account-level DDB call rate cap
  // is briefly tripped. Same shape — transient, worth a retry.
  'RequestLimitExceeded',
]);

const MAX_RETRIES = 3; // 4 total attempts including the original.

/**
 * Add a jitter envelope to a base delay so concurrent retries don't
 * collide on the same backoff window. ±50% spread, matching the
 * batchWriteItems shape (Math.random() * 50 over 50ms base = 0-150%).
 */
function jitteredDelayMs(baseMs: number): number {
  return Math.round(baseMs + (Math.random() * baseMs));
}

@Injectable()
export class SequenceService {
  private readonly logger = new Logger(SequenceService.name);
  private readonly tableName: string;

  constructor(
    // Optional so the existing spec harness + any consumers that
    // construct SequenceService manually don't break — but at runtime
    // Nest DI always supplies the registered provider, and metrics
    // emission is unconditional on the hot path.
    private readonly metrics?: FinanceMetricsService,
  ) {
    this.tableName = process.env.TABLE_NAME || 'edforge-finance';
  }

  async nextInvoiceNumber(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    schoolPrefix?: string,
  ): Promise<string> {
    const prefix = schoolPrefix || schoolId.substring(0, 3).toUpperCase();
    const yyMM = this.getYYMM();
    const sequenceType = `INVOICE#${yyMM}`;
    const seq = await this.incrementSequence(client, tenantId, schoolId, sequenceType);
    return `INV-${prefix}-${yyMM}-${String(seq).padStart(4, '0')}`;
  }

  async nextReceiptNumber(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    schoolPrefix?: string,
  ): Promise<string> {
    const prefix = schoolPrefix || schoolId.substring(0, 3).toUpperCase();
    const yyMM = this.getYYMM();
    const sequenceType = `RECEIPT#${yyMM}`;
    const seq = await this.incrementSequence(client, tenantId, schoolId, sequenceType);
    return `RCP-${prefix}-${yyMM}-${String(seq).padStart(4, '0')}`;
  }

  /**
   * Sprint E.1a — batch-reserve `n` sequence values in a SINGLE atomic
   * `ADD :n` on the sequence row. Returns the start-of-range so the
   * caller can slice `[startValue, endValue)` locally without further
   * DDB calls.
   *
   * Worker usage: caller pre-formats invoice numbers via
   * `INV-{prefix}-{YYMM}-{String(startValue + i).padStart(4, '0')}` for
   * `i` in `[0, n)` and passes the pre-allocated number into the per-
   * student generate path (which skips its own `nextInvoiceNumber` call).
   *
   * Failure modes — failed/skipped students leave GAPS in the sequence.
   * That's acceptable; gaps are already possible today on `putItem`
   * failure during the existing sync path. The worker MUST NOT try to
   * reclaim gaps — that races with other concurrent workers.
   *
   * Validation:
   *   - `n` must be `> 0` and `<= MAX_BATCH_RESERVE` (5000). Outside
   *     that window throws synchronously (programming error, not
   *     operator input — the DTO already caps studentIds at 5000).
   *
   * Retry policy:
   *   - ConditionalCheckFailedException / ValidationException → throw
   *     immediately (these are real errors, not transient).
   *   - ProvisionedThroughputExceededException +
   *     ItemCollectionSizeLimitExceededException +
   *     ThrottlingException + RequestLimitExceeded → up to 3 retries
   *     with jittered exponential backoff (50/200/800 ms ±50%).
   *   - 4th failure → throw with schoolId + n + cumulative latency
   *     for forensic correlation.
   */
  async incrementSequenceBy(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    sequenceType: string,
    n: number,
  ): Promise<{ startValue: number; endValue: number }> {
    if (!Number.isInteger(n) || n <= 0) {
      throw new Error(
        `incrementSequenceBy: n must be a positive integer; got ${n}`,
      );
    }
    if (n > MAX_BATCH_RESERVE) {
      throw new Error(
        `incrementSequenceBy: n=${n} exceeds MAX_BATCH_RESERVE=${MAX_BATCH_RESERVE}`,
      );
    }

    const entityKey = EntityKeyBuilder.sequence(schoolId, sequenceType);
    const startedAt = Date.now();

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const result = await client.send(new UpdateCommand({
          TableName: this.tableName,
          Key: { tenantId, entityKey },
          UpdateExpression:
            'SET #val = if_not_exists(#val, :zero) + :n, entityType = :et',
          ExpressionAttributeNames: { '#val': 'currentValue' },
          ExpressionAttributeValues: {
            ':zero': 0,
            ':n': n,
            ':et': 'SEQUENCE',
          },
          ReturnValues: 'ALL_NEW',
        }));
        const newValue = (result.Attributes as any).currentValue as number;
        // `newValue` is the post-increment counter (the highest value
        // assigned by this call). The reserved range is the contiguous
        // block ending at `newValue`. Caller treats it as
        // `[startValue, endValue)` (half-open) — endValue is exclusive,
        // first unreserved value.
        const endValue = newValue + 1;
        const startValue = newValue + 1 - n;
        // #344 — emit CW metrics for sequence batch-reserve.
        // `BatchReserveCount` SUMs to total invoices issued per
        // schoolId — a regression to per-student reservation would
        // show as N data-points where N matches invoice count instead
        // of job count. `BatchReserveLatencyMs` p95 climbing past
        // ~500ms is the alarm signal that the partition row is hot.
        const latencyMs = Date.now() - startedAt;
        const dims = { schoolId, sequenceType };
        this.metrics?.put({
          namespace: METRICS_NAMESPACE,
          metricName: 'BatchReserveCount',
          value: n,
          unit: 'Count',
          dimensions: dims,
        });
        this.metrics?.put({
          namespace: METRICS_NAMESPACE,
          metricName: 'BatchReserveLatencyMs',
          value: latencyMs,
          unit: 'Milliseconds',
          dimensions: dims,
        });
        // #344 round-2 (PR #350 deploy follow-up): emit a NO-DIMENSION
        // companion of BatchReserveLatencyMs so a plain
        // `cloudwatch.Metric` (with no dimensionsMap) in the CDK alarm
        // can read it. CloudWatch metric alarms reject SEARCH
        // expressions (CFN: "SEARCH is not supported on Metric
        // Alarms"), so the alarm cannot aggregate over the dimensioned
        // per-school stream. The no-dim companion gives the alarm a
        // single fleet-wide stream to evaluate p95 against. Dashboard
        // widgets continue to use SEARCH on the dimensioned stream for
        // per-school breakdown — both signals coexist cleanly.
        // Cost: +1 metric stream in CW = ~$0.30/month at one school;
        // independent of per-school cardinality.
        this.metrics?.put({
          namespace: METRICS_NAMESPACE,
          metricName: 'BatchReserveLatencyMs',
          value: latencyMs,
          unit: 'Milliseconds',
          // No `dimensions` — intentional fleet-aggregate stream.
        });
        this.metrics?.put({
          namespace: METRICS_NAMESPACE,
          metricName: 'BatchReserveAttempts',
          value: attempt + 1,
          unit: 'Count',
          dimensions: dims,
        });
        this.logger.log(
          `incrementSequenceBy schoolId=${schoolId} sequenceType=${sequenceType} ` +
            `n=${n} startValue=${startValue} latencyMs=${latencyMs} attempts=${attempt + 1}`,
        );
        return { startValue, endValue };
      } catch (err: any) {
        const name = err?.name ?? '';
        if (!RETRYABLE_DDB_ERRORS.has(name)) {
          // Real error — never retry. Surface up to the worker which
          // treats this as a job-level catastrophe (markFailed).
          throw err;
        }
        if (attempt === MAX_RETRIES) {
          const elapsedMs = Date.now() - startedAt;
          throw new Error(
            `incrementSequenceBy: gave up after ${MAX_RETRIES + 1} attempts ` +
              `(${elapsedMs}ms elapsed) for schoolId=${schoolId} ` +
              `sequenceType=${sequenceType} n=${n}; last error: ${name}: ${err?.message ?? ''}`,
          );
        }
        const delay = jitteredDelayMs(50 * Math.pow(4, attempt));
        this.logger.warn(
          `incrementSequenceBy: ${name} on attempt ${attempt + 1}/${MAX_RETRIES + 1} ` +
            `for schoolId=${schoolId} sequenceType=${sequenceType} n=${n}; ` +
            `retrying in ${delay}ms`,
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
    // Unreachable — the loop either returns or throws on the last attempt.
    throw new Error('incrementSequenceBy: unreachable retry-loop exit');
  }

  /**
   * Sprint E.1a — exposed YYMM helper so callers (worker) can build
   * the same sequenceType key the per-student `nextInvoiceNumber`
   * would generate. Stays on the service so the format remains in one
   * place.
   */
  getInvoiceSequenceType(): string {
    return `INVOICE#${this.getYYMM()}`;
  }

  /**
   * Sprint E.1a — exposed helper for the bulk worker to format invoice
   * numbers identically to `nextInvoiceNumber` from a pre-allocated
   * sequence value. Kept here so the format lives in one place and a
   * future format change ripples through both code paths.
   */
  formatInvoiceNumber(schoolId: string, sequenceValue: number, schoolPrefix?: string): string {
    const prefix = schoolPrefix || schoolId.substring(0, 3).toUpperCase();
    return `INV-${prefix}-${this.getYYMM()}-${String(sequenceValue).padStart(4, '0')}`;
  }

  private async incrementSequence(
    client: DynamoDBDocumentClient,
    tenantId: string,
    schoolId: string,
    sequenceType: string,
  ): Promise<number> {
    const entityKey = EntityKeyBuilder.sequence(schoolId, sequenceType);

    const result = await client.send(new UpdateCommand({
      TableName: this.tableName,
      Key: { tenantId, entityKey },
      UpdateExpression: 'SET #val = if_not_exists(#val, :zero) + :inc, entityType = :et',
      ExpressionAttributeNames: { '#val': 'currentValue' },
      ExpressionAttributeValues: {
        ':zero': 0,
        ':inc': 1,
        ':et': 'SEQUENCE',
      },
      ReturnValues: 'ALL_NEW',
    }));

    return (result.Attributes as any).currentValue as number;
  }

  private getYYMM(): string {
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    return `${yy}${mm}`;
  }
}
