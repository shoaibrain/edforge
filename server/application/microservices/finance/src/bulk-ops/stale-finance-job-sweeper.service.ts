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
import type { FinanceJobEntity } from '../common/entities/finance-job.entity';

const METRICS_NAMESPACE = 'Edforge/Finance/Sweeper';
const STALE_AGE_MS = 120 * 60 * 1000; // 2 × the F.3 worker's 60-min hard cap
const SCAN_LIMIT = 100;
const SWEEP_REASON = 'task_replaced_before_completion (StaleFinanceJobSweeper)';

@Injectable()
export class StaleFinanceJobSweeper implements OnApplicationBootstrap {
  private readonly logger = new Logger(StaleFinanceJobSweeper.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly metrics?: FinanceMetricsService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
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

    const candidates = (scanResult.Items ?? []) as FinanceJobEntity[];
    if (candidates.length === 0) {
      return 0;
    }

    this.logger.log(
      `StaleFinanceJobSweeper found ${candidates.length} candidate(s) older than ${cutoff}`,
    );

    let sweptCount = 0;
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

    return sweptCount;
  }
}
