/**
 * Finance Job Janitor — Sprint I.1
 *
 * Sweeps the finance DDB table for orphan FINANCE_JOB rows that are stuck in
 * `status='running'` past a staleness threshold. Marks each one `failed` with
 * a clear failure reason, then publishes a single summary to the operator-
 * alert SNS topic if anything was swept.
 *
 * Why this exists:
 *   Finance bulk workers (bulk_invoice_generate, bulk_invoice_pdf_export,
 *   bulk_receipt_pdf_export) run via `setImmediate(...)` inside the finance
 *   NestJS ECS task. If the task dies mid-run (deploy, OOM, ALB drain, ASG
 *   event, SIGTERM during graceful shutdown while work is in flight), no
 *   other code path will ever update the FinanceJob row's status. Without
 *   this janitor the row sits in `running` forever and the operator's UI
 *   poll spins.
 *
 *   The MVP.5 active-export sentinel row (FINANCE_ACTIVE_EXPORT#{schoolId})
 *   is NOT swept here — it carries its own DDB TTL per its design, so DDB's
 *   built-in expiration handles it. The janitor is only for the parent
 *   FINANCE_JOB row.
 *
 * Why a Scan (not Query / GSI):
 *   The finance table has no GSI on (status, createdAt). Same rationale as
 *   iemis-job-janitor: at pilot scale, Scan + FilterExpression is bounded;
 *   revisit if the table grows past ~50k items.
 *
 * Why 60 min staleness:
 *   Load test (Sprint I.7) shows 50-invoice ZIP export runs in ~17 s and
 *   projects 800 invoices to ~4.6 min. Merged-PDF variant (Sprint H) will
 *   run slightly longer. 60 min is ~10x the worst-case expected runtime —
 *   generous enough that a live job is never mistakenly swept, tight enough
 *   that operators don't wait 24 h to find out a job is wedged. Higher than
 *   the iemis threshold (30 min) because IEMIS runs cap out around 3 min.
 *
 * Idempotency:
 *   Each UpdateItem uses a ConditionExpression `#status = :running` so a
 *   row that's been touched between Scan and Update (e.g., the task came
 *   back and completed the job in the last few ms) wins. Conditional
 *   failures are logged but don't count as errors.
 *
 * Failure surface:
 *   The handler logs every error to stdout (CloudWatch). Unhandled
 *   exceptions throw → Lambda fails → metricErrors fires the alarm.
 *   The CDK construct attaches an alarm on `metricErrors > 2` over 15 min
 *   so a one-off transient retry doesn't page.
 */

import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

// ============================================================================
// Configuration (env-driven for testability)
// ============================================================================

const STALE_THRESHOLD_MIN = parseInt(
  process.env.STALE_THRESHOLD_MIN ?? '60',
  10,
);
const TABLE_NAME = process.env.FINANCE_TABLE_NAME;
const ALERT_TOPIC_ARN = process.env.ALERT_TOPIC_ARN;

// ============================================================================
// Clients (module-scoped so warm-task invocations reuse them)
// ============================================================================

const ddbDoc = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});
const sns = new SNSClient({});

// ============================================================================
// Types
// ============================================================================

interface OrphanRow {
  tenantId: string;
  entityKey: string;
  jobId?: string;
  jobType?: string;
  schoolId?: string;
  operatorId?: string;
  createdAt?: string;
  startedAt?: string;
}

interface SweepResult {
  scanned: number;
  marked: number;
  conditionalSkips: number;
  errors: Array<{ tenantId: string; entityKey: string; message: string }>;
}

// ============================================================================
// Handler
// ============================================================================

export async function handler(): Promise<SweepResult> {
  if (!TABLE_NAME) {
    throw new Error('FINANCE_TABLE_NAME env var is required');
  }
  if (!ALERT_TOPIC_ARN) {
    throw new Error('ALERT_TOPIC_ARN env var is required');
  }

  const cutoffIso = new Date(
    Date.now() - STALE_THRESHOLD_MIN * 60 * 1000,
  ).toISOString();
  const nowIso = new Date().toISOString();

  console.log(
    `[finance-job-janitor] sweep starting — staleThresholdMin=${STALE_THRESHOLD_MIN}, cutoffIso=${cutoffIso}, table=${TABLE_NAME}`,
  );

  const orphans = await scanOrphanJobs(TABLE_NAME, cutoffIso);

  console.log(
    `[finance-job-janitor] scan complete — ${orphans.length} orphan(s) found`,
  );

  let marked = 0;
  let conditionalSkips = 0;
  const errors: SweepResult['errors'] = [];

  for (const orphan of orphans) {
    const outcome = await markOrphanFailed(TABLE_NAME, orphan, nowIso);
    if (outcome === 'marked') marked += 1;
    else if (outcome === 'condition-failed') conditionalSkips += 1;
    else
      errors.push({
        tenantId: orphan.tenantId,
        entityKey: orphan.entityKey,
        message: outcome.message,
      });
  }

  const result: SweepResult = {
    scanned: orphans.length,
    marked,
    conditionalSkips,
    errors,
  };

  console.log('[finance-job-janitor] sweep complete', JSON.stringify(result));

  if (marked > 0 || errors.length > 0) {
    await publishSnsAlert(orphans, result, cutoffIso);
  }

  return result;
}

// ============================================================================
// Scan helper — paginates with FilterExpression
// ============================================================================

async function scanOrphanJobs(
  tableName: string,
  cutoffIso: string,
): Promise<OrphanRow[]> {
  const orphans: OrphanRow[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const out = await ddbDoc.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression:
          'entityType = :et AND #status = :running AND createdAt < :cutoff',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':et': 'FINANCE_JOB',
          ':running': 'running',
          ':cutoff': cutoffIso,
        },
        ProjectionExpression:
          'tenantId, entityKey, jobId, jobType, schoolId, operatorId, createdAt, startedAt',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of out.Items ?? []) {
      orphans.push({
        tenantId: String(item.tenantId),
        entityKey: String(item.entityKey),
        jobId: item.jobId ? String(item.jobId) : undefined,
        jobType: item.jobType ? String(item.jobType) : undefined,
        schoolId: item.schoolId ? String(item.schoolId) : undefined,
        operatorId: item.operatorId ? String(item.operatorId) : undefined,
        createdAt: item.createdAt ? String(item.createdAt) : undefined,
        startedAt: item.startedAt ? String(item.startedAt) : undefined,
      });
    }

    lastEvaluatedKey = out.LastEvaluatedKey;
  } while (lastEvaluatedKey);

  return orphans;
}

// ============================================================================
// Update helper — conditional on still-running
// ============================================================================

type MarkOutcome = 'marked' | 'condition-failed' | { message: string };

async function markOrphanFailed(
  tableName: string,
  orphan: OrphanRow,
  nowIso: string,
): Promise<MarkOutcome> {
  try {
    await ddbDoc.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { tenantId: orphan.tenantId, entityKey: orphan.entityKey },
        UpdateExpression:
          'SET #status = :failed, failureReason = :reason, completedAt = :now, updatedAt = :now, updatedBy = :janitor',
        ConditionExpression: '#status = :running',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: {
          ':failed': 'failed',
          ':running': 'running',
          ':reason': `Auto-marked failed by finance-job-janitor — task-killed-during-work (no status update in ${STALE_THRESHOLD_MIN} min)`,
          ':now': nowIso,
          ':janitor': 'system:finance-job-janitor',
        },
      }),
    );
    return 'marked';
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(
        `[finance-job-janitor] conditional skip — ${orphan.entityKey} no longer in running state (won by the worker)`,
      );
      return 'condition-failed';
    }
    console.error(
      `[finance-job-janitor] error marking ${orphan.entityKey}:`,
      err.message ?? 'unknown',
    );
    return { message: err.message ?? 'unknown error' };
  }
}

// ============================================================================
// SNS summary
// ============================================================================

async function publishSnsAlert(
  orphans: OrphanRow[],
  result: SweepResult,
  cutoffIso: string,
): Promise<void> {
  const subject =
    result.errors.length > 0
      ? `[EdForge] Finance Job Janitor: ${result.marked} swept, ${result.errors.length} error(s)`
      : `[EdForge] Finance Job Janitor: ${result.marked} orphan job(s) marked failed`;

  const body = {
    summary: result,
    cutoffIso,
    swept: orphans.slice(0, result.marked).map((o) => ({
      tenantId: o.tenantId,
      jobId: o.jobId,
      jobType: o.jobType,
      schoolId: o.schoolId,
      operatorId: o.operatorId,
      createdAt: o.createdAt,
      startedAt: o.startedAt,
    })),
    errors: result.errors,
  };

  await sns.send(
    new PublishCommand({
      TopicArn: ALERT_TOPIC_ARN,
      Subject: subject.slice(0, 100),
      Message: JSON.stringify(body, null, 2),
    }),
  );
}
