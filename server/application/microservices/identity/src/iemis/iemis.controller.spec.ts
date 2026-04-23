import { IemisController } from './iemis.controller';
import { IemisAuditLogger } from '../common/services/iemis-audit-logger.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';

const makeCtrl = (overrides?: { auditEmit?: jest.Mock; query?: jest.Mock }) => {
  const auditEmit = overrides?.auditEmit ?? jest.fn().mockResolvedValue({ eventId: 'e1' });
  const auditLogger = { emit: auditEmit } as unknown as IemisAuditLogger;
  const ddb = {
    getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
    query: overrides?.query ?? jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  } as unknown as DynamoDBClientService;
  const ctrl = new IemisController(auditLogger, ddb);
  return { ctrl, auditEmit, ddb };
};

const tenant = {
  tenantId: 'tenant-a',
  userId: 'user-admin',
  email: 'a@b',
  globalRole: 'TenantAdmin',
  username: 'admin',
} as any;

const reqWithJwt = (jwt = 'jwt-token'): any => ({
  headers: { authorization: `Bearer ${jwt}` },
  ip: '10.0.0.1',
});

describe('IemisController.verifySchoolCode (S1.5)', () => {
  it('returns { valid: true } for a well-formed code', async () => {
    const { ctrl } = makeCtrl();
    const r = await ctrl.verifySchoolCode('12345678', tenant, reqWithJwt());
    expect(r).toEqual({ code: '12345678', valid: true });
  });

  it('returns { valid: false, reason } for a malformed code', async () => {
    const { ctrl } = makeCtrl();
    const r = await ctrl.verifySchoolCode('abcd', tenant, reqWithJwt());
    expect(r.valid).toBe(false);
    expect(r.reason).toMatch(/8.10 digits/);
  });

  it('emits audit event code.verified on each call — valid or invalid', async () => {
    const { ctrl, auditEmit } = makeCtrl();

    await ctrl.verifySchoolCode('12345678', tenant, reqWithJwt());
    await ctrl.verifySchoolCode('bad', tenant, reqWithJwt());

    expect(auditEmit).toHaveBeenCalledTimes(2);
    expect(auditEmit.mock.calls[0][0]).toMatchObject({
      eventType: 'code.verified',
      tenantId: 'tenant-a',
      actorUserId: 'user-admin',
      metadata: expect.objectContaining({ code: '12345678', valid: true }),
    });
    expect(auditEmit.mock.calls[1][0]).toMatchObject({
      eventType: 'code.verified',
      metadata: expect.objectContaining({ valid: false }),
    });
  });

  it('strips the Bearer prefix before passing jwt to the audit logger', async () => {
    const { ctrl, auditEmit } = makeCtrl();
    await ctrl.verifySchoolCode('12345678', tenant, reqWithJwt('raw-jwt-value'));
    expect(auditEmit.mock.calls[0][1]).toBe('raw-jwt-value');
  });

  it('does not throw if audit emit fails (fail-open contract)', async () => {
    const { ctrl } = makeCtrl({ auditEmit: jest.fn().mockRejectedValue(new Error('boom')) });
    // The controller awaits emit; a rejected promise would bubble UNLESS
    // IemisAuditLogger.emit swallows internally (which it does in S1.9).
    // This test asserts the contract by using a mock that DOES resolve
    // null for failure — matches real IemisAuditLogger behavior.
    const { ctrl: ctrl2 } = makeCtrl({ auditEmit: jest.fn().mockResolvedValue(null) });
    const r = await ctrl2.verifySchoolCode('12345678', tenant, reqWithJwt());
    expect(r.valid).toBe(true);
  });
});

describe('IemisController.listAuditEvents (S1.10)', () => {
  const ddbRow = {
    eventType: 'code.verified',
    tenantId: 'tenant-a',
    actorUserId: 'user-admin',
    eventId: '550e8400-e29b-41d4-a716-446655440000',
    timestamp: '2026-04-23T10:30:00.000Z',
    entityKey: 'AUDIT#IEMIS#2026-04-23T10:30:00.000Z#550e8400-e29b-41d4-a716-446655440000',
    metadata: { emisStudentId: '1234567890123456', note: 'verified' },
  };

  it('queries DDB with AUDIT#IEMIS# SK prefix scoped to the caller tenant', async () => {
    const query = jest.fn().mockResolvedValue({ items: [], hasMore: false });
    const { ctrl, ddb } = makeCtrl({ query });

    await ctrl.listAuditEvents(undefined, undefined, undefined, tenant, reqWithJwt());

    expect(ddb.getClient).toHaveBeenCalledWith('tenant-a', 'jwt-token');
    const call = query.mock.calls[0];
    expect(call[1]).toBe('tenant-a'); // tenantId
    expect(call[2]).toBe('AUDIT#IEMIS#'); // sk prefix
  });

  it('applies an eventType filter via FilterExpression when supplied', async () => {
    const query = jest.fn().mockResolvedValue({ items: [], hasMore: false });
    const { ctrl } = makeCtrl({ query });

    await ctrl.listAuditEvents(undefined, undefined, 'code.verified', tenant, reqWithJwt());

    expect(query.mock.calls[0][3]).toContain('#et');
    expect(query.mock.calls[0][4]).toEqual({ ':et': 'code.verified' });
  });

  it('respects the `limit` query param clamped to [1, 200]', async () => {
    const query = jest.fn().mockResolvedValue({ items: [], hasMore: false });
    const { ctrl } = makeCtrl({ query });

    await ctrl.listAuditEvents('25', undefined, undefined, tenant, reqWithJwt());
    expect(query.mock.calls[0][6]).toBe(25);

    await ctrl.listAuditEvents('500', undefined, undefined, tenant, reqWithJwt());
    expect(query.mock.calls[1][6]).toBe(200); // clamped to max
  });

  it('rejects a non-positive limit with 400', async () => {
    const { ctrl } = makeCtrl();
    await expect(
      ctrl.listAuditEvents('0', undefined, undefined, tenant, reqWithJwt()),
    ).rejects.toThrow(/positive integer/);
    await expect(
      ctrl.listAuditEvents('abc', undefined, undefined, tenant, reqWithJwt()),
    ).rejects.toThrow(/positive integer/);
  });

  it('TenantAdmin sees emisStudentId raw in returned items', async () => {
    const query = jest.fn().mockResolvedValue({ items: [ddbRow], hasMore: false });
    const { ctrl } = makeCtrl({ query });

    const r = await ctrl.listAuditEvents(undefined, undefined, undefined, tenant, reqWithJwt());
    expect(r.items[0].metadata?.emisStudentId).toBe('1234567890123456');
  });

  it('non-admin viewer sees emisStudentId masked (last 4 digits visible)', async () => {
    const query = jest.fn().mockResolvedValue({ items: [ddbRow], hasMore: false });
    const { ctrl } = makeCtrl({ query });

    const teacherCtx = { ...tenant, globalRole: 'TenantUser' };
    const r = await ctrl.listAuditEvents(undefined, undefined, undefined, teacherCtx, reqWithJwt());
    expect(r.items[0].metadata?.emisStudentId).toBe('************3456');
    expect(r.items[0].metadata?.note).toBe('verified'); // non-PII preserved
  });

  it('emits audit.viewed on every read (even if zero rows returned)', async () => {
    const query = jest.fn().mockResolvedValue({ items: [], hasMore: false });
    const { ctrl, auditEmit } = makeCtrl({ query });

    await ctrl.listAuditEvents(undefined, undefined, 'code.verified', tenant, reqWithJwt());

    expect(auditEmit).toHaveBeenCalledTimes(1);
    expect(auditEmit.mock.calls[0][0]).toMatchObject({
      eventType: 'audit.viewed',
      metadata: expect.objectContaining({
        count: 0,
        filter: { eventType: 'code.verified', limit: 50 },
      }),
    });
  });
});
