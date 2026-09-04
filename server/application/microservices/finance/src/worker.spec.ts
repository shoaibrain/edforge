import { createWorkerHandler } from './worker';
import { FinanceJobsService } from './bulk-ops/finance-jobs.service';
import { DdbSchoolLock } from './bulk-ops/util/ddb-school-lock';
import { SchoolLockBusyError } from './bulk-ops/util/school-lock';
import { BulkInvoiceGenerateWorker } from './bulk-ops/workers/bulk-invoice-generate.worker';

const NOW = 1_800_000_000_000;
const body = (over: Record<string, unknown> = {}) => JSON.stringify({
  version: 1, jobId: 'j1', jobType: 'bulk_invoice_generate', tenantId: 'tenant-1', schoolId: 's1',
  input: { schoolId: 's1', resolvedStudentIds: ['a'] },
  context: { tenantId: 'tenant-1', userId: 'u1', email: 'e', role: 'TenantAdmin', jwtToken: 'jwt' }, ...over,
});
const event = (b: string, id = 'm1') => ({ Records: [{ messageId: id, body: b }] }) as never;

type FakeJob = { status: string; counters?: { succeeded?: number; failed?: number } } | null;
function fakeApp(job: FakeJob, held: { owner: string; expiresAt: number } | null = null, runImpl: () => Promise<unknown> = async () => undefined, after: FakeJob = job?.status === 'queued' ? { status: 'succeeded', counters: { succeeded: 1 } } : job) {
  const jobs = { get: jest.fn().mockResolvedValueOnce(job).mockResolvedValue(after), markFailed: jest.fn().mockResolvedValue(undefined) };
  const lock = { peek: jest.fn().mockResolvedValue(held) };
  const worker = { run: jest.fn(runImpl) };
  const app = { get: jest.fn((token: unknown) => (token === FinanceJobsService ? jobs : token === DdbSchoolLock ? lock : token === BulkInvoiceGenerateWorker ? worker : undefined)) };
  return { app, jobs, lock, worker };
}
const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
const handlerFor = (app: unknown) => createWorkerHandler({ getApp: async () => app as never, logger, now: () => NOW });

describe('finance workerHandler (C3.7)', () => {
  it('runs a queued job through the worker class with the message context', async () => {
    const { app, worker } = fakeApp({ status: 'queued' });
    const r = await handlerFor(app)(event(body()));
    expect(r).toEqual({ batchItemFailures: [] });
    expect(worker.run).toHaveBeenCalledWith('j1', { schoolId: 's1', resolvedStudentIds: ['a'] }, expect.objectContaining({ tenantId: 'tenant-1', jwtToken: 'jwt' }));
  });

  it('drops a duplicate delivery while the job runs and its lock is alive', async () => {
    const { app, worker, jobs } = fakeApp({ status: 'running' }, { owner: 'j1', expiresAt: NOW / 1000 + 600 });
    await handlerFor(app)(event(body()));
    expect(worker.run).not.toHaveBeenCalled();
    expect(jobs.markFailed).not.toHaveBeenCalled();
  });

  it('marks a running job failed when its lock expired or belongs to another job (worker lost), and does not re-run it', async () => {
    const { app, worker, jobs } = fakeApp({ status: 'running' }, { owner: 'j1', expiresAt: NOW / 1000 - 1 });
    await handlerFor(app)(event(body()));
    expect(worker.run).not.toHaveBeenCalled();
    expect(jobs.markFailed).toHaveBeenCalledWith('j1', expect.stringContaining('worker lost'), expect.objectContaining({ tenantId: 'tenant-1' }));
    const other = fakeApp({ status: 'running' }, null);
    await handlerFor(other.app)(event(body()));
    expect(other.jobs.markFailed).toHaveBeenCalled();
  });

  it('reports the message as a batch item failure when the school is busy, so SQS retries it', async () => {
    const { app } = fakeApp({ status: 'queued' }, null, async () => { throw new SchoolLockBusyError('s1', 'j0'); });
    const r = await handlerFor(app)(event(body(), 'm7'));
    expect(r).toEqual({ batchItemFailures: [{ itemIdentifier: 'm7' }] });
  });

  it('acks finished, missing and unknown-type jobs', async () => {
    expect(await handlerFor(fakeApp({ status: 'succeeded' }).app)(event(body()))).toEqual({ batchItemFailures: [] });
    expect(await handlerFor(fakeApp(null).app)(event(body()))).toEqual({ batchItemFailures: [] });
    const { app, worker } = fakeApp({ status: 'queued' });
    expect(await handlerFor(app)(event(body({ jobType: 'nope' })))).toEqual({ batchItemFailures: [] });
    expect(worker.run).not.toHaveBeenCalled();
  });

  it('ends the invocation with an error (the functions-errors alarm) when the job is not terminal after the worker returned, or failed without producing anything', async () => {
    const stuck = fakeApp({ status: 'queued' }, null, async () => undefined, { status: 'running' });
    await expect(handlerFor(stuck.app)(event(body()))).rejects.toThrow(/still 'running'/);
    expect(stuck.worker.run).toHaveBeenCalled();
    const wholesale = fakeApp({ status: 'queued' }, null, async () => undefined, { status: 'failed', counters: { succeeded: 0, failed: 5 } });
    await expect(handlerFor(wholesale.app)(event(body()))).rejects.toThrow(/without producing anything \(5 failed\)/);
  });

  it('acks a job that reached a terminal state, including a partial failure that produced something', async () => {
    const partial = fakeApp({ status: 'queued' }, null, async () => undefined, { status: 'failed', counters: { succeeded: 3, failed: 2 } });
    expect(await handlerFor(partial.app)(event(body()))).toEqual({ batchItemFailures: [] });
    const ok = fakeApp({ status: 'queued' }, null, async () => undefined, { status: 'succeeded', counters: { succeeded: 5, failed: 0 } });
    expect(await handlerFor(ok.app)(event(body()))).toEqual({ batchItemFailures: [] });
  });

  it('reports a malformed message and a transient failure as batch item failures (retry, then the DLQ alarm)', async () => {
    const { app } = fakeApp({ status: 'queued' });
    expect(await handlerFor(app)(event('not json', 'm9'))).toEqual({ batchItemFailures: [{ itemIdentifier: 'm9' }] });
    const throttled = fakeApp({ status: 'queued' });
    throttled.jobs.get.mockRejectedValue(Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' }));
    expect(await handlerFor(throttled.app)(event(body(), 'm10'))).toEqual({ batchItemFailures: [{ itemIdentifier: 'm10' }] });
  });
});
