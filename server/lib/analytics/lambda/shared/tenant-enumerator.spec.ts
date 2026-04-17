import { enumerateActiveTenants } from './tenant-enumerator';

function mkItem(
  tenantId: string,
  overrides: Record<string, string> = {},
) {
  return {
    tenantId: { S: tenantId },
    entityKey: { S: 'METADATA' },
    name: { S: overrides.name ?? `tenant-${tenantId}` },
    tier: { S: overrides.tier ?? 'BASIC' },
    status: { S: overrides.status ?? 'active' },
    createdAt: { S: overrides.createdAt ?? '2026-01-01T00:00:00.000Z' },
    ...(overrides.contactEmail
      ? { contactEmail: { S: overrides.contactEmail } }
      : {}),
    ...(overrides.alertTopicArn
      ? { alertTopicArn: { S: overrides.alertTopicArn } }
      : {}),
  };
}

describe('enumerateActiveTenants (6.2)', () => {
  it('returns all tenants from a single-page scan', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Items: [mkItem('t1'), mkItem('t2')],
    });
    const ddb = { send } as any;
    const result = await enumerateActiveTenants(ddb);
    expect(result).toHaveLength(2);
    expect(result.map((t) => t.tenantId)).toEqual(['t1', 't2']);
  });

  it('pages through LastEvaluatedKey and returns no duplicates', async () => {
    const send = jest
      .fn()
      .mockResolvedValueOnce({
        Items: [mkItem('t1'), mkItem('t2')],
        LastEvaluatedKey: { tenantId: { S: 't2' } },
      })
      .mockResolvedValueOnce({
        Items: [mkItem('t3')],
        LastEvaluatedKey: { tenantId: { S: 't3' } },
      })
      .mockResolvedValueOnce({
        // defensive duplicate — enumerator must dedupe
        Items: [mkItem('t3'), mkItem('t4')],
      });
    const ddb = { send } as any;
    const result = await enumerateActiveTenants(ddb);
    expect(result.map((t) => t.tenantId).sort()).toEqual(['t1', 't2', 't3', 't4']);
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('excludes non-active tenants by default', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Items: [mkItem('t1'), mkItem('t2', { status: 'inactive' })],
    });
    const ddb = { send } as any;
    const result = await enumerateActiveTenants(ddb);
    expect(result.map((t) => t.tenantId)).toEqual(['t1']);
  });

  it('includes inactive tenants when onlyActive=false', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Items: [mkItem('t1'), mkItem('t2', { status: 'suspended' })],
    });
    const ddb = { send } as any;
    const result = await enumerateActiveTenants(ddb, { onlyActive: false });
    expect(result).toHaveLength(2);
  });

  it('forwards contactEmail and alertTopicArn when present', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      Items: [
        mkItem('t1', {
          contactEmail: 'ops@example.com',
          alertTopicArn: 'arn:aws:sns:us-east-2:1:alerts',
        }),
      ],
    });
    const ddb = { send } as any;
    const [row] = await enumerateActiveTenants(ddb);
    expect(row.contactEmail).toBe('ops@example.com');
    expect(row.alertTopicArn).toBe('arn:aws:sns:us-east-2:1:alerts');
  });
});
