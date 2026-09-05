/**
 * IEMIS Job Janitor — F-IEMIS-1
 *
 * Sweeps the academics DDB table for orphan IEMIS_IMPORT_JOB rows that are
 * stuck in `status='running'` past a staleness threshold. Marks each one
 * `failed` with a clear failure reason, then publishes a single summary to
 * the operator-alert SNS topic if anything was swept.
 *
 * Why this exists:
 *   The IEMIS bulk-import worker runs via `setImmediate(...)` inside the
 *   academics NestJS ECS task. If the task dies mid-import (deploy, OOM,
 *   ALB drain, autoscaling event, even SIGTERM during graceful shutdown
 *   when the process has work in flight), no other code path will ever
 *   update the IEMIS_IMPORT_JOB row's status. Without this janitor the
 *   row sits in `running` forever and the operator's UI poll spins.
 *
 * Why a Query on GSI15 (cost-redesign Sprint 8):
 *   Until September 2026 this handler ran a Scan + FilterExpression over the
 *   whole table every five minutes. A Scan is billed on the bytes it reads,
 *   not the rows it returns, so the two janitors were 91 % of the account's
 *   DynamoDB reads (≈ $2/month) and grew with the table. GSI15 is a sparse
 *   index that only rows in `status='running'` populate (`gsi15pk =
 *   RUNNING_JOB#IEMIS_IMPORT_JOB`, `gsi15sk = startedAt`); the service sets the
 *   keys in `markRunning` and REMOVEs them on every terminal transition, so
 *   one Query with `gsi15sk < cutoff` returns exactly the stale set for a
 *   fraction of a read unit. The sweep runs every 15 minutes.
 *
 * Why 30 min staleness:
 *   A 200-row import takes ~45s; an 800-row Saraswati import takes ~3 min;
 *   the controller hard-caps requests at 1000 rows. 30 min is ~10x the
 *   worst-case expected runtime — generous enough that a live job is
 *   never mistakenly swept, tight enough that operators don't wait 24h
 *   to find out a job is wedged.
 *
 * Idempotency:
 *   Each UpdateItem uses a ConditionExpression `#status = :running` so a
 *   row that's been touched between Scan and Update (e.g., the task
 *   actually came back and completed the job in the last few ms) wins.
 *   Conditional failures are logged but don't count as errors.
 *
 * Failure surface:
 *   The handler logs every error to stdout (CloudWatch). Unhandled
 *   exceptions throw → Lambda fails → metricErrors fires the alarm.
 *   The CDK construct attaches an alarm on `metricErrors > 2` over 15 min
 *   so a one-off transient retry doesn't page.
 */

import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  QueryCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';

// ============================================================================
// Configuration (env-driven for testability)
// ============================================================================

const STALE_THRESHOLD_MIN = parseInt(
  process.env.STALE_THRESHOLD_MIN ?? '30',
  10,
);
const TABLE_NAME = process.env.ACADEMICS_TABLE_NAME;
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
  schoolId?: string;
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
    throw new Error('ACADEMICS_TABLE_NAME env var is required');
  }
  if (!ALERT_TOPIC_ARN) {
    throw new Error('ALERT_TOPIC_ARN env var is required');
  }

  const cutoffIso = new Date(
    Date.now() - STALE_THRESHOLD_MIN * 60 * 1000,
  ).toISOString();
  const nowIso = new Date().toISOString();

  console.log(
    `[iemis-job-janitor] sweep starting — staleThresholdMin=${STALE_THRESHOLD_MIN}, cutoffIso=${cutoffIso}, table=${TABLE_NAME}`,
  );

  // ── Query the running-jobs index (GSI15) for stale rows ──────────────────
  const orphans = await queryOrphanJobs(TABLE_NAME, cutoffIso);

  console.log(`[iemis-job-janitor] query complete — ${orphans.length} orphan(s) found`);

  // ── Mark each as failed (conditional on still-running) ──────────────────
  let marked = 0;
  let conditionalSkips = 0;
  const errors: SweepResult['errors'] = [];

  for (const orphan of orphans) {
    const outcome = await markOrphanFailed(TABLE_NAME, orphan, nowIso);
    if (outcome === 'marked') marked += 1;
    else if (outcome === 'condition-failed') conditionalSkips += 1;
    else errors.push({ tenantId: orphan.tenantId, entityKey: orphan.entityKey, message: outcome.message });
  }

  const result: SweepResult = {
    scanned: orphans.length,
    marked,
    conditionalSkips,
    errors,
  };

  console.log('[iemis-job-janitor] sweep complete', JSON.stringify(result));

  // ── Publish SNS summary if anything was marked or any errors happened ───
  if (marked > 0 || errors.length > 0) {
    await publishSnsAlert(orphans, result, cutoffIso);
  }

  return result;
}

// ============================================================================
// Query helper — the sparse running-jobs index (GSI15), paginated
// ============================================================================

/**
 * Partition of GSI15 that holds IEMIS_IMPORT_JOB rows. Mirrors
 * `GSIKeyBuilder.runningJob('IEMIS_IMPORT_JOB')` in the service; the janitor
 * bundle is self-contained, so the value is repeated here.
 */
const RUNNING_JOBS_INDEX = 'GSI15';
const RUNNING_JOBS_PK = 'RUNNING_JOB#IEMIS_IMPORT_JOB';

async function queryOrphanJobs(
  tableName: string,
  cutoffIso: string,
): Promise<OrphanRow[]> {
  const orphans: OrphanRow[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;

  do {
    const out = await ddbDoc.send(
      new QueryCommand({
        TableName: tableName,
        IndexName: RUNNING_JOBS_INDEX,
        KeyConditionExpression: 'gsi15pk = :pk AND gsi15sk < :cutoff',
        ExpressionAttributeValues: {
          ':pk': RUNNING_JOBS_PK,
          ':cutoff': cutoffIso,
        },
        ProjectionExpression:
          'tenantId, entityKey, jobId, schoolId, createdAt, startedAt',
        ExclusiveStartKey: lastEvaluatedKey,
      }),
    );

    for (const item of out.Items ?? []) {
      orphans.push({
        tenantId: String(item.tenantId),
        entityKey: String(item.entityKey),
        jobId: item.jobId ? String(item.jobId) : undefined,
        schoolId: item.schoolId ? String(item.schoolId) : undefined,
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
          'SET #status = :failed, #error = :reason, completedAt = :now, updatedAt = :now, updatedBy = :janitor REMOVE gsi15pk, gsi15sk',
        ConditionExpression: '#status = :running',
        ExpressionAttributeNames: { '#status': 'status', '#error': 'error' },
        ExpressionAttributeValues: {
          ':failed': 'failed',
          ':running': 'running',
          ':reason': `Auto-marked failed by iemis-job-janitor — task-killed-during-import (no status update in ${STALE_THRESHOLD_MIN} min)`,
          ':now': nowIso,
          ':janitor': 'system:iemis-job-janitor',
        },
      }),
    );
    return 'marked';
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(
        `[iemis-job-janitor] conditional skip — ${orphan.entityKey} no longer in running state (won by the worker)`,
      );
      await detachFromRunningIndex(tableName, orphan);
      return 'condition-failed';
    }
    console.error(
      `[iemis-job-janitor] error marking ${orphan.entityKey}:`,
      err.message ?? 'unknown',
    );
    return { message: err.message ?? 'unknown error' };
  }
}

/**
 * A row that left `running` without dropping its GSI15 keys (a write that
 * raced this sweep, or a code path older than the index) would otherwise be
 * re-read on every sweep. Drop the keys once the status has moved on.
 */
async function detachFromRunningIndex(
  tableName: string,
  orphan: OrphanRow,
): Promise<void> {
  try {
    await ddbDoc.send(
      new UpdateCommand({
        TableName: tableName,
        Key: { tenantId: orphan.tenantId, entityKey: orphan.entityKey },
        UpdateExpression: 'REMOVE gsi15pk, gsi15sk',
        ConditionExpression: '#status <> :running',
        ExpressionAttributeNames: { '#status': 'status' },
        ExpressionAttributeValues: { ':running': 'running' },
      }),
    );
  } catch (e) {
    const err = e as { name?: string; message?: string };
    if (err.name !== 'ConditionalCheckFailedException') {
      console.error(
        `[iemis-job-janitor] error detaching ${orphan.entityKey} from ${RUNNING_JOBS_INDEX}:`,
        err.message ?? 'unknown',
      );
    }
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
      ? `[EdForge] IEMIS Job Janitor: ${result.marked} swept, ${result.errors.length} error(s)`
      : `[EdForge] IEMIS Job Janitor: ${result.marked} orphan job(s) marked failed`;

  const body = {
    summary: result,
    cutoffIso,
    swept: orphans.slice(0, result.marked).map((o) => ({
      tenantId: o.tenantId,
      jobId: o.jobId,
      schoolId: o.schoolId,
      createdAt: o.createdAt,
    })),
    errors: result.errors,
  };

  await sns.send(
    new PublishCommand({
      TopicArn: ALERT_TOPIC_ARN,
      Subject: subject.slice(0, 100), // SNS subject hard limit
      Message: JSON.stringify(body, null, 2),
    }),
  );
}
