/**
 * SecurityService unit tests — login-history read path (IA S1.1 review fix).
 *
 * Regression guard for the PR #419 review finding: getLoginHistory queried
 * DynamoDB with Limit before an in-memory sort, and DynamoDB returns sort keys
 * ascending by default — so once a user had more than `limit` login rows the
 * endpoint returned the OLDEST page and new logins/failures never appeared.
 * The fix queries newest-first (ScanIndexForward=false).
 */

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
});
