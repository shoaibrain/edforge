import { IemisAuditLogger } from './iemis-audit-logger.service';
import { DynamoDBClientService } from './dynamodb-client.service';
import { buildIemisAuditEntityKey } from '@aibrains/shared-types';

function fakeDdb(fail = false): DynamoDBClientService {
  return {
    getClient: jest.fn(async () => ({} as any)),
    putItem: jest.fn(async (_c, _item) => {
      if (fail) throw new Error('simulated DDB failure');
    }),
  } as unknown as DynamoDBClientService;
}

const validPayload = {
  eventType: 'code.verified' as const,
  tenantId: 'tenant-a',
  schoolId: 'school-1',
  actorUserId: 'u-admin',
  metadata: { code: '12345678' },
};

describe('IemisAuditLogger.emit', () => {
  it('persists a well-formed event and returns it with eventId + timestamp', async () => {
    const ddb = fakeDdb();
    const logger = new IemisAuditLogger(ddb);

    const result = await logger.emit(validPayload, 'jwt-token');

    expect(result).not.toBeNull();
    expect(result!.eventId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    expect(result!.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(result!.eventType).toBe('code.verified');
    expect(result!.tenantId).toBe('tenant-a');
  });

  it('writes the DDB row with the IEMIS audit entityKey prefix', async () => {
    const ddb = fakeDdb();
    const logger = new IemisAuditLogger(ddb);

    const event = await logger.emit(validPayload, 'jwt');
    const putCall = (ddb.putItem as jest.Mock).mock.calls[0];
    const persistedItem = putCall[1];

    expect(persistedItem.entityKey).toBe(
      buildIemisAuditEntityKey(event!.timestamp, event!.eventId),
    );
    expect(persistedItem.entityType).toBe('IEMIS_AUDIT_EVENT');
    expect(persistedItem.tenantId).toBe('tenant-a');
  });

  it('acquires a tenant-scoped client for every emit', async () => {
    const ddb = fakeDdb();
    const logger = new IemisAuditLogger(ddb);
    await logger.emit(validPayload, 'jwt');
    expect((ddb.getClient as jest.Mock).mock.calls[0]).toEqual(['tenant-a', 'jwt']);
  });

  it('returns null (fail-open) when DDB putItem throws', async () => {
    const ddb = fakeDdb(true);
    const logger = new IemisAuditLogger(ddb);

    const result = await logger.emit(validPayload, 'jwt');
    expect(result).toBeNull();
  });

  it('does not throw when DDB fails — the caller must be able to continue', async () => {
    const ddb = fakeDdb(true);
    const logger = new IemisAuditLogger(ddb);

    await expect(logger.emit(validPayload, 'jwt')).resolves.toBeNull();
  });

  it('logs a structured "iemis.audit.emit_failure" line on DDB failure (for CloudWatch metric filter)', async () => {
    const ddb = fakeDdb(true);
    const logger = new IemisAuditLogger(ddb);
    const errorSpy = jest.spyOn((logger as any).logger, 'error');

    await logger.emit(validPayload, 'jwt');

    const errCall = errorSpy.mock.calls.find((c) =>
      String(c[0]).includes('iemis.audit.emit_failure'),
    );
    expect(errCall).toBeDefined();
    expect(String(errCall![0])).toContain('type=code.verified');
    expect(String(errCall![0])).toContain('tenant=tenant-a');
  });

  it('returns null when payload is malformed (e.g. missing actorUserId)', async () => {
    const ddb = fakeDdb();
    const logger = new IemisAuditLogger(ddb);

    // @ts-expect-error — deliberately constructing an invalid payload
    const result = await logger.emit({ eventType: 'code.verified', tenantId: 'tenant-a' }, 'jwt');

    expect(result).toBeNull();
    expect((ddb.putItem as jest.Mock)).not.toHaveBeenCalled();
  });

  it('allows cross-tenant platform events (no schoolId)', async () => {
    const ddb = fakeDdb();
    const logger = new IemisAuditLogger(ddb);

    const platformEvent = {
      eventType: 'template.uploaded' as const,
      tenantId: 'platform',
      actorUserId: 'u-ops',
      metadata: { templateId: 'tpl-1', version: 'IEMIS-2081' },
    };
    const result = await logger.emit(platformEvent, 'jwt');
    expect(result).not.toBeNull();
    expect(result!.eventType).toBe('template.uploaded');
  });
});
