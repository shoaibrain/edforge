/**
 * SecurityService unit tests — login-history read path (IA S1.1 review fix).
 *
 * Regression guard for the PR #419 review finding: getLoginHistory queried
 * DynamoDB with Limit before an in-memory sort, and DynamoDB returns sort keys
 * ascending by default — so once a user had more than `limit` login rows the
 * endpoint returned the OLDEST page and new logins/failures never appeared.
 * The fix queries newest-first (ScanIndexForward=false).
 */

import { BadRequestException } from '@nestjs/common';
import { SecurityService } from './security.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';

describe('SecurityService — getLoginHistory ordering (S1.1 review fix)', () => {
  let service: SecurityService;
  let mockDynamoDBClient: any;

  const USER_ID = 'user-1';
  const context: RequestContext = {
    userId: USER_ID,
    username: 'u1',
    tenantId: 'tenant-1',
    email: 'u1@example.com',
    globalRole: 'TenantUser' as GlobalRole,
    jwtToken: 'jwt',
  };

  beforeEach(() => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      query: jest.fn(),
    };
    service = new SecurityService(mockDynamoDBClient as DynamoDBClientService);
  });

  afterEach(() => jest.clearAllMocks());

  it('queries newest-first (ScanIndexForward=false) so limit selects the latest rows', async () => {
    mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

    await service.getLoginHistory(USER_ID, context, 20);

    expect(mockDynamoDBClient.query).toHaveBeenCalledWith(
      expect.anything(), // client
      context.tenantId,
      `USER#${USER_ID}#LOGIN#`,
      'entityType = :entityType',
      { ':entityType': 'LOGIN_HISTORY' },
      undefined, // expressionAttributeNames
      20, // limit
      undefined, // exclusiveStartKey
      false, // scanIndexForward → descending (newest-first)
    );
  });

  it('returns the newest attempts first even when the page arrives unordered', async () => {
    // Simulate a full (> would-be-limit) result set delivered in arbitrary
    // order; the reader must surface the newest timestamps at the top.
    mockDynamoDBClient.query.mockResolvedValue({
      items: [
        { timestamp: '2026-07-01T10:00:00.000Z', status: 'success', ipAddress: '1.1.1.1' },
        { timestamp: '2026-07-03T09:00:00.000Z', status: 'failed', ipAddress: '2.2.2.2', failureReason: 'NotAuthorizedException' },
        { timestamp: '2026-07-02T08:00:00.000Z', status: 'success', ipAddress: '3.3.3.3' },
      ],
      hasMore: true,
    });

    const res = await service.getLoginHistory(USER_ID, context, 20);

    expect(res.entries.map((e) => e.timestamp)).toEqual([
      '2026-07-03T09:00:00.000Z',
      '2026-07-02T08:00:00.000Z',
      '2026-07-01T10:00:00.000Z',
    ]);
    expect(res.hasMore).toBe(true);
  });

  // ---- S1.2: cursor pagination ----

  it('emits a nextCursor at the oldest returned row when more pages remain', async () => {
    mockDynamoDBClient.query.mockResolvedValue({
      items: [
        { tenantId: 'tenant-1', entityKey: 'USER#user-1#LOGIN#2026-07-03T09:00:00.000Z', timestamp: '2026-07-03T09:00:00.000Z', status: 'success' },
        { tenantId: 'tenant-1', entityKey: 'USER#user-1#LOGIN#2026-07-02T08:00:00.000Z', timestamp: '2026-07-02T08:00:00.000Z', status: 'success' },
      ],
      hasMore: true,
    });

    const res = await service.getLoginHistory(USER_ID, context, 2);

    expect(res.hasMore).toBe(true);
    expect(res.nextCursor).toBeDefined();
    // The cursor must anchor on the OLDEST returned row (last in newest-first
    // order), not a row that was fetched-then-dropped — otherwise the next page
    // skips an entry.
    const decoded = JSON.parse(Buffer.from(res.nextCursor!, 'base64').toString('utf-8'));
    expect(decoded).toEqual({
      tenantId: 'tenant-1',
      entityKey: 'USER#user-1#LOGIN#2026-07-02T08:00:00.000Z',
    });
  });

  it('omits nextCursor on the last page', async () => {
    mockDynamoDBClient.query.mockResolvedValue({
      items: [
        { tenantId: 'tenant-1', entityKey: 'USER#user-1#LOGIN#2026-07-01T00:00:00.000Z', timestamp: '2026-07-01T00:00:00.000Z', status: 'success' },
      ],
      hasMore: false,
    });

    const res = await service.getLoginHistory(USER_ID, context, 20);

    expect(res.hasMore).toBe(false);
    expect(res.nextCursor).toBeUndefined();
  });

  it('forwards a decoded cursor as the DynamoDB ExclusiveStartKey', async () => {
    mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
    const key = { tenantId: 'tenant-1', entityKey: 'USER#user-1#LOGIN#2026-07-02T08:00:00.000Z' };
    const cursor = Buffer.from(JSON.stringify(key)).toString('base64');

    await service.getLoginHistory(USER_ID, context, 20, cursor);

    expect(mockDynamoDBClient.query).toHaveBeenCalledWith(
      expect.anything(),
      context.tenantId,
      `USER#${USER_ID}#LOGIN#`,
      'entityType = :entityType',
      { ':entityType': 'LOGIN_HISTORY' },
      undefined,
      20,
      key, // decoded cursor → exclusiveStartKey
      false,
    );
  });

  it('rejects a malformed cursor with 400', async () => {
    const badCursor = Buffer.from('this is not json', 'utf8').toString('base64');
    await expect(
      service.getLoginHistory(USER_ID, context, 20, badCursor),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
