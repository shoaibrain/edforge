import { DdbSchoolLock } from './ddb-school-lock';
import { SchoolLockBusyError } from './school-lock';

const conditional = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
const input = (cmd: unknown) => ((cmd as { input?: unknown }).input ?? (cmd as { params?: unknown }).params) as Record<string, unknown>;
const context = { tenantId: 'tenant-1', userId: 'u1', email: 'e', role: 'TenantAdmin', jwtToken: 'jwt' };

function harness(sendImpl: (...args: unknown[]) => unknown, opts: Record<string, unknown> = {}) {
  const send = jest.fn(sendImpl);
  const ddb = { getClient: jest.fn().mockResolvedValue({ send }), getTableName: () => 'edforge-finance-test' };
  let t = 1_800_000_000_000;
  const lock = new DdbSchoolLock(ddb as never, { now: () => t, sleep: async (ms) => { t += ms; }, pollMs: 1000, waitMs: 5000, heartbeatMs: 60_000, ...opts });
  return { send, lock, ddb, tick: (ms: number) => { t += ms; } };
}

describe('DdbSchoolLock (C3.6)', () => {
  it('takes a fence from the per-school sequence, then a conditional PutItem for the lock row; release deletes as owner', async () => {
    const { send, lock } = harness((cmd) => (input(cmd).UpdateExpression === 'ADD fence :one' ? { Attributes: { fence: 7 } } : {}));
    const h = await lock.acquire('school-1', { owner: 'job-1', context });
    expect(h.fence).toBe(7);
    const [seq, put] = send.mock.calls.map((c) => input(c[0]));
    expect(seq).toEqual(expect.objectContaining({ Key: { tenantId: 'tenant-1', entityKey: 'LOCKSEQ#school-1' }, UpdateExpression: 'ADD fence :one', ReturnValues: 'UPDATED_NEW' }));
    expect(put).toEqual(expect.objectContaining({
      TableName: 'edforge-finance-test',
      Item: expect.objectContaining({ tenantId: 'tenant-1', entityKey: 'LOCK#SCHOOL#school-1', owner: 'job-1', fence: 7, expiresAt: 1_800_000_000 + 16 * 60, ttl: 1_800_000_000 + 16 * 60 }),
      ConditionExpression: 'attribute_not_exists(entityKey) OR expiresAt < :now',
    }));
    await h.release();
    await h.release(); // idempotent
    const del = input(send.mock.calls[2][0]);
    expect(del).toEqual(expect.objectContaining({ Key: { tenantId: 'tenant-1', entityKey: 'LOCK#SCHOOL#school-1' }, ConditionExpression: '#owner = :owner', ExpressionAttributeValues: { ':owner': 'job-1' } }));
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('contention: polls with backoff and throws SchoolLockBusyError once the wait budget is spent, without failing anything else', async () => {
    const { send, lock } = harness((cmd) => {
      const i = input(cmd);
      if (i.UpdateExpression === 'ADD fence :one') return { Attributes: { fence: 3 } };
      throw conditional();
    });
    await expect(lock.acquire('school-1', { owner: 'job-2', context })).rejects.toBeInstanceOf(SchoolLockBusyError);
    const puts = send.mock.calls.filter((c) => input(c[0]).ConditionExpression === 'attribute_not_exists(entityKey) OR expiresAt < :now');
    expect(puts.length).toBeGreaterThan(1);
  });

  it('expiry takeover: the PutItem condition admits a row whose expiresAt is in the past', async () => {
    const { send, lock } = harness((cmd) => (input(cmd).UpdateExpression === 'ADD fence :one' ? { Attributes: { fence: 4 } } : {}));
    await lock.acquire('school-1', { owner: 'job-3', context });
    expect(input(send.mock.calls[1][0]).ExpressionAttributeValues).toEqual({ ':now': 1_800_000_000 });
  });

  it('release by a non-owner (condition fails) is ignored, not thrown', async () => {
    const { send, lock } = harness((cmd) => {
      const i = input(cmd);
      if (i.UpdateExpression === 'ADD fence :one') return { Attributes: { fence: 5 } };
      if (i.ConditionExpression === '#owner = :owner' && 'Key' in i && !('UpdateExpression' in i)) throw conditional();
      return {};
    });
    const h = await lock.acquire('school-1', { owner: 'job-4', context });
    await expect(h.release()).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('heartbeats extend expiresAt as the owner until release', async () => {
    jest.useFakeTimers();
    try {
      const { send, lock } = harness((cmd) => (input(cmd).UpdateExpression === 'ADD fence :one' ? { Attributes: { fence: 6 } } : {}), { heartbeatMs: 1000 });
      const h = await lock.acquire('school-1', { owner: 'job-5', context });
      jest.advanceTimersByTime(2500);
      const beats = send.mock.calls.map((c) => input(c[0])).filter((i) => i.UpdateExpression === 'SET expiresAt = :exp, #ttl = :exp');
      expect(beats).toHaveLength(2);
      expect(beats[0]).toEqual(expect.objectContaining({ ConditionExpression: '#owner = :owner', ExpressionAttributeValues: expect.objectContaining({ ':owner': 'job-5' }) }));
      await h.release();
      jest.advanceTimersByTime(5000);
      expect(send.mock.calls.map((c) => input(c[0])).filter((i) => i.UpdateExpression === 'SET expiresAt = :exp, #ttl = :exp')).toHaveLength(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('requires the request context', async () => {
    const { lock } = harness(() => ({}));
    await expect(lock.acquire('school-1', { owner: 'x' })).rejects.toThrow(/request context/);
  });
});
