/**
 * StaleFinanceJobSweeper — Sprint §5d MVP.3
 *
 * Closes the durability gap that the F.1-review architecture critic
 * surfaced:
 *
 *   The E.4 worker has a "try/finally + markFailed" failure path, BUT a
 *   container replacement (deploy, OOM, scale-in, segfault on a malformed
 *   PDF font, ALB drain in 30s) ends the process WITHOUT running the
 *   finally — so the FinanceJob row stays `running` forever. The UI
 *   polls and sees `running` indefinitely; the operator can't recover
 *   without manual DDB surgery.
 *
 * Mechanism (per §5d MVP.3 + S6):
 *   1. OnApplicationBootstrap fires once per process start (i.e., at
 *      every deploy + every task replacement).
 *   2. Scan the finance table for rows where
 *        begins_with(entityKey, 'FINANCE_JOB#')
 *        AND status = 'running'
 *        AND startedAt < (now - 120 minutes)
 *      120 min = 2 × the F.3 worker's 60-min hard cap. A row older
 *      than 2× the legitimate runtime is by definition orphaned.
 *   3. For each match: conditional UpdateItem to mark `failed`, guarded
 *      by `status = 'running'` so a worker that completed BETWEEN the
 *      scan and the update wins the race (sweeper's update fails with
 *      ConditionalCheckFailedException → no-op).
 *   4. Emit CW metric `Edforge/Finance/Sweeper/StaleJobsSwept`. On any
 *      uncaught exception, emit `SweeperFailures` and swallow — bootstrap
 *      MUST complete or finance never starts.
 *
 * Scope deliberately bounded (per §5d MVP.3):
 *   - Single-batch scan, Limit=100. Sprint I.1 janitor Lambda handles
 *     larger backlogs / cross-task periodic sweep.
 *   - No FinanceAuditService emit. The audit emit pattern requires
 *     RequestContext.userId; the sweeper has no user context.
 *     Structured WARN log is the trail until Sprint I.1 designs the
 *     'SYSTEM' user convention cohesively.
 *   - No periodic re-scan. On-boot only — ECS task replacements at
 *     deploy cadence are frequent enough for MVP.
 *
 * Disable via `DISABLE_STALE_JOB_SWEEPER=true` for load tests + non-prod.
 * Matches the OverdueDetectionService.DISABLE_OVERDUE_DETECTION precedent.
 *
 * IAM: task role already has dynamodb:Scan + dynamodb:UpdateItem on
 * edforge-finance-* (service-info.txt). cloudwatch:PutMetricData was
 * added in PR #344/#345. No new grants needed in MVP.3.
 */

import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceMetricsService } from '../common/services/finance-metrics.service';
import type { FinanceJobEntity, FinanceJobType } from '../common/entities/finance-job.entity';
import { EntityKeyBuilder } from '../common/entities/base.entity';
import { isLambdaRuntime } from '@app/common-utils';

const METRICS_NAMESPACE = 'Edforge/Finance/Sweeper';
const STALE_AGE_MS = 120 * 60 * 1000; // 2 × the F.3 worker's 60-min hard cap
const SCAN_LIMIT = 100;
const SWEEP_REASON = 'task_replaced_before_completion (StaleFinanceJobSweeper)';

/**
 * PR #358 P2 fix-up — queued-export orphan recovery.
 *
 * The MVP.5 active-export sentinel is created atomically with the
 * FinanceJob row (status='queued') in `FinanceJobsService.create()`.
 * F.4's controller then dispatches the worker via `setImmediate`, and
 * the worker calls `markRunning` (queued → running) within
 * milliseconds. If the process dies between create() and markRunning
 * (deploy land mid-tick, OOM mid-tick), the job stays `queued` AND
 * the sentinel exists — but the original sweeper only recovers
 * `running` rows, so the school stays blocked until the 4h TTL clears
 * the sentinel (a UX-bad recovery window).
 *
 * This sweeper path covers that gap: any export-type job (the only
 * jobs that create the sentinel) stuck `queued` with `createdAt`
 * older than 10 minutes is orphaned. The healthy create-to-markRunning
 * delay is sub-second; 10 min is 600× the expected window, so the
 * false-positive risk is negligible at MVP cadence.
 *
 * The bulk_invoice_generate path (E.4) also uses `queued → running`,
 * but it does NOT create the active-export sentinel — no orphan-
 * sentinel UX impact. Still, recovering its queued orphans is
 * harmless (job-level UX recovery only). For simplicity the sweeper
 * doesn't filter by jobType; any orphaned queued FinanceJob is swept.
 */
// Cost-redesign C3.7 — under JOBS_TRANSPORT=sqs a job legitimately sits in
// `queued` for as long as the queue takes (visibility 960 s × 3 receives before
// the DLQ), so the in-process orphan rule would fail healthy jobs. The queue's
// DLQ alarm covers that path; the sweep only applies to the inline hand-off.
export function queuedStaleAgeMs(env: NodeJS.ProcessEnv = process.env): number {
  return (env.JOBS_TRANSPORT ?? '').trim().toLowerCase() === 'sqs' ? Number.POSITIVE_INFINITY : 10 * 60 * 1000; // 10 min — 600× the healthy create→markRunning window
}
const QUEUED_SWEEP_REASON = 'queued_handoff_lost_before_markRunning (StaleFinanceJobSweeper)';

/**
 * Sprint §5d MVP.5 — sweeper sentinel cleanup. Mirrors the
 * isExportJobType helper in finance-jobs.service.ts. Sweeping a stuck
 * `running` export job orphans its active-export sentinel; we clean it
 * up so the next operator submission for that school isn't blocked.
 * Only EXPORT jobs have sentinels (bulk_invoice_generate uses its own
 * E.4 in-memory PerSchoolLock).
 */
function isExportJobType(jobType: FinanceJobType): boolean {
  return jobType === 'bulk_invoice_pdf_export' || jobType === 'bulk_receipt_pdf_export';
}

@Injectable()
export class StaleFinanceJobSweeper implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaleFinanceJobSweeper.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly metrics?: FinanceMetricsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    // Every Lambda cold start is a 'process start'; the cross-task sweep is
    // the finance-job-janitor Lambda, so skip the per-boot scan here.
    if (isLambdaRuntime()) return;
    if (process.env.DISABLE_STALE_JOB_SWEEPER === 'true') {
      this.logger.log('StaleFinanceJobSweeper disabled via DISABLE_STALE_JOB_SWEEPER env var');
      return;
    }

    try {
      const swept = await this.sweepStaleJobs();
      this.logger.log(`StaleFinanceJobSweeper boot: swept=${swept}`);
      this.metrics?.put({
        namespace: METRICS_NAMESPACE,
        metricName: 'StaleJobsSwept',
        value: swept,
      });
    } catch (err) {
      // CRITICAL: bootstrap MUST complete. A throwing OnApplicationBootstrap
      // hook prevents Nest from completing init — finance service never
      // starts. Audit failures cannot brick the data plane.
      this.logger.error(
        `StaleFinanceJobSweeper failed (non-fatal): ${(err as Error).message}`,
      );
      this.metrics?.put({
        namespace: METRICS_NAMESPACE,
        metricName: 'SweeperFailures',
        value: 1,
      });
    }
  }

  /**
   * Single-batch scan + per-row conditional update. Returns the number
   * of rows actually transitioned to `failed`. Race-lost rows (worker
   * completed between scan and update) are counted as not-swept.
   *
   * Made `protected` for the spec to stub timing dependencies via a
   * subclass if needed, but the default path (called from
   * onApplicationBootstrap) covers all real-world cases.
   */
  protected async sweepStaleJobs(): Promise<number> {
    const now = new Date();
    const cutoff = new Date(now.getTime() - STALE_AGE_MS).toISOString();
    const client = this.dynamoDBClient.getSystemClient();
    const tableName = this.dynamoDBClient.getTableName();

    // Single-batch Scan with FilterExpression. No ExclusiveStartKey
    // pagination — Sprint I.1 janitor Lambda is the cross-task / large-
    // backlog safety net. At MVP single-tenant scale this returns <10
    // items typically; the Limit=100 guard is for pathological cases.
    const scanResult = await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          'begins_with(entityKey, :prefix) AND #status = :running AND startedAt < :cutoff',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':prefix': 'FINANCE_JOB#',
          ':running': 'running',
          ':cutoff': cutoff,
        },
        Limit: SCAN_LIMIT,
      }),
    );

    const candidates = (scanResult?.Items ?? []) as FinanceJobEntity[];

    let sweptCount = 0;
    if (candidates.length > 0) {
      this.logger.log(
        `StaleFinanceJobSweeper found ${candidates.length} candidate(s) older than ${cutoff}`,
      );
    }
    const nowIso = now.toISOString();
    for (const job of candidates) {
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { tenantId: job.tenantId, entityKey: job.entityKey },
            // Overwrite errors with a SINGLE sentinel entry (NOT list_append).
            // A stuck `running` job's existing errors are typically empty (the
            // worker crashed before recording any); a fresh sentinel makes the
            // sweep reason unambiguous for the operator.
            UpdateExpression:
              'SET #status = :failed, completedAt = :now, errors = :errors ADD version :one',
            ConditionExpression: '#status = :running',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':failed': 'failed',
              ':running': 'running',
              ':now': nowIso,
              ':errors': [{ at: nowIso, message: SWEEP_REASON }],
              ':one': 1,
            },
          }),
        );
        sweptCount++;
        this.logger.warn(
          `Swept stale finance job: tenant=${job.tenantId} jobId=${job.jobId} ` +
            `type=${job.jobType} schoolId=${job.schoolId} startedAt=${job.startedAt}`,
        );
        // Sprint §5d MVP.5 — best-effort sentinel cleanup. Only runs when
        // the UpdateCommand SUCCEEDED above (i.e., the sweeper is the one
        // that failed the job, not a live worker — the live-worker path
        // would have done its own delete via markCompleted/markFailed).
        // On the race-lost path (ConditionalCheckFailed in the catch
        // below), the live worker owns the sentinel cleanup and we skip.
        if (isExportJobType(job.jobType)) {
          await this.deleteSentinel(client, job.tenantId, job.schoolId);
        }
      } catch (err) {
        const e = err as Error & { name?: string };
        if (e.name === 'ConditionalCheckFailedException') {
          // Worker completed/failed the job between our scan and update —
          // legitimate race-lost case. The sweeper is correctly silent;
          // log at info-level for traceability.
          this.logger.log(
            `Sweep race-lost for jobId=${job.jobId} — live worker resolved it first`,
          );
        } else {
          // Per-row failure (DDB throttling, network blip). Log + continue;
          // don't let one bad row block sweeping the rest.
          this.logger.error(
            `Sweep failed for jobId=${job.jobId}: ${e.message}`,
          );
        }
      }
    }

    // ────────────────────────────────────────────────────────────────
    // PR #358 P2 fix-up — queued-export orphan recovery.
    // See queuedStaleAgeMs() comment for rationale. Single additional
    // scan + conditional update: any export-type job stuck `queued`
    // with `createdAt` older than 10 min is orphaned; mark failed
    // (which best-effort cleans up the sentinel via the existing path).
    // ────────────────────────────────────────────────────────────────
    sweptCount += await this.sweepStaleQueuedExports(client, tableName, now);

    return sweptCount;
  }

  /**
   * PR #358 P2 fix-up. Scan + recover queued exports stuck in the
   * create-to-markRunning handoff. Mirrors the running-sweep shape
   * (conditional update guarded by `status='queued'` so a worker that
   * just transitioned to running between scan and update wins the race).
   */
  private async sweepStaleQueuedExports(
    client: ReturnType<DynamoDBClientService['getSystemClient']>,
    tableName: string,
    now: Date,
  ): Promise<number> {
    const cutoff = new Date(now.getTime() - queuedStaleAgeMs()).toISOString();
    const scanResult = await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          'begins_with(entityKey, :prefix) AND #status = :queued AND createdAt < :cutoff',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':prefix': 'FINANCE_JOB#',
          ':queued': 'queued',
          ':cutoff': cutoff,
        },
        Limit: SCAN_LIMIT,
      }),
    );
    const candidates = (scanResult?.Items ?? []) as FinanceJobEntity[];
    if (candidates.length === 0) return 0;

    this.logger.log(
      `StaleFinanceJobSweeper found ${candidates.length} queued-orphan candidate(s) older than ${cutoff}`,
    );

    let sweptCount = 0;
    const nowIso = now.toISOString();
    for (const job of candidates) {
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { tenantId: job.tenantId, entityKey: job.entityKey },
            UpdateExpression:
              'SET #status = :failed, completedAt = :now, errors = :errors ADD version :one',
            // Race-safe: condition pins predecessor='queued' so a worker
            // that just won markRunning between scan and update is the
            // winner; sweeper update fails ConditionalCheckFailed → no-op.
            ConditionExpression: '#status = :queued',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: {
              ':failed': 'failed',
              ':queued': 'queued',
              ':now': nowIso,
              ':errors': [{ at: nowIso, message: QUEUED_SWEEP_REASON }],
              ':one': 1,
            },
          }),
        );
        sweptCount++;
        this.logger.warn(
          `Swept queued-orphan finance job: tenant=${job.tenantId} jobId=${job.jobId} ` +
            `type=${job.jobType} schoolId=${job.schoolId} createdAt=${job.createdAt}`,
        );
        // Same sentinel-cleanup rule as the running-sweep path.
        if (isExportJobType(job.jobType)) {
          await this.deleteSentinel(client, job.tenantId, job.schoolId);
        }
      } catch (err) {
        const e = err as Error & { name?: string };
        if (e.name === 'ConditionalCheckFailedException') {
          this.logger.log(
            `Queued-orphan sweep race-lost for jobId=${job.jobId} — worker won markRunning first`,
          );
        } else {
          this.logger.error(
            `Queued-orphan sweep failed for jobId=${job.jobId}: ${e.message}`,
          );
        }
      }
    }
    return sweptCount;
  }

  /**
   * Sprint §5d MVP.5 — best-effort active-export sentinel cleanup.
   * Mirrors `FinanceJobsService.deleteActiveExportSentinel` but runs
   * against the system client (no JWT context in the sweeper). Never
   * throws — a failed delete leaves the sentinel for the 4h DDB TTL
   * to clear.
   */
  private async deleteSentinel(
    client: ReturnType<DynamoDBClientService['getSystemClient']>,
    tenantId: string,
    schoolId: string,
  ): Promise<void> {
    try {
      await this.dynamoDBClient.deleteItem(
        client,
        tenantId,
        EntityKeyBuilder.financeActiveExport(schoolId),
      );
    } catch (err) {
      this.logger.warn(
        `Sweeper sentinel DELETE failed (best-effort) ` +
          `tenant=${tenantId} schoolId=${schoolId}: ${(err as Error).message}. ` +
          `Sentinel TTL (4h) will clear it.`,
      );
    }
  }
}
