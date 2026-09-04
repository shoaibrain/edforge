import { StaleFinanceJobSweeper, queuedStaleAgeMs } from './stale-finance-job-sweeper.service';

describe('StaleFinanceJobSweeper queued-orphan rule vs JOBS_TRANSPORT (C3.7)', () => {
  it('keeps the 10-minute rule inline and disables it under sqs', () => {
    expect(queuedStaleAgeMs({})).toBe(10 * 60 * 1000);
    expect(queuedStaleAgeMs({ JOBS_TRANSPORT: 'inline' })).toBe(10 * 60 * 1000);
    expect(queuedStaleAgeMs({ JOBS_TRANSPORT: 'sqs' })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('StaleFinanceJobSweeper under JOBS_TRANSPORT=sqs', () => {
  const saved = process.env.JOBS_TRANSPORT;
  afterEach(() => { if (saved === undefined) delete process.env.JOBS_TRANSPORT; else process.env.JOBS_TRANSPORT = saved; });

  it('skips the queued-orphan scan without touching the table or building an invalid date', async () => {
    process.env.JOBS_TRANSPORT = 'sqs';
    const send = jest.fn();
    const sweeper = Object.create(StaleFinanceJobSweeper.prototype) as StaleFinanceJobSweeper;
    Object.assign(sweeper, { logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() } });
    const swept = await (sweeper as unknown as { sweepStaleQueuedExports: (c: unknown, t: string, n: Date) => Promise<number> }).sweepStaleQueuedExports({ send }, 't', new Date());
    expect(swept).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });
});
