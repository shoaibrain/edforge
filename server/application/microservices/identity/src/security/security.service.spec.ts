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
  const NOW_S = Math.floor(Date.now() / 1000);
  const EXP = NOW_S + 3600;
  const mkJwt = (claims: Record<string, unknown>) =>
    'h.' + Buffer.from(JSON.stringify(claims)).toString('base64') + '.s';
  const ORIGIN_JTI = 'ojti-family-1';
  // Genuine login. The refreshed token shares origin_jti (stable across a refresh
  // family) but has a later iat — an IMMEDIATE forced refresh (iat = auth_time+30)
  // that the old iat/auth_time heuristic would have mis-read as a fresh login.
  const JWT = mkJwt({ sub: USER_ID, exp: EXP, iat: NOW_S, auth_time: NOW_S, origin_jti: ORIGIN_JTI });
  const REFRESH_JWT = mkJwt({ sub: USER_ID, exp: EXP, iat: NOW_S + 30, auth_time: NOW_S, origin_jti: ORIGIN_JTI });
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
      getSystemClient: jest.fn().mockReturnValue({ send: jest.fn() }),
      queryGSI: jest.fn(),
      // recordLoginEvent scans recent login-history to find a trigger row.
      query: jest.fn().mockResolvedValue({ items: [] }),
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

  it('refreshes user.lastLoginAt/lastLoginIp on a new login (fixes the empty "Last active" column)', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });

    await service.registerSession(USER_ID, context, { ipAddress: '9.9.9.9', userAgent: CHROME_MAC });

    expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      `USER#${USER_ID}`,
      'SET lastLoginAt = :now, updatedAt = :now, lastLoginIp = :ip',
      expect.objectContaining({ ':ip': '9.9.9.9', ':now': expect.any(String) }),
    );
  });

  it('P3: omits lastLoginIp from the update when no IP is available (never erases a prior IP)', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });

    await service.registerSession(USER_ID, context, { userAgent: CHROME_MAC }); // no ipAddress

    const userUpdate = mockDynamoDBClient.updateItem.mock.calls.find(
      (c: any[]) => c[2] === `USER#${USER_ID}`,
    );
    expect(userUpdate[3]).toBe('SET lastLoginAt = :now, updatedAt = :now');
    expect(userUpdate[4]).not.toHaveProperty(':ip');
  });

  it('writes a device-rich login-history row when no trigger row exists to enrich (fallback)', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
    mockDynamoDBClient.query.mockResolvedValue({ items: [] }); // no trigger row

    await service.registerSession(USER_ID, context, { ipAddress: '9.9.9.9', userAgent: CHROME_MAC });

    // Session row + LOGIN_SEEN marker + fallback history row. Assert the history row.
    const history = mockDynamoDBClient.putItem.mock.calls
      .map((c: any[]) => c[1])
      .find((i: any) => i.entityType === 'LOGIN_HISTORY');
    expect(history).toMatchObject({
      entityType: 'LOGIN_HISTORY',
      userId: USER_ID,
      status: 'success',
      source: 'session-register',
      ipAddress: '9.9.9.9',
      browser: 'Chrome',
      os: 'macOS',
      originJti: ORIGIN_JTI,
    });
    expect(history.entityKey).toMatch(new RegExp(`^USER#${USER_ID}#LOGIN#`));
    expect(typeof history.ttl).toBe('number'); // self-prunes
  });

  it('ENRICHES the canonical Cognito trigger row instead of writing a second row', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
    const triggerKey = `USER#${USER_ID}#LOGIN#${new Date(NOW_S * 1000).toISOString()}`;
    mockDynamoDBClient.query.mockResolvedValue({
      items: [
        {
          tenantId: 'tenant-1',
          entityKey: triggerKey,
          entityType: 'LOGIN_HISTORY',
          userId: USER_ID,
          timestamp: new Date(NOW_S * 1000).toISOString(),
          status: 'success',
          source: 'cognito-post-auth-trigger', // device-less
        },
      ],
    });

    await service.registerSession(USER_ID, context, { ipAddress: '9.9.9.9', userAgent: CHROME_MAC });

    // No LOGIN_HISTORY row is written — the trigger row is enriched in place.
    const historyPuts = mockDynamoDBClient.putItem.mock.calls
      .map((c: any[]) => c[1])
      .filter((i: any) => i.entityType === 'LOGIN_HISTORY');
    expect(historyPuts).toHaveLength(0);
    const enrich = mockDynamoDBClient.updateItem.mock.calls.find(
      (c: any[]) => c[2] === triggerKey,
    );
    expect(enrich).toBeTruthy();
    expect(enrich[3]).toContain('ipAddress = :ip');
    expect(enrich[3]).toContain('browser = :b');
    expect(enrich[4]).toMatchObject({ ':ip': '9.9.9.9', ':b': 'Chrome' });
  });

  it('P1: an immediate forced refresh (iat = auth_time+30, same origin_jti) records NO new login', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
    // Idempotency marker for this origin_jti already exists → the conditional
    // put fails, so recordLoginEvent short-circuits.
    mockDynamoDBClient.putItem.mockImplementation((_c: any, item: any) => {
      if (item?.entityType === 'LOGIN_SEEN') {
        const e: any = new Error('exists');
        e.name = 'ConditionalCheckFailedException';
        return Promise.reject(e);
      }
      return Promise.resolve(undefined);
    });

    const dto = await service.registerSession(
      USER_ID,
      { ...context, jwtToken: REFRESH_JWT },
      { ipAddress: '9.9.9.9', userAgent: CHROME_MAC },
    );

    expect(dto.isCurrent).toBe(true); // session still created
    // No history row written, no login row enriched, and the scan never runs.
    expect(mockDynamoDBClient.query).not.toHaveBeenCalled();
    const historyPuts = mockDynamoDBClient.putItem.mock.calls
      .map((c: any[]) => c[1])
      .filter((i: any) => i.entityType === 'LOGIN_HISTORY');
    expect(historyPuts).toHaveLength(0);
    const loginRowWrite = mockDynamoDBClient.updateItem.mock.calls.find(
      (c: any[]) => typeof c[2] === 'string' && c[2].includes('#LOGIN#'),
    );
    expect(loginRowWrite).toBeUndefined();
  });

  it('never fails registration when the best-effort login-event write throws', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
    mockDynamoDBClient.query.mockRejectedValue(new Error('ddb down')); // history read fails

    const dto = await service.registerSession(USER_ID, context, {
      ipAddress: '9.9.9.9',
      userAgent: CHROME_MAC,
    });

    expect(dto).toMatchObject({ isCurrent: true }); // session still returned
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

    // Reload path writes NO login-history row (would spam history on every
    // app open) but still refreshes the user's last-active marker.
    expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      'SESSION#s-existing',
      'SET updatedAt = :now',
      expect.objectContaining({ ':now': expect.any(String) }),
    );
    expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
      expect.anything(),
      'tenant-1',
      `USER#${USER_ID}`,
      'SET lastLoginAt = :now, updatedAt = :now, lastLoginIp = :ip',
      expect.objectContaining({ ':ip': '9.9.9.9', ':now': expect.any(String) }),
    );
    expect(dto.sessionId).toBe('s-existing');
    expect(dto.isCurrent).toBe(true); // existing.accessTokenHash === current-token hash
  });

  it('rejects registering another user\'s session — strictly self-only (P1b)', async () => {
    await expect(
      service.registerSession('someone-else', context, {}),
    ).rejects.toBeTruthy();
    expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
  });

  it('rejects even a TenantAdmin registering a session for another user (P1b)', async () => {
    // verifyAccess would permit a TenantAdmin here; registration is self-only
    // because it binds the CALLER's token to the row.
    const adminContext: RequestContext = {
      ...context,
      globalRole: 'TenantAdmin' as GlobalRole,
    };
    await expect(
      service.registerSession('someone-else', adminContext, {}),
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

describe('SecurityService — touchSession (SR.3: heartbeat / token-rotation rebind)', () => {
  let service: SecurityService;
  let mockDynamoDBClient: any;

  const USER_ID = 'user-1';
  const SESSION_ID = 's-1';
  const EXP = Math.floor(Date.now() / 1000) + 3600;
  const JWT =
    'h.' +
    Buffer.from(JSON.stringify({ sub: USER_ID, exp: EXP })).toString('base64') +
    '.s';
  const HASH = crypto.createHash('sha256').update(JWT).digest('hex');

  const context: RequestContext = {
    userId: USER_ID,
    username: 'u1',
    tenantId: 'tenant-1',
    email: 'u1@example.com',
    globalRole: 'TenantUser' as GlobalRole,
    jwtToken: JWT,
  };

  const sessionRow = (over: any = {}) => ({
    entityKey: `SESSION#${SESSION_ID}`,
    sessionId: SESSION_ID,
    userId: USER_ID,
    accessTokenHash: 'old-hash', // rotated away from the caller's current token
    status: 'active',
    ...over,
  });

  beforeEach(() => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      getItem: jest.fn().mockResolvedValue(sessionRow()),
      updateItem: jest.fn().mockResolvedValue(undefined),
    };
    service = new SecurityService(mockDynamoDBClient as DynamoDBClientService);
  });

  afterEach(() => jest.clearAllMocks());

  it('rebinds the row to the caller CURRENT access token (new hash + GSI2) and marks it current', async () => {
    const dto = await service.touchSession(USER_ID, SESSION_ID, context);

    expect(mockDynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
    const [, , , updateExpr, values, , names] =
      mockDynamoDBClient.updateItem.mock.calls[0];
    expect(updateExpr).toContain('accessTokenHash = :hash');
    expect(values[':hash']).toBe(HASH); // hash of the caller's CURRENT token
    expect(values[':gsi2pk']).toBe(`TOKEN#${HASH}`);
    expect(names).toEqual({ '#ttl': 'ttl' }); // ttl is a DDB reserved word
    expect(dto.sessionId).toBe(SESSION_ID);
    expect(dto.isCurrent).toBe(true);
  });

  it('404s a session that does not exist', async () => {
    mockDynamoDBClient.getItem.mockResolvedValue(null);
    await expect(
      service.touchSession(USER_ID, SESSION_ID, context),
    ).rejects.toMatchObject({ status: 404 });
    expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
  });

  it('403s a session owned by another user', async () => {
    mockDynamoDBClient.getItem.mockResolvedValue(sessionRow({ userId: 'someone-else' }));
    await expect(
      service.touchSession(USER_ID, SESSION_ID, context),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
  });

  it('403s even a TenantAdmin touching another user\'s session — self-only, no read (P1b)', async () => {
    const adminContext: RequestContext = {
      ...context,
      userId: 'admin-1',
      globalRole: 'TenantAdmin' as GlobalRole,
    };
    await expect(
      service.touchSession(USER_ID, SESSION_ID, adminContext),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockDynamoDBClient.getItem).not.toHaveBeenCalled(); // rejected before any read
    expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
  });

  it('refuses to resurrect a revoked session (403, no write)', async () => {
    mockDynamoDBClient.getItem.mockResolvedValue(sessionRow({ status: 'revoked' }));
    await expect(
      service.touchSession(USER_ID, SESSION_ID, context),
    ).rejects.toMatchObject({ status: 403 });
    expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
  });
});

describe('SecurityService — recordLoginEvent (enrich canonical trigger row)', () => {
  let service: SecurityService;
  let mockDynamoDBClient: any;

  const USER_ID = 'user-1';
  const CHROME_MAC =
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/537.36 Chrome/120 Safari/537.36';
  const anchor = Date.parse('2026-07-12T10:00:00.000Z');

  const triggerRow = (ts: string, extra: Record<string, unknown> = {}) => ({
    tenantId: 'tenant-1',
    entityKey: `USER#${USER_ID}#LOGIN#${ts}`,
    entityType: 'LOGIN_HISTORY',
    userId: USER_ID,
    timestamp: ts,
    status: 'success',
    source: 'cognito-post-auth-trigger',
    ...extra,
  });

  beforeEach(() => {
    mockDynamoDBClient = {
      getSystemClient: jest.fn().mockReturnValue({ send: jest.fn() }),
      query: jest.fn().mockResolvedValue({ items: [] }),
      updateItem: jest.fn().mockResolvedValue(undefined),
      putItem: jest.fn().mockResolvedValue(undefined),
    };
    service = new SecurityService(mockDynamoDBClient as DynamoDBClientService);
  });

  afterEach(() => jest.clearAllMocks());

  it('reads strongly-consistent (ConsistentRead=true) so a just-written row is never missed', async () => {
    await service.recordLoginEvent('tenant-1', USER_ID, { ipAddress: '9.9.9.9', userAgent: CHROME_MAC, anchorMs: anchor });
    // query()'s 10th positional arg is consistentRead.
    expect(mockDynamoDBClient.query.mock.calls[0][9]).toBe(true);
  });

  // History rows written via putItem (excludes the LOGIN_SEEN idempotency marker).
  const historyPuts = () =>
    mockDynamoDBClient.putItem.mock.calls
      .map((c: any[]) => c[1])
      .filter((i: any) => i.entityType === 'LOGIN_HISTORY');
  // Make the origin_jti marker claim fail (simulates "already recorded").
  const markerAlreadyClaimed = () =>
    mockDynamoDBClient.putItem.mockImplementation((_c: any, item: any) => {
      if (item?.entityType === 'LOGIN_SEEN') {
        const e: any = new Error('exists');
        e.name = 'ConditionalCheckFailedException';
        return Promise.reject(e);
      }
      return Promise.resolve(undefined);
    });

  it('claims an origin_jti marker via conditional put before recording', async () => {
    await service.recordLoginEvent('tenant-1', USER_ID, { ipAddress: '9.9.9.9', userAgent: CHROME_MAC, anchorMs: anchor, originJti: 'oj-1' });
    const [, marker, cond] = mockDynamoDBClient.putItem.mock.calls[0];
    expect(marker).toMatchObject({ entityType: 'LOGIN_SEEN', entityKey: `USER#${USER_ID}#LOGINSEEN#oj-1` });
    expect(cond).toBe('attribute_not_exists(entityKey)');
  });

  it('enriches the closest device-less trigger row in place (no history row) + tags origin_jti', async () => {
    const closeKey = `USER#${USER_ID}#LOGIN#2026-07-12T10:00:02.000Z`;
    mockDynamoDBClient.query.mockResolvedValue({
      items: [
        triggerRow('2026-07-12T10:05:00.000Z'), // 5 min away — outside window
        triggerRow('2026-07-12T10:00:02.000Z'), // 2 s away — the match
      ],
    });

    await service.recordLoginEvent('tenant-1', USER_ID, {
      ipAddress: '9.9.9.9', userAgent: CHROME_MAC, anchorMs: anchor, originJti: 'oj-1', source: 'session-register',
    });

    expect(historyPuts()).toHaveLength(0); // enriched, not written
    expect(mockDynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
    const [, tid, key, expr, values] = mockDynamoDBClient.updateItem.mock.calls[0];
    expect(tid).toBe('tenant-1');
    expect(key).toBe(closeKey);
    expect(expr).toContain('ipAddress = :ip');
    expect(expr).toContain('browser = :b');
    expect(expr).toContain('originJti = :oj');
    expect(values).toMatchObject({ ':ip': '9.9.9.9', ':b': 'Chrome', ':src': 'session-register', ':oj': 'oj-1' });
  });

  it('P1/P2: a re-claimed origin_jti (refresh) is a complete no-op — no scan, enrich, or row', async () => {
    markerAlreadyClaimed();

    await service.recordLoginEvent('tenant-1', USER_ID, {
      ipAddress: '9.9.9.9', userAgent: CHROME_MAC, anchorMs: anchor, originJti: 'oj-1',
    });

    expect(mockDynamoDBClient.query).not.toHaveBeenCalled(); // short-circuits before the scan
    expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    expect(historyPuts()).toHaveLength(0);
  });

  it('P2: an already-enriched trigger row is a no-op, NOT a duplicate fallback row', async () => {
    // No origin_jti (edge token). The already-enriched trigger must short-circuit
    // the target match, and without a key we never write a fallback.
    mockDynamoDBClient.query.mockResolvedValue({
      items: [triggerRow('2026-07-12T10:00:01.000Z', { ipAddress: '1.1.1.1', browser: 'Safari' })],
    });

    await service.recordLoginEvent('tenant-1', USER_ID, { ipAddress: '9.9.9.9', userAgent: CHROME_MAC, anchorMs: anchor });

    expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    expect(historyPuts()).toHaveLength(0); // no fallback duplicate
  });

  it('Finding-2: an origin_jti-less token with no trigger row writes NOTHING (no phantom login on refresh)', async () => {
    mockDynamoDBClient.query.mockResolvedValue({ items: [] }); // no trigger row at all

    await service.recordLoginEvent('tenant-1', USER_ID, { ipAddress: '9.9.9.9', userAgent: CHROME_MAC, anchorMs: anchor });

    expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    expect(historyPuts()).toHaveLength(0); // no un-keyable row → refresh can't fabricate logins
  });

  it('writes a standalone device-rich row (tagged origin_jti) when no trigger row is in range', async () => {
    mockDynamoDBClient.query.mockResolvedValue({
      items: [triggerRow('2026-07-12T10:30:00.000Z')], // 30 min away — outside window
    });

    await service.recordLoginEvent('tenant-1', USER_ID, {
      ipAddress: '9.9.9.9', userAgent: CHROME_MAC, anchorMs: anchor, originJti: 'oj-1', source: 'auth-login',
    });

    expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    const rows = historyPuts();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      entityType: 'LOGIN_HISTORY', status: 'success', source: 'auth-login', browser: 'Chrome', originJti: 'oj-1',
    });
  });
});

describe('SecurityService — getLoginHistory returns rows verbatim (no read-time dedupe)', () => {
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

  it('maps every row 1:1 (pagination-safe — the read path no longer merges rows)', async () => {
    // Two enriched login rows + one older device-less row: all three surface,
    // in newest-first order, with no cross-row merging that could straddle pages.
    mockDynamoDBClient.query.mockResolvedValue({
      items: [
        { tenantId: 'tenant-1', entityKey: `USER#${USER_ID}#LOGIN#c`, timestamp: '2026-07-12T10:02:00.000Z', status: 'success', browser: 'Chrome' },
        { tenantId: 'tenant-1', entityKey: `USER#${USER_ID}#LOGIN#b`, timestamp: '2026-07-12T10:01:00.000Z', status: 'success', browser: 'Safari' },
        { tenantId: 'tenant-1', entityKey: `USER#${USER_ID}#LOGIN#a`, timestamp: '2026-07-12T10:00:00.000Z', status: 'success' },
      ],
      hasMore: false,
    });

    const res = await service.getLoginHistory(USER_ID, context, 20);

    expect(res.entries).toHaveLength(3);
    expect(res.entries.map(e => e.browser)).toEqual(['Chrome', 'Safari', undefined]);
  });
});
