import { acquireRunLease, runWindowKey, RUN_LEASE_PARTITION_PREFIX } from './run-lease';

const conditional = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });
const key = { pk: 'tenantId', sk: 'entityKey' };
// The application jest setup mocks the DynamoDB SDK; commands expose their payload as `input` (or `params`).
const commandInput = (cmd: unknown): Record<string, unknown> => ((cmd as { input?: unknown })?.input ?? (cmd as { params?: unknown })?.params) as Record<string, unknown>;

describe('runWindowKey (C3.1)', () => {
  it('floors to the minute in UTC and is stable for the same scheduled time', () => {
    expect(runWindowKey('2026-09-04T19:45:07.123Z')).toBe('202609041945');
    expect(runWindowKey(new Date('2026-09-04T19:45:59Z'))).toBe('202609041945');
    expect(() => runWindowKey('not a date')).toThrow(/invalid time/);
  });
});

describe('acquireRunLease (C3.1)', () => {
  it('writes one conditional PutItem under the reserved partition with the table TTL attribute', async () => {
    const send = jest.fn().mockResolvedValue({});
    const now = () => 1_800_000_000_000;
    const r = await acquireRunLease({ send } as never, 'edforge-finance-basic', key, 'overdue-detection', '202609041900', 3600, now);
    expect(r).toEqual({ acquired: true, pk: `${RUN_LEASE_PARTITION_PREFIX}overdue-detection`, sk: 'LEASE#202609041900', expiresAt: 1_800_000_000 + 3600 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(commandInput(send.mock.calls[0][0])).toEqual({
      TableName: 'edforge-finance-basic',
      Item: { tenantId: 'SYSTEM#overdue-detection', entityKey: 'LEASE#202609041900', jobName: 'overdue-detection', windowKey: '202609041900', acquiredAt: 1_800_000_000, ttl: 1_800_003_600 },
      ConditionExpression: 'attribute_not_exists(#sk) OR #ttl < :now',
      ExpressionAttributeNames: { '#sk': 'entityKey', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':now': 1_800_000_000 },
    });
  });

  it('refuses a second acquire in the same window (conditional failure → acquired: false, no throw)', async () => {
    const send = jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(conditional());
    const first = await acquireRunLease({ send } as never, 't', key, 'sweep', 'w1', 60);
    const second = await acquireRunLease({ send } as never, 't', key, 'sweep', 'w1', 60);
    expect(first.acquired).toBe(true);
    expect(second.acquired).toBe(false);
  });

  it('the condition admits an expired lease by comparing the stored ttl with now', async () => {
    const send = jest.fn().mockResolvedValue({});
    const later = () => 1_800_010_000_000;
    const r = await acquireRunLease({ send } as never, 't', key, 'sweep', 'w1', 60, later);
    expect(r.acquired).toBe(true);
    expect(commandInput(send.mock.calls[0][0]).ExpressionAttributeValues).toEqual({ ':now': 1_800_010_000 });
  });

  it('propagates any error other than the conditional failure', async () => {
    const send = jest.fn().mockRejectedValue(Object.assign(new Error('throttled'), { name: 'ProvisionedThroughputExceededException' }));
    await expect(acquireRunLease({ send } as never, 't', key, 'sweep', 'w1', 60)).rejects.toThrow('throttled');
  });
});
