import { JobsDispatcherService, jobsTransport } from './jobs-dispatcher.service';

const context = { tenantId: 'tenant-1', userId: 'u1', email: 'op@example.test', role: 'TenantAdmin', jwtToken: 'jwt-secret', username: 'op' };

describe('JobsDispatcherService (C3.7)', () => {
  it('inline: runs the worker after the response yields and swallows its errors into the log', async () => {
    const svc = new JobsDispatcherService({});
    const run = jest.fn().mockRejectedValue(new Error('boom'));
    const r = await svc.dispatch({ jobId: 'j1', jobType: 'bulk_invoice_generate', schoolId: 's1', input: {}, run }, context as never);
    expect(r).toEqual({ transport: 'inline' });
    expect(run).not.toHaveBeenCalled(); // not yet: setImmediate
    await new Promise((res) => setImmediate(res));
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('sqs: sends one message carrying the job, its input and the operator context (JWT included, never logged)', async () => {
    const send = jest.fn().mockResolvedValue({ MessageId: 'm-1' });
    const svc = new JobsDispatcherService({ JOBS_TRANSPORT: 'sqs', FINANCE_JOBS_QUEUE_URL: 'https://sqs.ap-south-1.amazonaws.com/111111111111/edforge-finance-jobs-basic' }, { send } as never);
    const run = jest.fn();
    const logs: string[] = [];
    jest.spyOn((svc as unknown as { logger: { log: (m: string) => void } }).logger, 'log').mockImplementation((m: string) => { logs.push(m); });
    const r = await svc.dispatch({ jobId: 'j1', jobType: 'bulk_invoice_pdf_export', schoolId: 's1', input: { invoiceIds: ['a'], format: 'zip' }, run }, context as never);
    expect(r).toEqual({ transport: 'sqs', messageId: 'm-1' });
    expect(run).not.toHaveBeenCalled();
    const input = (send.mock.calls[0][0] as { input: { QueueUrl: string; MessageBody: string; MessageAttributes: Record<string, { StringValue: string }> } }).input;
    expect(input.QueueUrl).toContain('edforge-finance-jobs-basic');
    expect(JSON.parse(input.MessageBody)).toEqual({
      version: 1, jobId: 'j1', jobType: 'bulk_invoice_pdf_export', tenantId: 'tenant-1', schoolId: 's1',
      input: { invoiceIds: ['a'], format: 'zip' },
      context: { tenantId: 'tenant-1', userId: 'u1', email: 'op@example.test', role: 'TenantAdmin', jwtToken: 'jwt-secret', username: 'op' },
    });
    expect(input.MessageAttributes.jobType.StringValue).toBe('bulk_invoice_pdf_export');
    expect(logs.join('\n')).not.toContain('jwt-secret');
  });

  it('sqs without a queue URL is a configuration error, not a silent inline run', async () => {
    const svc = new JobsDispatcherService({ JOBS_TRANSPORT: 'sqs' }, { send: jest.fn() } as never);
    await expect(svc.dispatch({ jobId: 'j', jobType: 'bulk_invoice_generate', schoolId: 's', input: {}, run: jest.fn() }, context as never)).rejects.toThrow(/FINANCE_JOBS_QUEUE_URL/);
  });

  it('jobsTransport() defaults to inline and accepts sqs case-insensitively', () => {
    expect(jobsTransport({})).toBe('inline');
    expect(jobsTransport({ JOBS_TRANSPORT: 'SQS' })).toBe('sqs');
    expect(jobsTransport({ JOBS_TRANSPORT: 'nope' })).toBe('inline');
  });
});
