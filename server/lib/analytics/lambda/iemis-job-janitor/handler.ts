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
 * Why a Scan (not Query / GSI):
 *   The academics table has no GSI on (status, createdAt) today. Adding
 *   one would touch tenant-template-stack-basic (a per-tenant CDK stack),
 *   triggering a larger blast radius. At pilot scale (1–2 tenants, low
 *   thousands of items per tenant), Scan + FilterExpression is bounded:
 *   page through the table once every 5 min, filtering server-side. If
 *   this ever becomes hot (>10 tenants OR table grows past ~50k items),
 *   add a sparse GSI keyed on (status='running').
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
  ScanCommand,
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

  // ── Scan for orphan rows ────────────────────────────────────────────────
  const orphans = await scanOrphanJobs(TABLE_NAME, cutoffIso);

  console.log(`[iemis-job-janitor] scan complete — ${orphans.length} orphan(s) found`);

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
          ':et': 'IEMIS_IMPORT_JOB',
          ':running': 'running',
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
          'SET #status = :failed, #error = :reason, completedAt = :now, updatedAt = :now, updatedBy = :janitor',
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
      return 'condition-failed';
    }
    console.error(
      `[iemis-job-janitor] error marking ${orphan.entityKey}:`,
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
