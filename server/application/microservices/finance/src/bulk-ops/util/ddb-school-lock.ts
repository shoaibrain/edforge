import { Injectable, Logger } from '@nestjs/common';
import { DeleteCommand, PutCommand, UpdateCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from '../../common/services/dynamodb-client.service';
import { SchoolLockBusyError, type SchoolLock, type SchoolLockAcquireOptions, type SchoolLockHandle } from './school-lock';

/**
 * Cost-redesign C3.6 — the per-school job lock as a DynamoDB row.
 *
 * Row: `tenantId = <tenantId>`, `entityKey = LOCK#SCHOOL#<schoolId>`,
 * `owner = <jobId>`, `fence = <n>`, `expiresAt` (epoch seconds), `ttl` (same
 * value, for the table's TTL). The fence comes from `UpdateItem ADD fence 1`
 * on `entityKey = LOCKSEQ#<schoolId>`, so it increases monotonically per
 * school across every holder. Acquire is a conditional PutItem
 * (`attribute_not_exists(entityKey) OR expiresAt < :now`), polled with
 * backoff for a bounded time; a heartbeat every 60 s extends `expiresAt`
 * while the owner works; release is a conditional DeleteItem. A holder that
 * lost its lease (heartbeat failed, lease expired) cannot commit job-row
 * transitions because the jobs service conditions them on the fence.
 */
export interface DdbSchoolLockOptions {
  leaseSeconds?: number;
  heartbeatMs?: number;
  waitMs?: number;
  pollMs?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULTS: Required<DdbSchoolLockOptions> = {
  leaseSeconds: 16 * 60,
  heartbeatMs: 60_000,
  waitMs: 10 * 60_000,
  pollMs: 5_000,
  now: Date.now,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
};

@Injectable()
export class DdbSchoolLock implements SchoolLock {
  private readonly logger = new Logger(DdbSchoolLock.name);
  private readonly opts: Required<DdbSchoolLockOptions>;

  constructor(private readonly dynamoDBClient: DynamoDBClientService, options: DdbSchoolLockOptions = {}) {
    this.opts = { ...DEFAULTS, ...options };
  }

  static lockKey(schoolId: string): string { return `LOCK#SCHOOL#${schoolId}`; }
  static seqKey(schoolId: string): string { return `LOCKSEQ#${schoolId}`; }

  async acquire(schoolId: string, options: SchoolLockAcquireOptions = {}): Promise<SchoolLockHandle> {
    const context = options.context;
    if (!context) throw new Error('DdbSchoolLock.acquire needs the request context (tenant-scoped credentials)');
    const owner = options.owner ?? `anonymous-${Math.random().toString(36).slice(2, 10)}`;
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const table = this.dynamoDBClient.getTableName();
    const tenantId = context.tenantId;
    const fence = await this.nextFence(client, table, tenantId, schoolId);

    const deadline = this.opts.now() + this.opts.waitMs;
    let attempt = 0;
    for (;;) {
      const nowSec = Math.floor(this.opts.now() / 1000);
      const expiresAt = nowSec + this.opts.leaseSeconds;
      try {
        await client.send(new PutCommand({
          TableName: table,
          Item: { tenantId, entityKey: DdbSchoolLock.lockKey(schoolId), schoolId, owner, fence, acquiredAt: nowSec, expiresAt, ttl: expiresAt },
          ConditionExpression: 'attribute_not_exists(entityKey) OR expiresAt < :now',
          ExpressionAttributeValues: { ':now': nowSec },
        }));
        break;
      } catch (err) {
        if ((err as { name?: string }).name !== 'ConditionalCheckFailedException') throw err;
        if (this.opts.now() + this.opts.pollMs > deadline) {
          this.logger.warn(`DdbSchoolLock busy schoolId=${schoolId} owner=${owner} after ${attempt + 1} attempt(s)`);
          throw new SchoolLockBusyError(schoolId);
        }
        attempt++;
        await this.opts.sleep(Math.min(this.opts.pollMs * Math.min(attempt, 6), 30_000));
      }
    }

    let released = false;
    const heartbeat = setInterval(() => {
      const nowSec = Math.floor(this.opts.now() / 1000);
      const expiresAt = nowSec + this.opts.leaseSeconds;
      (async () => client.send(new UpdateCommand({
        TableName: table,
        Key: { tenantId, entityKey: DdbSchoolLock.lockKey(schoolId) },
        UpdateExpression: 'SET expiresAt = :exp, #ttl = :exp',
        ConditionExpression: '#owner = :owner',
        ExpressionAttributeNames: { '#ttl': 'ttl', '#owner': 'owner' },
        ExpressionAttributeValues: { ':exp': expiresAt, ':owner': owner },
      })))().catch((err: unknown) => {
        this.logger.error(`DdbSchoolLock heartbeat lost schoolId=${schoolId} owner=${owner}: ${(err as Error).message}`);
      });
    }, this.opts.heartbeatMs);
    heartbeat.unref?.();

    const release = async (): Promise<void> => {
      if (released) return;
      released = true;
      clearInterval(heartbeat);
      try {
        await client.send(new DeleteCommand({
          TableName: table,
          Key: { tenantId, entityKey: DdbSchoolLock.lockKey(schoolId) },
          ConditionExpression: '#owner = :owner',
          ExpressionAttributeNames: { '#owner': 'owner' },
          ExpressionAttributeValues: { ':owner': owner },
        }));
      } catch (err) {
        if ((err as { name?: string }).name === 'ConditionalCheckFailedException') {
          this.logger.warn(`DdbSchoolLock release by non-owner ignored schoolId=${schoolId} owner=${owner}`);
          return;
        }
        throw err;
      }
    };
    return { release, fence };
  }

  private async nextFence(client: DynamoDBDocumentClient, table: string, tenantId: string, schoolId: string): Promise<number> {
    const out = await client.send(new UpdateCommand({
      TableName: table,
      Key: { tenantId, entityKey: DdbSchoolLock.seqKey(schoolId) },
      UpdateExpression: 'ADD fence :one',
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'UPDATED_NEW',
    }));
    const fence = Number((out.Attributes as { fence?: number } | undefined)?.fence);
    if (!Number.isFinite(fence)) throw new Error(`DdbSchoolLock: fence sequence returned ${String(out.Attributes?.fence)}`);
    return fence;
  }
}
