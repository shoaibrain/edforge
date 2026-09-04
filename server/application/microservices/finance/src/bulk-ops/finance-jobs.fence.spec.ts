import { FinanceJobsService } from './finance-jobs.service';

/**
 * C3.6 — with `jobFence` on the context, markRunning stores the fence and
 * every later transition is conditioned on it; without it the conditions
 * are exactly what they were (the inline / ECS path is unchanged).
 */
function build() {
  const updateItem = jest.fn().mockResolvedValue({ jobId: 'j1', version: 2, status: 'running', schoolId: 's1', jobType: 'bulk_invoice_generate' });
  const svc = Object.create(FinanceJobsService.prototype) as FinanceJobsService & Record<string, unknown>;
  Object.assign(svc, {
    dynamoDBClient: { getClient: jest.fn().mockResolvedValue({}), updateItem, getTableName: () => 't' },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    emitAudit: jest.fn().mockResolvedValue(undefined),
  });
  return { svc, updateItem };
}
const base = { tenantId: 'tenant-1', userId: 'u1', email: 'e', role: 'TenantAdmin', jwtToken: 'jwt' };

describe('FinanceJobsService fencing (C3.6)', () => {
  it('markRunning stores the fence when the worker holds one, and only then', async () => {
    const { svc, updateItem } = build();
    await svc.markRunning('j1', { ...base, jobFence: 9 });
    let [, , , expr, values, cond] = updateItem.mock.calls[0];
    expect(expr).toContain(', fence = :fence ADD version :one');
    expect(values[':fence']).toBe(9);
    expect(cond).toBe('#status = :queued');
    updateItem.mockClear();
    await svc.markRunning('j1', base);
    [, , , expr, values, cond] = updateItem.mock.calls[0];
    expect(expr).not.toContain('fence');
    expect(values[':fence']).toBeUndefined();
    expect(cond).toBe('#status = :queued');
  });

  it('incrementCounter is conditioned on the fence when present and unchanged otherwise', async () => {
    const { svc, updateItem } = build();
    await svc.incrementCounter('j1', 'succeeded', 1, { ...base, jobFence: 9 });
    let [, , , , values, cond] = updateItem.mock.calls[0];
    expect(cond).toBe('(#status = :queued OR #status = :running) AND fence = :fence');
    expect(values[':fence']).toBe(9);
    updateItem.mockClear();
    await svc.incrementCounter('j1', 'succeeded', 1, base);
    [, , , , values, cond] = updateItem.mock.calls[0];
    expect(cond).toBe('#status = :queued OR #status = :running');
    expect(values[':fence']).toBeUndefined();
  });
});
