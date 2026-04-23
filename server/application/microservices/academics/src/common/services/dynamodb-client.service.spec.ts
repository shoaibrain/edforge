import { DynamoDBClientService } from './dynamodb-client.service';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * In-memory stand-in for DynamoDBDocumentClient focused on UpdateCommand
 * handling. Supports the `ADD counterValue :delta` update expression with
 * per-tenant+entityKey isolation. Good enough to exercise `atomicIncrement`
 * without SDK-level mocking dependencies.
 */
function fakeClient(): DynamoDBDocumentClient {
  const store = new Map<string, { counterValue: number }>();

  return {
    send: jest.fn(async (cmd: any) => {
      const input = cmd.input ?? cmd.params ?? cmd;
      const key = `${input.Key.tenantId}|${input.Key.entityKey}`;
      const delta = input.ExpressionAttributeValues[':delta'];
      const existing = store.get(key) || { counterValue: 0 };
      existing.counterValue += delta;
      store.set(key, existing);
      return { Attributes: { counterValue: existing.counterValue } };
    }),
  } as unknown as DynamoDBDocumentClient;
}

describe('DynamoDBClientService.atomicIncrement', () => {
  let svc: DynamoDBClientService;

  beforeEach(() => {
    svc = new DynamoDBClientService();
  });

  it('returns the post-increment value on first call', async () => {
    const c = fakeClient();
    const v = await svc.atomicIncrement(c, 't1', 'COUNTER#students');
    expect(v).toBe(1);
  });

  it('returns 100 distinct sequential values across 100 parallel calls', async () => {
    const c = fakeClient();
    const results = await Promise.all(
      Array.from({ length: 100 }, () => svc.atomicIncrement(c, 't1', 'COUNTER#students')),
    );
    expect(new Set(results).size).toBe(100);
    expect(Math.min(...results)).toBe(1);
    expect(Math.max(...results)).toBe(100);
  });

  it('partitions counters by tenantId', async () => {
    const c = fakeClient();
    const [a, b] = await Promise.all([
      svc.atomicIncrement(c, 'tenant-a', 'COUNTER#students'),
      svc.atomicIncrement(c, 'tenant-b', 'COUNTER#students'),
    ]);
    expect(a).toBe(1);
    expect(b).toBe(1);
  });

  it('handles 10 tenants × 100 calls each without cross-contamination', async () => {
    const c = fakeClient();
    const tenants = Array.from({ length: 10 }, (_, i) => `tenant-${i}`);
    const perTenantResults: Record<string, number[]> = {};

    await Promise.all(
      tenants.flatMap((tid) => {
        perTenantResults[tid] = [];
        return Array.from({ length: 100 }, () =>
          svc
            .atomicIncrement(c, tid, 'COUNTER#students')
            .then((v) => perTenantResults[tid].push(v)),
        );
      }),
    );

    for (const tid of tenants) {
      expect(new Set(perTenantResults[tid]).size).toBe(100);
      expect(Math.max(...perTenantResults[tid])).toBe(100);
    }
  });

  it('applies extraSet attributes alongside the increment', async () => {
    const c = fakeClient();
    const sendSpy = c.send as jest.Mock;
    await svc.atomicIncrement(c, 't1', 'COUNTER#students', 1, {
      entityType: 'Counter',
      lastIncrementedAt: '2026-04-23T00:00:00Z',
    });

    const sent = sendSpy.mock.calls[0][0];
    const cmd = sent.input ?? sent.params ?? sent;
    expect(cmd.UpdateExpression).toContain('ADD counterValue :delta');
    expect(cmd.UpdateExpression).toContain('SET');
    expect(cmd.ExpressionAttributeNames).toMatchObject({
      '#entityType': 'entityType',
      '#lastIncrementedAt': 'lastIncrementedAt',
    });
    expect(cmd.ExpressionAttributeValues).toMatchObject({
      ':delta': 1,
      ':entityType': 'Counter',
      ':lastIncrementedAt': '2026-04-23T00:00:00Z',
    });
  });

  it('retries once on ConditionalCheckFailedException and then throws', async () => {
    const client = {
      send: jest.fn(async () => {
        const err: any = new Error('conditional check failed');
        err.name = 'ConditionalCheckFailedException';
        throw err;
      }),
    } as unknown as DynamoDBDocumentClient;

    await expect(svc.atomicIncrement(client, 't1', 'COUNTER#x')).rejects.toThrow(/conditional check failed/);
    expect((client.send as jest.Mock).mock.calls.length).toBe(2); // one original + one retry
  });
});
