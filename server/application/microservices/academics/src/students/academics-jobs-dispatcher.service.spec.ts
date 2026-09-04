import { AcademicsJobsDispatcherService } from './academics-jobs-dispatcher.service';
import { IemisImportStagingService, IEMIS_STAGING_TAG } from './iemis-import-staging.service';

const context = { tenantId: 'tenant-1', userId: 'u1', email: 'e', role: 'TenantAdmin', jwtToken: 'jwt-secret' };
const rows = [{ emisStudentId: '1' }, { emisStudentId: '2' }] as never;

describe('AcademicsJobsDispatcherService (C3.11)', () => {
  it('inline: runs after the response yields', async () => {
    const run = jest.fn().mockResolvedValue(undefined);
    const svc = new AcademicsJobsDispatcherService({} as never, {});
    expect(await svc.dispatch({ jobId: 'j1', schoolId: 's1', rows, run }, context as never)).toEqual({ transport: 'inline' });
    await new Promise((r) => setImmediate(r));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('sqs: stages the rows, then sends one message carrying the staging key and the operator context', async () => {
    const staging = { put: jest.fn().mockResolvedValue('tenant=tenant-1/iemis-import/j1.json') };
    const send = jest.fn().mockResolvedValue({ MessageId: 'm1' });
    const svc = new AcademicsJobsDispatcherService(staging as never, { JOBS_TRANSPORT: 'sqs', ACADEMICS_JOBS_QUEUE_URL: 'https://sqs/q' }, { send } as never);
    const run = jest.fn();
    const r = await svc.dispatch({ jobId: 'j1', schoolId: 's1', rows, enrollInAcademicYearId: 'ay1', run }, context as never);
    expect(r).toEqual({ transport: 'sqs', messageId: 'm1', stagingKey: 'tenant=tenant-1/iemis-import/j1.json' });
    expect(run).not.toHaveBeenCalled();
    expect(staging.put).toHaveBeenCalledWith('j1', rows, context);
    const msg = JSON.parse((send.mock.calls[0][0] as { input: { MessageBody: string } }).input.MessageBody);
    expect(msg).toEqual({ version: 1, jobId: 'j1', jobType: 'iemis_import', tenantId: 'tenant-1', schoolId: 's1', stagingKey: 'tenant=tenant-1/iemis-import/j1.json', enrollInAcademicYearId: 'ay1', context: { tenantId: 'tenant-1', userId: 'u1', email: 'e', role: 'TenantAdmin', jwtToken: 'jwt-secret' } });
    expect(JSON.stringify(msg).length).toBeLessThan(2000); // rows are not in the message
  });
});

describe('IemisImportStagingService (C3.11)', () => {
  const saved = process.env.REPORTS_STAGING_BUCKET;
  beforeAll(() => { process.env.REPORTS_STAGING_BUCKET = 'edforge-reports-staging-test'; });
  afterAll(() => { if (saved === undefined) delete process.env.REPORTS_STAGING_BUCKET; else process.env.REPORTS_STAGING_BUCKET = saved; });

  it('writes the rows under the tenant ABAC prefix with the ephemeral tag, using a vended client, and reads them back', async () => {
    const send = jest.fn().mockImplementation((cmd: { input: Record<string, unknown> }) => (cmd.input.Body ? {} : { Body: { transformToString: async () => JSON.stringify(rows) } }));
    const factory = jest.fn().mockResolvedValue({ send });
    const svc = new IemisImportStagingService(factory);
    const key = await svc.put('j1', rows, { tenantId: 'tenant-1', jwtToken: 'jwt' });
    expect(key).toBe('tenant=tenant-1/iemis-import/j1.json');
    expect(factory).toHaveBeenCalledWith('jwt');
    const putInput = (send.mock.calls[0][0] as { input: Record<string, unknown> }).input;
    expect(putInput).toEqual(expect.objectContaining({ Bucket: 'edforge-reports-staging-test', Key: key, ContentType: 'application/json', Tagging: IEMIS_STAGING_TAG }));
    expect(await svc.get(key, { tenantId: 'tenant-1', jwtToken: 'jwt' })).toEqual(rows);
    await svc.delete(key, { tenantId: 'tenant-1', jwtToken: 'jwt' });
    expect(send).toHaveBeenCalledTimes(3);
  });
});
