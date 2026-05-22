/**
 * reporting-scheduler Lambda — Sprint E.1.6
 *
 * Daily heartbeat scheduled by EventBridge Scheduler at 02:00 Asia/Kathmandu
 * (20:15 UTC). Enumerates all active tenants and reports a CloudWatch metric
 * `Edforge/Reporting/SnapshotsPendingSubmission` — the count of ReportingSnapshot
 * rows in status=`generated` that have not yet been submitted.
 *
 * V1 scope:
 *   - METRIC ONLY. Operator dashboards show how many CEHRD exports are sitting
 *     in the staging bucket awaiting manual upload.
 *   - DOES NOT emit `reporting.submission_due` events yet. The per-snapshot
 *     deadline policy (e.g. Flash I = end of Jestha, Flash II = end of Chaitra)
 *     plus de-duplication (don't emit daily forever) lands in V1.5 when the
 *     Messaging microservice consumer exists. Wiring the event before the
 *     consumer would spam EventBridge and serve no one.
 *
 * Future expansion:
 *   - Compute BS-calendar deadline per templateId
 *   - Emit `reporting.submission_due` at T-7d / T-3d / T-0d
 *   - Skip emission once submitted=true OR a prior submission_due event for
 *     the same snapshot+phase exists in the last 24h
 *
 * Idempotency: pure read + metric publish; safe to invoke multiple times per day.
 */

import {
  DynamoDBClient,
  QueryCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import { unmarshall } from '@aws-sdk/util-dynamodb';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import {
  enumerateActiveTenants,
  type ActiveTenant,
} from '../shared/tenant-enumerator';

const REGION = process.env.AWS_REGION;
const IDENTITY_TABLE = process.env.IDENTITY_TABLE_NAME ?? 'edforge-identity-basic';
const ENABLED = process.env.REPORTING_SCHEDULER_ENABLED !== 'false';

const ddb = new DynamoDBClient({ region: REGION, maxAttempts: 3 });
const cw = new CloudWatchClient({ region: REGION, maxAttempts: 3 });

function log(level: 'info' | 'warn' | 'error', msg: string, meta: Record<string, unknown> = {}): void {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify({ level, msg, ...meta }));
}

async function countPendingForTenant(tenantId: string): Promise<number> {
  // Query partition for entries with SK starting with `SCHOOL#` and ending
  // with `#REPORTING_SNAPSHOT#…`. Filter on status=generated AND
  // attribute_not_exists(submittedAt).
  let count = 0;
  let exclusiveStartKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: IDENTITY_TABLE,
        KeyConditionExpression: 'tenantId = :tid AND begins_with(entityKey, :prefix)',
        FilterExpression:
          '#entityType = :rs AND #status = :generated AND attribute_not_exists(submittedAt)',
        ExpressionAttributeNames: {
          '#entityType': 'entityType',
          '#status': 'status',
        },
        ExpressionAttributeValues: {
          ':tid': { S: `TENANT#${tenantId}` },
          ':prefix': { S: 'SCHOOL#' },
          ':rs': { S: 'REPORTING_SNAPSHOT' },
          ':generated': { S: 'generated' },
        },
        ExclusiveStartKey: exclusiveStartKey,
      }),
    );
    count += (page.Items ?? []).length;
    exclusiveStartKey = page.LastEvaluatedKey;
  } while (exclusiveStartKey);
  return count;
}

async function publishMetric(tenantId: string, count: number): Promise<void> {
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: 'Edforge/Reporting',
        MetricData: [
          {
            MetricName: 'SnapshotsPendingSubmission',
            Value: count,
            Unit: 'Count',
            Dimensions: [{ Name: 'TenantId', Value: tenantId }],
          },
        ],
      }),
    );
  } catch (e) {
    log('warn', 'publishMetric failed (non-fatal)', { tenantId, e: String(e) });
  }
}

export async function handler(): Promise<{
  tenants: number;
  pendingTotal: number;
}> {
  if (!ENABLED) {
    log('info', 'reporting-scheduler disabled (env)');
    return { tenants: 0, pendingTotal: 0 };
  }

  let tenants: ActiveTenant[] = [];
  try {
    tenants = await enumerateActiveTenants(ddb, { tableName: IDENTITY_TABLE });
  } catch (e) {
    log('error', 'enumerateActiveTenants failed', { e: String(e) });
    return { tenants: 0, pendingTotal: 0 };
  }

  let pendingTotal = 0;
  for (const t of tenants) {
    try {
      const count = await countPendingForTenant(t.tenantId);
      pendingTotal += count;
      await publishMetric(t.tenantId, count);
      log('info', 'tenant pending snapshots counted', {
        tenantId: t.tenantId,
        count,
      });
    } catch (e) {
      log('error', 'countPendingForTenant failed for tenant', {
        tenantId: t.tenantId,
        e: String(e),
      });
    }
  }

  log('info', 'reporting-scheduler complete', {
    tenants: tenants.length,
    pendingTotal,
  });
  return { tenants: tenants.length, pendingTotal };
}
