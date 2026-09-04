import { createWorkerHandler } from './worker';
import { StudentsService } from './students/students.service';
import { IemisImportJobsService } from './students/iemis-import-jobs.service';
import { IemisImportStagingService } from './students/iemis-import-staging.service';

const body = (over: Record<string, unknown> = {}) => JSON.stringify({
  version: 1, jobId: 'j1', jobType: 'iemis_import', tenantId: 'tenant-1', schoolId: 's1', stagingKey: 'tenant=tenant-1/iemis-import/j1.json', enrollInAcademicYearId: 'ay1',
  context: { tenantId: 'tenant-1', userId: 'u1', email: 'e', role: 'TenantAdmin', jwtToken: 'jwt' }, ...over,
});
const event = (b: string, id = 'm1') => ({ Records: [{ messageId: id, body: b }] }) as never;
function fakeApp(job: { status: string } | null, after: { status: string } | null = job?.status === 'queued' ? { status: 'succeeded' } : job) {
  const jobs = { get: jest.fn().mockResolvedValueOnce(job).mockResolvedValue(after) };
  const staging = { get: jest.fn().mockResolvedValue([{ a: 1 }, { a: 2 }]), delete: jest.fn().mockResolvedValue(undefined) };
  const students = { executeIemisImportAsync: jest.fn().mockResolvedValue(undefined) };
  const app = { get: jest.fn((t: unknown) => (t === IemisImportJobsService ? jobs : t === IemisImportStagingService ? staging : t === StudentsService ? students : undefined)) };
  return { app, jobs, staging, students };
}
const logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;

describe('academics workerHandler (C3.11)', () => {
  it('loads the staged rows, runs the import with the message context, then deletes the staging object', async () => {
    const { app, staging, students } = fakeApp({ status: 'queued' });
    const r = await createWorkerHandler({ getApp: async () => app as never, logger })(event(body()));
    expect(r).toEqual({ batchItemFailures: [] });
    expect(staging.get).toHaveBeenCalledWith('tenant=tenant-1/iemis-import/j1.json', expect.objectContaining({ tenantId: 'tenant-1', jwtToken: 'jwt' }));
    expect(students.executeIemisImportAsync).toHaveBeenCalledWith('j1', [{ a: 1 }, { a: 2 }], 's1', expect.objectContaining({ tenantId: 'tenant-1' }), 'ay1');
    expect(staging.delete).toHaveBeenCalledWith('tenant=tenant-1/iemis-import/j1.json', expect.anything());
  });

  it('drops duplicates of a running job and finished or missing jobs without touching S3', async () => {
    for (const job of [{ status: 'running' }, { status: 'succeeded' }, null]) {
      const { app, staging, students } = fakeApp(job);
      await createWorkerHandler({ getApp: async () => app as never, logger })(event(body()));
      expect(staging.get).not.toHaveBeenCalled();
      expect(students.executeIemisImportAsync).not.toHaveBeenCalled();
    }
  });

  it('ends the invocation with an error when the job is not terminal after the import returned (its final write failed)', async () => {
    const stuck = fakeApp({ status: 'queued' }, { status: 'running' });
    await expect(createWorkerHandler({ getApp: async () => stuck.app as never, logger })(event(body()))).rejects.toThrow(/still 'running'/);
    expect(stuck.staging.delete).toHaveBeenCalled();
    const failed = fakeApp({ status: 'queued' }, { status: 'failed' });
    expect(await createWorkerHandler({ getApp: async () => failed.app as never, logger })(event(body()))).toEqual({ batchItemFailures: [] });
  });

  it('reports a malformed message and a transient failure as batch item failures (retry, then the DLQ alarm)', async () => {
    const { app } = fakeApp({ status: 'queued' });
    expect(await createWorkerHandler({ getApp: async () => app as never, logger })(event('nope', 'm9'))).toEqual({ batchItemFailures: [{ itemIdentifier: 'm9' }] });
    const throttled = fakeApp({ status: 'queued' });
    throttled.jobs.get.mockRejectedValue(new Error('Rate exceeded'));
    expect(await createWorkerHandler({ getApp: async () => throttled.app as never, logger })(event(body(), 'm10'))).toEqual({ batchItemFailures: [{ itemIdentifier: 'm10' }] });
  });
});
