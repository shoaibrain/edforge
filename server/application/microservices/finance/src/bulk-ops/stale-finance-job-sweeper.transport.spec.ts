import { queuedStaleAgeMs } from './stale-finance-job-sweeper.service';

describe('StaleFinanceJobSweeper queued-orphan rule vs JOBS_TRANSPORT (C3.7)', () => {
  it('keeps the 10-minute rule inline and disables it under sqs', () => {
    expect(queuedStaleAgeMs({})).toBe(10 * 60 * 1000);
    expect(queuedStaleAgeMs({ JOBS_TRANSPORT: 'inline' })).toBe(10 * 60 * 1000);
    expect(queuedStaleAgeMs({ JOBS_TRANSPORT: 'sqs' })).toBe(Number.POSITIVE_INFINITY);
  });
});
