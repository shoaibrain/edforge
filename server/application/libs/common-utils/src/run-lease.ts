import { DeleteCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Cost-redesign C3.1 — a run lease for scheduled jobs.
 *
 * EventBridge Scheduler retries a failed invocation and can, in rare cases,
 * deliver twice; the timers it replaces were already idempotent by design,
 * and the lease makes the "one run per window" rule explicit and cheap: one
 * conditional PutItem per run. The row lives in the service's own table
 * under a reserved partition (`SYSTEM#<jobName>`), so no tenant partition is
 * touched and the single-table rule holds; the table's TTL attribute
 * (`ttl`) expires it.
 */
export interface RunLeaseKey {
  /** Partition-key attribute name of the table (finance: tenantId). */
  readonly pk: string;
  /** Sort-key attribute name of the table (finance: entityKey). */
  readonly sk: string;
}

export interface RunLeaseResult {
  readonly acquired: boolean;
  readonly pk: string;
  readonly sk: string;
  readonly expiresAt: number;
}

export const RUN_LEASE_PARTITION_PREFIX = 'SYSTEM#';

/** A window key for a cron-driven job: the invocation's scheduled time floored to the minute, UTC. */
export function runWindowKey(scheduledTime: Date | string): string {
  const d = typeof scheduledTime === 'string' ? new Date(scheduledTime) : scheduledTime;
  if (Number.isNaN(d.getTime())) throw new Error(`runWindowKey: invalid time ${String(scheduledTime)}`);
  return d.toISOString().slice(0, 16).replace(/[-:T]/g, '');
}

export async function acquireRunLease(
  client: DynamoDBDocumentClient,
  tableName: string,
  key: RunLeaseKey,
  jobName: string,
  windowKey: string,
  ttlSeconds: number,
  now: () => number = Date.now,
): Promise<RunLeaseResult> {
  const pk = `${RUN_LEASE_PARTITION_PREFIX}${jobName}`;
  const sk = `LEASE#${windowKey}`;
  const nowSec = Math.floor(now() / 1000);
  const expiresAt = nowSec + ttlSeconds;
  try {
    await client.send(
      new PutCommand({
        TableName: tableName,
        Item: { [key.pk]: pk, [key.sk]: sk, jobName, windowKey, acquiredAt: nowSec, ttl: expiresAt },
        // A lease whose TTL passed but which DynamoDB has not yet expired is
        // re-acquirable: TTL deletion lags by up to 48 hours.
        ConditionExpression: `attribute_not_exists(#sk) OR #ttl < :now`,
        ExpressionAttributeNames: { '#sk': key.sk, '#ttl': 'ttl' },
        ExpressionAttributeValues: { ':now': nowSec },
      }),
    );
    return { acquired: true, pk, sk, expiresAt };
  } catch (err) {
    if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
      return { acquired: false, pk, sk, expiresAt };
    }
    throw err;
  }
}

/** Give a window back (the run failed) so Scheduler's retry can take it. Best effort. */
export async function releaseRunLease(client: DynamoDBDocumentClient, tableName: string, key: RunLeaseKey, lease: Pick<RunLeaseResult, 'pk' | 'sk'>): Promise<void> {
  await client.send(new DeleteCommand({ TableName: tableName, Key: { [key.pk]: lease.pk, [key.sk]: lease.sk } }));
}
