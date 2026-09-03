/**
 * FinanceMetricsService — hot-path CW metric emitter
 * (issues #344 sequence + #345 worker per-stage)
 *
 * Wraps `@aws-sdk/client-cloudwatch` `PutMetricData` for finance-internal
 * observability. The Sprint E load test against dev-pabson-primary
 * (docs/perf/finance-bulk-generate-load-2026Q3.md, 2026-06-29) hit a
 * throughput wall — 11× slower per-student than the audit projection.
 * The ECS dashboard surfaced CPU saturation as the root cause; this
 * service emits the per-stage timings + sequence-reservation metrics
 * needed to localize where the time goes in the next load test.
 *
 * DESIGN RULES (all enforced by this file's implementation, not by
 * caller discipline):
 *
 *  1. **Best-effort, never throws.** Every public method swallows
 *     CW errors with a warn-log. Instrumentation MUST NOT break the
 *     hot path; a CW outage at any layer (network, IAM, throttle)
 *     never propagates back to `SequenceService.incrementSequenceBy`
 *     or `BulkInvoiceGenerateWorker.run`.
 *
 *  2. **Batched flush.** CW `PutMetricData` accepts up to 20 metric
 *     datums per call (or 40 KB payload, whichever first). We buffer
 *     in memory and flush every 5s OR when the buffer hits 20 datums
 *     OR on `onModuleDestroy` (NestJS shutdown hook). Saves
 *     ~20× the request volume vs per-emit calls — critical at the
 *     worker's 8-concurrent per-student emission rate.
 *
 *  3. **Per-school dimensions.** Every metric carries `schoolId` as
 *     a CW dimension (and `sequenceType` or `jobId` where useful).
 *     Bounded by tenant count, NOT user activity → keeps CW costs
 *     predictable. Fleet-scale (50+ schools) re-evaluation noted in
 *     docs/perf/finance-instrumentation.md.
 *
 *  4. **No dependency on the rest of the finance module.** Stateless,
 *     no DDB, no identity calls — just the CW client + a flush timer.
 *     Provisioned at the FinanceModule root so all services share one
 *     buffer.
 *
 * Why inline-emit was rejected: the worker emits ~4 per-stage timings
 * × 284 students × 8 concurrent → ~1100 PutMetricData calls if each
 * emit hit CW directly. At 5 datums per call × batching of 20 datums
 * we collapse that to ~55 actual API requests. The 5s flush interval
 * + 20-datum-flush is the AWS-recommended pattern (matches CloudWatch
 * Agent's own batching behavior).
 */

import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  CloudWatchClient,
  PutMetricDataCommand,
  type StandardUnit,
} from '@aws-sdk/client-cloudwatch';
import { isLambdaRuntime } from '@app/common-utils';

/** CW hard limit per PutMetricData call. */
const CW_MAX_DATUMS_PER_CALL = 20;
/** Flush interval — chosen to match CloudWatch Agent's default. */
const FLUSH_INTERVAL_MS = 5_000;

interface Datum {
  namespace: string;
  metricName: string;
  value: number;
  unit: StandardUnit;
  dimensions: Array<{ Name: string; Value: string }>;
  timestamp: Date;
}

@Injectable()
export class FinanceMetricsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(FinanceMetricsService.name);
  private readonly client: CloudWatchClient;
  private readonly buffer: Datum[] = [];
  private flushTimer?: NodeJS.Timeout;

  constructor() {
    // Region resolution: prefer AWS_REGION (set by ECS task def) and
    // fall back to the SDK's own credential-provider chain. No explicit
    // credentials — the task role's instance metadata is used at runtime.
    this.client = new CloudWatchClient({
      region: process.env.AWS_REGION || 'ap-south-1',
    });
  }

  onModuleInit(): void {
    // Lambda freezes the environment between invocations, so a periodic
    // flush never fires on schedule; metrics are flushed explicitly at the
    // end of each invocation instead (cost-redesign C3.10).
    if (isLambdaRuntime()) return;
    this.flushTimer = setInterval(
      () => void this.flush(),
      FLUSH_INTERVAL_MS,
    );
    // `unref` so the timer doesn't keep the Node.js process alive
    // during graceful shutdown — Nest's shutdown hook will call
    // onModuleDestroy explicitly to flush remaining datums.
    this.flushTimer.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = undefined;
    }
    // Drain any pending datums before shutdown so the operator doesn't
    // lose the last ~5s of metrics on every ECS rolling update.
    await this.flush();
  }

  /**
   * Record a single metric datum. Returns immediately — actual CW emit
   * happens on the next flush tick OR when the buffer reaches the
   * 20-datum cap (whichever first).
   *
   * Hot-path safe: synchronous + non-throwing. The CW call latency is
   * deferred to the flush loop so the caller's wall is unaffected.
   */
  put(input: {
    namespace: string;
    metricName: string;
    value: number;
    unit?: StandardUnit;
    dimensions?: Record<string, string>;
  }): void {
    const datum: Datum = {
      namespace: input.namespace,
      metricName: input.metricName,
      value: input.value,
      unit: input.unit ?? 'None',
      dimensions: Object.entries(input.dimensions ?? {}).map(([Name, Value]) => ({
        Name,
        Value,
      })),
      timestamp: new Date(),
    };
    this.buffer.push(datum);
    // Eager flush on cap — avoids unbounded buffer growth under burst load.
    if (this.buffer.length >= CW_MAX_DATUMS_PER_CALL) {
      void this.flush();
    }
  }

  /**
   * Drain the buffer to CW in 20-datum chunks per call, grouped by
   * namespace (PutMetricData accepts only one namespace per call).
   *
   * Swallow + warn-log all errors. The `void` annotation on every
   * caller of this method makes the silent-failure contract explicit.
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const drained = this.buffer.splice(0, this.buffer.length);
    // Group by namespace: CW rejects PutMetricData with mixed namespaces.
    const byNs = new Map<string, Datum[]>();
    for (const d of drained) {
      const arr = byNs.get(d.namespace) ?? [];
      arr.push(d);
      byNs.set(d.namespace, arr);
    }

    for (const [namespace, datums] of byNs) {
      // Chunk into ≤20-datum batches per CW's hard limit.
      for (let i = 0; i < datums.length; i += CW_MAX_DATUMS_PER_CALL) {
        const chunk = datums.slice(i, i + CW_MAX_DATUMS_PER_CALL);
        try {
          await this.client.send(
            new PutMetricDataCommand({
              Namespace: namespace,
              MetricData: chunk.map(d => ({
                MetricName: d.metricName,
                Value: d.value,
                Unit: d.unit,
                Dimensions: d.dimensions,
                Timestamp: d.timestamp,
              })),
            }),
          );
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `FinanceMetricsService.flush failed for namespace=${namespace} ` +
              `chunkSize=${chunk.length}: ${message.slice(0, 200)}`,
          );
          // Do NOT re-buffer on failure — that would risk a feedback
          // loop where CW outage causes unbounded memory growth here.
          // The metric is lost; that's the deal with best-effort
          // instrumentation. The structured-log line emitted alongside
          // each metric (in the SequenceService + worker code) is the
          // backup forensic trail.
        }
      }
    }
  }

  /** Buffer size — exposed for spec assertions. */
  bufferLength(): number {
    return this.buffer.length;
  }
}
