/**
 * BulkInvoiceGenerateWorker — Sprint E.4
 *
 * Background worker that fulfills an async POST /invoices/bulk-generate
 * request. Invoked from the controller via setImmediate after the 202
 * has been returned. Mirrors today's sync `generateBulk()` semantics
 * with three structural improvements driven by the Sprint E.1 audit
 * (workflow `wf_4b726c5c-e58`):
 *
 *   1. **Batch-reserve invoice numbers (audit BLOCKER #1).** Calls
 *      `SequenceService.incrementSequenceBy(...n)` ONCE per job.
 *      All concurrent generate() calls in this worker share the
 *      pre-allocated contiguous range — the per-school sequence
 *      partition row is touched exactly once regardless of student
 *      count, collapsing the 1200-students-per-school throughput
 *      bottleneck.
 *
 *   2. **Per-job identity cache (audit HIGH #3).** SchoolName is
 *      fetched once and re-used across all students. The per-student
 *      `getStudentInfo` HTTP hop stays (worker needs each student's
 *      gradeLevel + name for the entity), but the school-level metadata
 *      is single-fetch.
 *
 *   3. **Per-student failure isolation + retry on transactional drift
 *      (audit HIGH #2 deferred to E.4).** Each student is wrapped in
 *      its own try/catch — a single failed student doesn't kill the
 *      batch. `TransactionCanceledException` +
 *      `ProvisionedThroughputExceededException` get retried via
 *      `retryWithJitter`; everything else surfaces fast and gets
 *      counted as a per-student failure (jobsService.appendFailedStudent).
 *
 * Operator decision 1: worker creates DRAFTS. `autoIssue` is hard-coded
 * false in `generateForBulkWorker`. Operator triggers the bulk-issue
 * flow after review.
 *
 * Concurrency: an inline `withConcurrencyLimit` (operator decision 4 —
 * no `p-limit` dep) drives the per-student parallelism. The level is
 * tunable via `BULK_INVOICE_GENERATE_CONCURRENCY` (default 8 — the
 * Sprint E.1 audit projected this lands ~60-90s for 600 students with
 * the batch-reserve + cached schoolName changes, well within the
 * tightened 90s acceptance gate).
 *
 * Per-school semaphore: the worker holds a `PerSchoolLock` for the
 * duration of `run()`. Two concurrent jobs for the SAME school
 * serialize; two jobs for DIFFERENT schools run in parallel. This
 * matches the operator-decision invariant that no two bulk-generate
 * jobs should be running against one school at once (or the
 * pre-allocated invoice-number ranges of the two jobs could overlap on
 * gap-recovery semantics).
 *
 * Gap handling: failed/skipped students leave gaps in the reserved
 * invoice-number range. Documented behavior — gaps are already possible
 * today on `putItem` failure during the existing sync path. The worker
 * MUST NOT try to "reclaim" gaps (would race with other workers).
 */

import { Injectable, Logger } from '@nestjs/common';
import { FinanceJobsService } from '../finance-jobs.service';
import { InvoicesService } from '../../invoices/invoices.service';
import { SequenceService } from '../../common/services/sequence.service';
import { IdentityClientService } from '../../common/services/identity-client.service';
import { FeeStructuresService } from '../../fee-structures/fee-structures.service';
import { TenantSettingsService } from '../../common/services/tenant-settings.service';
import { DynamoDBClientService } from '../../common/services/dynamodb-client.service';
import { FinanceMetricsService } from '../../common/services/finance-metrics.service';
import { PerSchoolLock } from '../util/per-school-lock';
import { withConcurrencyLimit } from '../util/concurrency-limit';
import {
  retryWithJitter,
  isTransactionCanceledOrThroughputExceeded,
} from '../util/retry-with-jitter';

/**
 * CW metric namespace for #345 worker per-stage observability.
 * Pairs with `Edforge/Finance/Sequence` from #344 — both viewable
 * together on the `EdForge-Finance-Performance` dashboard.
 */
const METRICS_NAMESPACE = 'Edforge/Finance/BulkWorker';
import type { RequestContext } from '../../common/entities/base.entity';
import type { BulkGenerateInvoiceDto } from '@aibrains/shared-types';

/**
 * The worker's input shape. Augmented from the controller's DTO with
 * (a) the resolved studentIds (so the worker doesn't re-resolve grades),
 * (b) the schoolId (which lives on the URL not the body in the
 * controller).
 */
export interface BulkInvoiceGenerateWorkerInput extends BulkGenerateInvoiceDto {
  schoolId: string;
  resolvedStudentIds: string[];
}

const DEFAULT_CONCURRENCY = 8;
const MAX_CONCURRENCY = 64; // sanity cap — env-var override gets clamped

function readConcurrency(): number {
  const raw = process.env.BULK_INVOICE_GENERATE_CONCURRENCY;
  if (!raw) return DEFAULT_CONCURRENCY;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_CONCURRENCY;
  return Math.min(parsed, MAX_CONCURRENCY);
}

@Injectable()
export class BulkInvoiceGenerateWorker {
  private readonly logger = new Logger(BulkInvoiceGenerateWorker.name);

  constructor(
    private readonly jobsService: FinanceJobsService,
    private readonly invoicesService: InvoicesService,
    private readonly sequenceService: SequenceService,
    private readonly identityClient: IdentityClientService,
    private readonly feeStructuresService: FeeStructuresService,
    private readonly tenantSettings: TenantSettingsService,
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly perSchoolLock: PerSchoolLock,
    // Optional so the existing worker spec harness (which constructs
    // the worker manually with a Partial<MockCollaborators>) doesn't
    // break. At runtime Nest DI always supplies the registered provider.
    private readonly metrics?: FinanceMetricsService,
  ) {}

  /**
   * Wrap an async hot-path step with a wall-time measurement + CW
   * metric emission. The metric is best-effort (FinanceMetricsService
   * never throws); the wrapped fn's result/throw is the caller's wall
   * — wrapping adds <1ms (just `Date.now()` math).
   *
   * Used to instrument the 4 per-student stages so the next load test
   * can localize where the per-student p95 wall goes (#345 follow-up
   * to the 6.9s/student observation on the 2026-06-29 dev-pabson run).
   */
  private async timeStage<T>(
    metricName: string,
    dims: Record<string, string>,
    fn: () => Promise<T>,
  ): Promise<T> {
    const start = Date.now();
    try {
      return await fn();
    } finally {
      this.metrics?.put({
        namespace: METRICS_NAMESPACE,
        metricName,
        value: Date.now() - start,
        unit: 'Milliseconds',
        dimensions: dims,
      });
    }
  }

  /**
   * Drive a single bulk-generate job from queued → succeeded/failed.
   *
   * Lifecycle:
   *   1. Acquire per-school lock (blocks for concurrent same-school jobs).
   *   2. markRunning + emit `finance.bulk_generate.started`.
   *   3. Pre-flight: schoolName, currency, fee structures (one-shot fetches).
   *   4. Batch-reserve invoice numbers (one DDB write for the whole job).
   *   5. Per-student loop under concurrency cap:
   *      a. Duplicate check → skip + increment skipped counter.
   *      b. retryWithJitter wrapping generateForBulkWorker.
   *      c. Success → succeeded++ + incrementCounter.
   *      d. Failure → failedStudentIds + appendFailedStudent (records
   *         error and increments processed + failed atomically).
   *   6. markCompleted + emit succeeded audit.
   *
   * Catastrophe (sequence reservation fails, identity dead, lock
   * acquisition throws) → markFailed + emit failed audit + log. We
   * NEVER let a worker exception propagate to the caller — the
   * controller already returned 202 and the operator's only signal is
   * the FinanceJob row.
   */
  async run(
    jobId: string,
    input: BulkInvoiceGenerateWorkerInput,
    context: RequestContext,
  ): Promise<void> {
    let lockHandle: { release: () => void } | undefined;
    const tStart = Date.now();

    try {
      lockHandle = await this.perSchoolLock.acquire(input.schoolId);

      // markRunning emits `finance.bulk_generate.started` automatically
      // via FinanceJobsService.emitAudit (PR #341 review F5 — service
      // is the sole audit gatekeeper for lifecycle events; the worker
      // no longer emits them directly).
      await this.jobsService.markRunning(jobId, context);

      // ─── Pre-flight ─────────────────────────────────────────────
      // SchoolName: fetched once, cached for the whole job (audit
      // HIGH #3). Falls back to schoolId on failure.
      let cachedSchoolName = input.schoolId;
      try {
        const resolved = await this.identityClient.getSchoolName(input.schoolId, context);
        if (resolved) cachedSchoolName = resolved;
      } catch {
        // swallow — the generate path already uses schoolId as fallback.
      }

      // Tenant currency: fetched once. TenantSettingsService caches
      // 5min internally but a one-call-per-worker contract avoids the
      // intra-job cache-warming race.
      const cachedCurrency = await this.tenantSettings.getCurrency(context);

      // Fee structures: prove they resolve once. The per-student
      // path also calls getByIds (the same call hits the
      // FeeStructuresService cache), but a pre-flight here surfaces
      // a "no fee structures match" failure as a single worker-level
      // catastrophe rather than N per-student failures.
      const feeStructures = await this.feeStructuresService.getByIds(
        input.schoolId,
        input.feeStructureIds,
        context,
      );
      if (feeStructures.length === 0) {
        throw new Error(
          `No valid fee structures resolved for schoolId=${input.schoolId} ` +
            `feeStructureIds=[${input.feeStructureIds.join(',')}]`,
        );
      }

      // ─── skipZeroTotal pre-filter (PR #341 review F4) ──────────
      // Match the sync `generateBulk()` semantics at invoices.service.ts
      // §1418-1442: when `skipZeroTotal` is true AND the projected gross
      // (customLineItems + fee-structure amounts) is exactly 0, the
      // entire batch is skipped without any sequence-number reservation
      // or generate() calls. Today's fee structures have flat `amount`
      // (no per-grade band logic — Phase 2), so the projection is the
      // same for every student in the batch.
      //
      // CRITICAL: this gate fires BEFORE `incrementSequenceBy` so we
      // don't waste sequence numbers on a batch we're about to drop.
      // The math here MUST stay in lockstep with the sync path — see
      // `invoices.service.ts` skipZeroTotal block. If you change one,
      // change both.
      if (input.skipZeroTotal) {
        const customSum = (input.customLineItems ?? []).reduce(
          (s, l) => s + (Number(l.amount) || 0),
          0,
        );
        const projectedFeeSum = feeStructures.reduce(
          (s, fs) => s + (Number(fs.amount) || 0),
          0,
        );
        if (customSum + projectedFeeSum === 0) {
          const skippedCount = input.resolvedStudentIds.length;
          await this.jobsService.markCompleted(
            jobId,
            {
              output: {},
              counters: {
                succeeded: 0,
                skipped: skippedCount,
                failed: 0,
              },
            },
            context,
          );
          this.logger.log(
            `BulkInvoiceGenerateWorker complete (skipZeroTotal early-exit) ` +
              `jobId=${jobId} schoolId=${input.schoolId} skipped=${skippedCount} ` +
              `durationMs=${Date.now() - tStart}`,
          );
          return; // markCompleted emitted `finance.bulk_generate.succeeded`.
        }
      }

      // Batch-reserve invoice numbers (audit BLOCKER #1).
      // The reservation is exactly `resolvedStudentIds.length` even
      // when duplicates / failures will leave gaps — caller can't
      // know which ones will fail ahead of time, and the cost of a
      // reserved-but-unused number is zero.
      const sequenceType = this.sequenceService.getInvoiceSequenceType();
      const sequenceClient = await this.dynamoDBClient.getClient(
        context.tenantId,
        context.jwtToken,
      );
      const { startValue } = await this.sequenceService.incrementSequenceBy(
        sequenceClient,
        context.tenantId,
        input.schoolId,
        sequenceType,
        input.resolvedStudentIds.length,
      );

      // ─── Per-student loop ──────────────────────────────────────
      let succeeded = 0;
      let skipped = 0;
      const failedStudentIds: string[] = [];
      const concurrency = readConcurrency();

      await withConcurrencyLimit(
        input.resolvedStudentIds,
        concurrency,
        async (studentId, index) => {
          const preAllocatedInvoiceNumber = this.sequenceService.formatInvoiceNumber(
            input.schoolId,
            startValue + index,
          );

          // #345 — per-student dimensions for the timed-stage metrics.
          // schoolId stays bounded by tenant count (CW cost predictable);
          // jobId is high-cardinality but needed to slice a single job
          // run on the dashboard. CW handles up to 30 dimensions per
          // metric — we use 2 (schoolId + jobId).
          const stageDims = { schoolId: input.schoolId, jobId };

          // ── Generation step (outer try): a failure here is a real
          // per-student failure that should land in failedStudentIds.
          let generationSucceeded = false;
          try {
            // Duplicate detection (same shape the sync generateBulk uses).
            // #345 — `CheckDupLatencyMs`: DDB GetItem against the
            // duplicate-detection index; should be sub-50ms p95 in
            // healthy state.
            const isDuplicate = await this.timeStage(
              'CheckDupLatencyMs',
              stageDims,
              () => this.invoicesService.checkDuplicateInvoice(
                input.schoolId,
                studentId,
                input.feeStructureIds,
                input.billingPeriod,
                context,
              ),
            );
            if (isDuplicate) {
              skipped++;
              // Skip-counter write is best-effort; a race here is bookkeeping
              // drift, not a student failure, so it's logged separately.
              // #345 — `CounterWriteLatencyMs` for the skip path; same
              // metric as the success path so we see both in the same
              // dashboard widget. The DDB UpdateItem under the hood
              // includes the F1 retry-on-Conflict envelope so this is
              // an end-to-end timing including any retries.
              try {
                await this.timeStage(
                  'CounterWriteLatencyMs',
                  stageDims,
                  () => this.jobsService.incrementCounter(jobId, 'skipped', 1, context),
                );
              } catch (counterErr: unknown) {
                const counterMessage =
                  counterErr instanceof Error ? counterErr.message : String(counterErr);
                this.logger.warn(
                  `BulkInvoiceGenerateWorker: skipped-counter increment failed jobId=${jobId} ` +
                    `studentId=${studentId}: ${counterMessage.slice(0, 200)}`,
                );
              }
              return;
            }

            // Per-student generate, retried on transactional drift.
            // #345 — `GenerateLatencyMs` covers the full
            // generateForBulkWorker call: identity HTTP for student
            // info + fee-structure resolution (mostly cached) + the
            // 3-item TransactWriteItems + any internal retries. This
            // is the SUSPECTED dominant stage per the 2026-06-29 load
            // test wall projection — instrumentation will confirm or
            // refute.
            await this.timeStage(
              'GenerateLatencyMs',
              stageDims,
              () => retryWithJitter(
                () =>
                  this.invoicesService.generateForBulkWorker(
                    input.schoolId,
                    {
                      studentId,
                      feeStructureIds: input.feeStructureIds,
                      academicYear: input.academicYear,
                      billingPeriod: input.billingPeriod,
                      dueDate: input.dueDate,
                      notes: input.notes,
                      customLineItems: input.customLineItems,
                      preAllocatedInvoiceNumber,
                      cachedSchoolName,
                      cachedCurrency,
                    } as any,
                    context,
                  ),
                {
                  attempts: 3,
                  shouldRetry: isTransactionCanceledOrThroughputExceeded,
                  baseMs: 50,
                },
              ),
            );

            // From this point the invoice IS durable in DDB.
            generationSucceeded = true;
            succeeded++;
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            failedStudentIds.push(studentId);
            // appendFailedStudent retries internally on ConflictException
            // (F1). A residual throw here is "all 3 retries lost" — drop the
            // record rather than failing the whole batch.
            try {
              await this.jobsService.appendFailedStudent(
                jobId,
                studentId,
                message,
                context,
              );
            } catch (appendErr: unknown) {
              const appendMessage =
                appendErr instanceof Error ? appendErr.message : String(appendErr);
              this.logger.warn(
                `BulkInvoiceGenerateWorker: appendFailedStudent exhausted retries jobId=${jobId} ` +
                  `studentId=${studentId}: ${appendMessage.slice(0, 200)}`,
              );
            }
          }

          // ── Bookkeeping step (separate try, PR #341 review F3): a
          // counter-write failure AFTER the invoice was durably written
          // is a bookkeeping race, NOT a student failure. Marking the
          // student failed here would leave a real invoice in DDB while
          // recording it as failed — on retry, duplicate-detection would
          // then mis-record it as failed AGAIN. Log + continue instead;
          // the operator sees the invoice in the list, and the
          // succeeded-counter is at most off by 1 per race occurrence.
          if (generationSucceeded) {
            try {
              // #345 — `CounterWriteLatencyMs` for the success path.
              // Same metric/dims as the skip-path counter write so the
              // dashboard widget shows the full distribution.
              await this.timeStage(
                'CounterWriteLatencyMs',
                stageDims,
                () => this.jobsService.incrementCounter(jobId, 'succeeded', 1, context),
              );
            } catch (counterErr: unknown) {
              const counterMessage =
                counterErr instanceof Error ? counterErr.message : String(counterErr);
              this.logger.warn(
                `BulkInvoiceGenerateWorker: succeeded-counter increment failed jobId=${jobId} ` +
                  `studentId=${studentId} (invoice already generated): ${counterMessage.slice(0, 200)}`,
              );
            }
          }
        },
      );

      // ─── Finalize ──────────────────────────────────────────────
      // markCompleted emits `finance.bulk_generate.succeeded` automatically
      // via FinanceJobsService.emitAudit (F5).
      await this.jobsService.markCompleted(
        jobId,
        { output: { /* no zip/PDF — generate jobs don't produce S3 artifacts */ } },
        context,
      );

      this.logger.log(
        `BulkInvoiceGenerateWorker complete jobId=${jobId} schoolId=${input.schoolId} ` +
          `succeeded=${succeeded} skipped=${skipped} failed=${failedStudentIds.length} ` +
          `durationMs=${Date.now() - tStart}`,
      );
    } catch (workerErr: unknown) {
      const message = workerErr instanceof Error ? workerErr.message : String(workerErr);
      this.logger.error(
        `BulkInvoiceGenerateWorker catastrophe jobId=${jobId} schoolId=${input.schoolId}: ${message}`,
      );
      // markFailed is best-effort — if IT fails, the job stays in
      // `running` until the future janitor (Sprint I) sweeps it.
      // markFailed emits `finance.bulk_generate.failed` automatically (F5).
      try {
        await this.jobsService.markFailed(jobId, message, context);
      } catch (markErr: unknown) {
        const markMessage = markErr instanceof Error ? markErr.message : String(markErr);
        this.logger.error(
          `BulkInvoiceGenerateWorker: markFailed itself failed jobId=${jobId}: ${markMessage}`,
        );
      }
    } finally {
      if (lockHandle) lockHandle.release();
    }
  }
}
