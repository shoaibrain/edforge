import { ForbiddenException } from '@nestjs/common';
import { DynamoDBClientService } from './dynamodb-client.service';

/**
 * R1.1 / AUD.3 — cross-tenant `AccessDeniedException` (500) → `403
 * CROSS_TENANT_FORBIDDEN`. The per-tenant ABAC client denies at the IAM layer
 * when a session touches another tenant's partition; that must read as a 403,
 * not a server fault. Only `AccessDeniedException` is remapped — every other
 * error (incl. `ConditionalCheckFailedException`) propagates unchanged.
 */
const accessDenied = Object.assign(new Error('User is not authorized to perform: dynamodb:GetItem'), {
  name: 'AccessDeniedException',
});
const conditionalFailed = Object.assign(new Error('The conditional request failed'), {
  name: 'ConditionalCheckFailedException',
});
const genericError = Object.assign(new Error('kaboom'), { name: 'ResourceNotFoundException' });

const clientThatThrows = (err: unknown) => ({ send: jest.fn().mockRejectedValue(err) }) as any;
const clientThatResolves = (value: unknown) => ({ send: jest.fn().mockResolvedValue(value) }) as any;

describe('DynamoDBClientService — cross-tenant AccessDenied → 403 (R1.1/AUD.3)', () => {
  const svc = new DynamoDBClientService();

  // Every op that runs through the per-tenant ABAC client.
  const ops: Array<[string, (client: any) => Promise<unknown>]> = [
    ['getItem', (c) => svc.getItem(c, 'tenant-b', 'USER#1')],
    ['query', (c) => svc.query(c, 'tenant-b', 'USER#')],
    ['queryGSI', (c) => svc.queryGSI(c, 'gsi1', 'pk-value')],
    ['putItem', (c) => svc.putItem(c, { tenantId: 'tenant-b', entityKey: 'USER#1' })],
    ['updateItem', (c) => svc.updateItem(c, 'tenant-b', 'USER#1', 'SET #x = :x', { ':x': 1 })],
    ['deleteItem', (c) => svc.deleteItem(c, 'tenant-b', 'USER#1')],
    ['batchGetItems', (c) => svc.batchGetItems(c, [{ tenantId: 'tenant-b', entityKey: 'USER#1' }])],
    ['batchWriteItems', (c) => svc.batchWriteItems(c, [{ PutRequest: { Item: { tenantId: 'tenant-b', entityKey: 'USER#1' } } }])],
  ];

  describe.each(ops)('%s', (_name, invoke) => {
    it('remaps AccessDeniedException → ForbiddenException with CROSS_TENANT_FORBIDDEN', async () => {
      const err = await invoke(clientThatThrows(accessDenied)).then(
        () => { throw new Error('should have thrown'); },
        (e) => e,
      );
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as ForbiddenException).getResponse()).toMatchObject({ errorCode: 'CROSS_TENANT_FORBIDDEN' });
    });

    it('passes ConditionalCheckFailedException through unchanged', async () => {
      await expect(invoke(clientThatThrows(conditionalFailed))).rejects.toBe(conditionalFailed);
    });

    it('passes other errors through unchanged', async () => {
      await expect(invoke(clientThatThrows(genericError))).rejects.toBe(genericError);
    });
  });

  it('returns the item on the happy path (wrapper is transparent on success)', async () => {
    const client = clientThatResolves({ Item: { tenantId: 'tenant-a', entityKey: 'USER#1', name: 'ok' } });
    await expect(svc.getItem(client, 'tenant-a', 'USER#1')).resolves.toMatchObject({ name: 'ok' });
  });

  it('surfaces the requested tenantId under details (GlobalExceptionFilter propagates details)', async () => {
    const err = await svc.getItem(clientThatThrows(accessDenied), 'tenant-b', 'USER#1').catch((e) => e);
    expect((err as ForbiddenException).getResponse()).toMatchObject({
      errorCode: 'CROSS_TENANT_FORBIDDEN',
      details: { requestedTenantId: 'tenant-b' },
    });
  });
});
