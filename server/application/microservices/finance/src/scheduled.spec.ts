import { createScheduledHandler, SCHEDULED_JOBS } from './scheduled';
import { DynamoDBClientService } from './common/services/dynamodb-client.service';
import { OverdueDetectionService } from './common/services/overdue-detection.service';

/**
 * C3.3 — the scheduled entry takes the run lease for (job, window) and calls
 * the owning service's runOnce() once; a second delivery for the same
 * window is a no-op; an unknown job never touches the table.
 */
const conditional = () => Object.assign(new Error('The conditional request failed'), { name: 'ConditionalCheckFailedException' });

function fakeApp(send: jest.Mock) {
  const runOnce = jest.fn().mockResolvedValue({ marked: 2, scanned: 10 });
  const ddb = { getSystemClient: () => ({ send }), getTableName: () => 'edforge-finance-test' };
  const app = { get: jest.fn((token: unknown) => (token === DynamoDBClientService ? ddb : token === OverdueDetectionService ? { runOnce } : undefined)) };
  return { app, runOnce };
}

describe('scheduledHandler (C3.3)', () => {
  const event = { job: 'overdue-detection', scheduledTime: '2026-09-04T19:00:00Z' };
  const logger = { log: jest.fn(), error: jest.fn() } as never;

  it('acquires the lease then runs the job exactly once', async () => {
    const send = jest.fn().mockResolvedValue({});
    const { app, runOnce } = fakeApp(send);
    const handler = createScheduledHandler({ getApp: async () => app as never, logger, env: {} });
    const r = await handler(event);
    expect(r).toEqual({ job: 'overdue-detection', windowKey: '202609041900', ran: true, result: { marked: 2, scanned: 10 } });
    expect(runOnce).toHaveBeenCalledTimes(1);
    const put = send.mock.calls[0][0] as { input?: Record<string, unknown>; params?: Record<string, unknown> };
    const input = put.input ?? put.params!;
    expect(input.TableName).toBe('edforge-finance-test');
    expect((input.Item as Record<string, unknown>).tenantId).toBe('SYSTEM#overdue-detection');
    expect((input.Item as Record<string, unknown>).entityKey).toBe('LEASE#202609041900');
  });

  it('a second delivery in the same window is a no-op (lease held)', async () => {
    const send = jest.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(conditional());
    const { app, runOnce } = fakeApp(send);
    const handler = createScheduledHandler({ getApp: async () => app as never, logger, env: {} });
    await handler(event);
    const second = await handler(event);
    expect(second).toEqual({ job: 'overdue-detection', windowKey: '202609041900', ran: false, reason: 'lease-held' });
    expect(runOnce).toHaveBeenCalledTimes(1);
  });

  it('refuses an unknown job before touching the table or the app', async () => {
    const send = jest.fn();
    const { app } = fakeApp(send);
    const getApp = jest.fn(async () => app as never);
    const handler = createScheduledHandler({ getApp, logger, env: {} });
    const r = await handler({ job: 'nope' });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('unknown-job');
    expect(getApp).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('honours the DISABLE_<JOB> kill switch before touching the table', async () => {
    const send = jest.fn();
    const { app, runOnce } = fakeApp(send);
    const handler = createScheduledHandler({ getApp: async () => app as never, logger, env: { DISABLE_OVERDUE_DETECTION: 'true' } });
    expect(await handler(event)).toEqual({ job: 'overdue-detection', windowKey: '202609041900', ran: false, reason: 'disabled' });
    expect(send).not.toHaveBeenCalled();
    expect(runOnce).not.toHaveBeenCalled();
  });

  it('releases the lease when the run throws, so a retry can take the window', async () => {
    const send = jest.fn().mockResolvedValue({});
    const { app, runOnce } = fakeApp(send);
    runOnce.mockRejectedValueOnce(new Error('scan throttled'));
    const handler = createScheduledHandler({ getApp: async () => app as never, logger, env: {} });
    await expect(handler(event)).rejects.toThrow('scan throttled');
    const cmds = send.mock.calls.map((c) => c[0] as { input?: Record<string, unknown>; params?: Record<string, unknown> }).map((c) => c.input ?? c.params!);
    expect(cmds).toHaveLength(2);
    expect(cmds[1]).toEqual({ TableName: 'edforge-finance-test', Key: { tenantId: 'SYSTEM#overdue-detection', entityKey: 'LEASE#202609041900' } });
    await handler(event); // the retry runs
    expect(runOnce).toHaveBeenCalledTimes(2);
  });

  it('registers the four timers with a lease shorter than their period', () => {
    expect(Object.keys(SCHEDULED_JOBS).sort()).toEqual(['billing-reconciliation', 'overdue-detection', 'payment-sweep', 'recurring-billing']);
    expect(SCHEDULED_JOBS['recurring-billing'].leaseTtlSeconds).toBeLessThan(24 * 3600);
    expect(SCHEDULED_JOBS['overdue-detection'].leaseTtlSeconds).toBeLessThan(3600);
    expect(SCHEDULED_JOBS['payment-sweep'].leaseTtlSeconds).toBeLessThan(1800);
  });
});
