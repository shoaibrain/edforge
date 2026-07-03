/**
 * SecurityService.getLoginHistory — cursor pagination (Sprint IA-1, S1.2).
 *
 * Verifies newest-first ordering via DynamoDB (ScanIndexForward=false, no
 * in-memory re-sort), opaque base64 cursor round-trip, nextCursor exposure,
 * and that verifyAccess still gates the read.
 */

import { Test } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SecurityService } from './security.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import type { RequestContext } from '../common/entities/base.entity';

const TENANT_ID = '21aea5da-511f-4dfa-a6f2-6971f63a719f';
const USER_ID = 'user-1';

const ownerContext: RequestContext = {
  userId: USER_ID,
  tenantId: TENANT_ID,
  email: 'u@example.com',
  globalRole: 'TenantUser' as any,
  jwtToken: 'jwt',
};

function entry(ts: string, status: 'success' | 'failed' = 'success') {
  return {
    tenantId: TENANT_ID,
    entityKey: `USER#${USER_ID}#LOGIN#${ts}`,
    entityType: 'LOGIN_HISTORY',
    userId: USER_ID,
    timestamp: ts,
    status,
  };
}

// query() positional args: (client, tenantId, skPrefix, filterExpr,
// exprValues, exprNames, limit, exclusiveStartKey, scanIndexForward)
const LIMIT_ARG = 6;
const START_KEY_ARG = 7;
const SCAN_FORWARD_ARG = 8;

describe('SecurityService.getLoginHistory — cursor pagination (S1.2)', () => {
  let service: SecurityService;
  let dynamo: { getClient: jest.Mock; query: jest.Mock };

  beforeEach(async () => {
    dynamo = {
      getClient: jest.fn().mockResolvedValue({}),
      query: jest.fn(),
    };
    const mod = await Test.createTestingModule({
      providers: [SecurityService, { provide: DynamoDBClientService, useValue: dynamo }],
    }).compile();
    service = mod.get(SecurityService);
  });

  it('queries newest-first (ScanIndexForward=false) and returns nextCursor when more pages exist', async () => {
    const page = Array.from({ length: 20 }, (_, i) =>
      entry(`2026-07-03T00:00:${String(i).padStart(2, '0')}Z`),
    );
    dynamo.query.mockResolvedValue({ items: page, hasMore: true, lastEvaluatedKey: 'CURSOR_B64' });

    const res = await service.getLoginHistory(USER_ID, ownerContext, 20);

    expect(res.entries).toHaveLength(20);
    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBe('CURSOR_B64');

    const args = dynamo.query.mock.calls[0];
    expect(args[LIMIT_ARG]).toBe(20);
    expect(args[START_KEY_ARG]).toBeUndefined();
    expect(args[SCAN_FORWARD_ARG]).toBe(false);
  });

  it('decodes the base64 cursor into exclusiveStartKey on the next page', async () => {
    const startKey = { entityKey: `USER#${USER_ID}#LOGIN#2026-07-03T00:00:05Z`, tenantId: TENANT_ID };
    const cursor = Buffer.from(JSON.stringify(startKey)).toString('base64');
    dynamo.query.mockResolvedValue({ items: [entry('2026-07-03T00:00:04Z')], hasMore: false, lastEvaluatedKey: undefined });

    const res = await service.getLoginHistory(USER_ID, ownerContext, 20, cursor);

    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeUndefined();

    const args = dynamo.query.mock.calls[0];
    expect(args[START_KEY_ARG]).toEqual(startKey);
    expect(args[SCAN_FORWARD_ARG]).toBe(false);
  });

  it('preserves DB newest-first order (no in-memory re-sort)', async () => {
    const newest = entry('2026-07-03T09:00:00Z');
    const older = entry('2026-07-03T08:00:00Z');
    dynamo.query.mockResolvedValue({ items: [newest, older], hasMore: false });

    const res = await service.getLoginHistory(USER_ID, ownerContext, 20);

    expect(res.entries.map((e) => e.timestamp)).toEqual([newest.timestamp, older.timestamp]);
  });

  it('denies a non-owner, non-admin caller before querying (verifyAccess)', async () => {
    const otherUser: RequestContext = { ...ownerContext, userId: 'someone-else' };

    await expect(service.getLoginHistory(USER_ID, otherUser, 20)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(dynamo.query).not.toHaveBeenCalled();
  });
});
