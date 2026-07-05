/**
 * SecurityService unit tests — login-history read path (IA S1.1 review fix).
 *
 * Regression guard for the PR #419 review finding: getLoginHistory queried
 * DynamoDB with Limit before an in-memory sort, and DynamoDB returns sort keys
 * ascending by default — so once a user had more than `limit` login rows the
 * endpoint returned the OLDEST page and new logins/failures never appeared.
 * The fix queries newest-first (ScanIndexForward=false).
 */

import * as crypto from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { SecurityService } from './security.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';

// Cognito is mocked in jest.setup.js; its send fn is exposed here.
declare const global: any;

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

  it('rejects a cursor scoped to a different tenant with 400', async () => {
    const foreign = Buffer.from(
      JSON.stringify({
        tenantId: 'other-tenant',
        entityKey: 'USER#user-1#LOGIN#2026-07-02T08:00:00.000Z',
      }),
    ).toString('base64');
    await expect(
      service.getLoginHistory(USER_ID, context, 20, foreign),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a cursor scoped to a different user with 400', async () => {
    const foreign = Buffer.from(
      JSON.stringify({
        tenantId: 'tenant-1',
        entityKey: 'USER#someone-else#LOGIN#2026-07-02T08:00:00.000Z',
      }),
    ).toString('base64');
    await expect(
      service.getLoginHistory(USER_ID, context, 20, foreign),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects a structurally-invalid cursor (missing keys) with 400', async () => {
    const bad = Buffer.from(JSON.stringify({ foo: 'bar' })).toString('base64');
    await expect(
      service.getLoginHistory(USER_ID, context, 20, bad),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('SecurityService — registerSession (SR.1: Amplify-login session capture)', () => {
  let service: SecurityService;
  let mockDynamoDBClient: any;

  const USER_ID = 'user-1';
  const EXP = Math.floor(Date.now() / 1000) + 3600;
  // Decodable (unsigned, test-only) JWT carrying an exp claim.
  const JWT =
    'h.' +
    Buffer.from(JSON.stringify({ sub: USER_ID, exp: EXP })).toString('base64') +
    '.s';
  const HASH = crypto.createHash('sha256').update(JWT).digest('hex');
  const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120 Safari/537.36';

  const context: RequestContext = {
    userId: USER_ID,
    username: 'u1',
    tenantId: 'tenant-1',
    email: 'u1@example.com',
    globalRole: 'TenantUser' as GlobalRole,
    jwtToken: JWT,
  };

  beforeEach(() => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      queryGSI: jest.fn(),
      putItem: jest.fn().mockResolvedValue(undefined),
      updateItem: jest.fn().mockResolvedValue(undefined),
    };
    service = new SecurityService(mockDynamoDBClient as DynamoDBClientService);
  });

  afterEach(() => jest.clearAllMocks());

  it('creates a SESSION row from the caller access token + parsed device when none exists', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });

    const dto = await service.registerSession(USER_ID, context, {
      ipAddress: '9.9.9.9',
      userAgent: CHROME_MAC,
    });

    expect(mockDynamoDBClient.queryGSI).toHaveBeenCalledWith(
      expect.anything(),
      'GSI2',
      `TOKEN#${HASH}`,
      undefined,
      'eq',
      'userId = :userId',
      { ':userId': USER_ID },
    );
    expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);

    const row = mockDynamoDBClient.putItem.mock.calls[0][1];
    expect(row).toMatchObject({
      entityType: 'SESSION',
      userId: USER_ID,
      accessTokenHash: HASH,
      refreshTokenHash: '', // Amplify holds the refresh token client-side
      ipAddress: '9.9.9.9',
      status: 'active',
      gsi2pk: `TOKEN#${HASH}`,
    });
    expect(row.deviceInfo).toMatchObject({ deviceType: 'desktop', browser: 'Chrome', os: 'macOS' });
    // access-token expiry read from the JWT exp claim
    expect(new Date(row.accessTokenExpiresAt).getTime()).toBe(EXP * 1000);

    expect(dto).toMatchObject({ isCurrent: true, ipAddress: '9.9.9.9', browser: 'Chrome', os: 'macOS' });
  });

  it('dedups — bumps updatedAt (no new row) when a session already exists for the token', async () => {
    const existing = {
      sessionId: 's-existing',
      userId: USER_ID,
      accessTokenHash: HASH,
      refreshTokenExpiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      createdAt: '2026-07-01T00:00:00.000Z',
      updatedAt: '2026-07-01T00:00:00.000Z',
      deviceInfo: { deviceType: 'desktop', browser: 'Chrome', os: 'macOS' },
    };
    mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [existing] });

    const dto = await service.registerSession(USER_ID, context, {
      ipAddress: '9.9.9.9',
      userAgent: CHROME_MAC,
    });

    expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'SESSION#s-existing',
      'SET updatedAt = :now',
      expect.objectContaining({ ':now': expect.any(String) }),
    );
    expect(dto.sessionId).toBe('s-existing');
    expect(dto.isCurrent).toBe(true); // existing.accessTokenHash === current-token hash
  });

  it('rejects registering another user\'s session (verifyAccess)', async () => {
    await expect(
      service.registerSession('someone-else', context, {}),
    ).rejects.toBeTruthy();
    expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
  });
});

describe('SecurityService — revokeAllSessions (SR.4: sign out everywhere)', () => {
  let service: SecurityService;
  let mockDynamoDBClient: any;

  const USER_ID = 'user-1';
  const context: RequestContext = {
    userId: USER_ID,
    username: 'cognito-user-1',
    tenantId: 'tenant-1',
    email: 'u1@example.com',
    globalRole: 'TenantUser' as GlobalRole,
    jwtToken: 'jwt',
  };
  const activeSession = {
    entityKey: 'SESSION#s1',
    sessionId: 's1',
    userId: USER_ID,
    accessTokenHash: 'other-hash', // not the caller's current session
    status: 'active',
  };

  beforeEach(() => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      query: jest.fn().mockResolvedValue({ items: [activeSession] }),
      updateItem: jest.fn().mockResolvedValue(undefined),
    };
    service = new SecurityService(mockDynamoDBClient as DynamoDBClientService);
    global.__mocks__.cognito.mockReset().mockResolvedValue({});
  });

  afterEach(() => jest.clearAllMocks());

  const globalSignOutCall = () =>
    global.__mocks__.cognito.mock.calls.find(
      (c: any[]) => c[0]?.type === 'AdminUserGlobalSignOutCommand',
    );

  it('global-signs-out at Cognito (with the Cognito username) when revoking ALL sessions', async () => {
    await service.revokeAllSessions(USER_ID, false, context);
    const call = globalSignOutCall();
    expect(call).toBeDefined();
    expect(call[0].params.Username).toBe('cognito-user-1');
    expect(mockDynamoDBClient.updateItem).toHaveBeenCalled(); // DDB rows also flipped to revoked
  });

  it('does NOT global-sign-out when keeping the current session (exceptCurrent=true)', async () => {
    await service.revokeAllSessions(USER_ID, true, context);
    expect(globalSignOutCall()).toBeUndefined();
  });

  it('never fails the revoke when Cognito global sign-out errors (best-effort)', async () => {
    global.__mocks__.cognito.mockReset().mockRejectedValue(new Error('cognito down'));
    await expect(
      service.revokeAllSessions(USER_ID, false, context),
    ).resolves.toMatchObject({ success: true });
  });

  it('does NOT global-sign-out when an admin revokes ANOTHER user (would sign out the admin)', async () => {
    // TenantAdmin acting on a different target: DDB rows are soft-revoked, but
    // AdminUserGlobalSignOut would carry the ADMIN's username and kill the
    // admin's own refresh tokens while leaving the target's alive. Self-only.
    const adminContext: RequestContext = {
      ...context,
      userId: 'admin-1',
      username: 'cognito-admin-1',
      globalRole: 'TenantAdmin' as GlobalRole,
    };
    await service.revokeAllSessions(USER_ID, false, adminContext);
    expect(globalSignOutCall()).toBeUndefined();
    expect(mockDynamoDBClient.updateItem).toHaveBeenCalled(); // target rows still revoked
  });
});
