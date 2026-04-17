/**
 * S1.T8/T9/T10 — handler integration tests with fixture APIGW events.
 */

const ddbSend = jest.fn();
const s3Send = jest.fn();
const presignMock = jest.fn().mockResolvedValue('https://signed.example.com/url');

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => ddbSend(...args),
    })),
  };
});
jest.mock('@aws-sdk/client-s3', () => {
  const actual = jest.requireActual('@aws-sdk/client-s3');
  return {
    ...actual,
    S3Client: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => s3Send(...args),
    })),
  };
});
jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: (...args: unknown[]) => presignMock(...args),
}));

import type { APIGatewayProxyEvent } from 'aws-lambda';

function makeJwt(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${body}.sig`;
}

function evt(
  method: string,
  path: string,
  claims: Record<string, unknown>,
  qs: Record<string, string> = {},
): APIGatewayProxyEvent {
  return {
    httpMethod: method,
    path,
    headers: { Authorization: `Bearer ${makeJwt(claims)}` },
    queryStringParameters: qs,
    pathParameters: null,
    body: null,
    isBase64Encoded: false,
    multiValueHeaders: {},
    multiValueQueryStringParameters: null,
    stageVariables: null,
    requestContext: {} as any,
    resource: '',
  };
}

const tenantAdminA = {
  sub: 'user-a',
  'custom:tenantId': 'tenant-A',
  email: 'a@example.com',
  'custom:userRole': 'TenantAdmin',
  'custom:tenantTier': 'BASIC',
};

beforeEach(() => {
  ddbSend.mockReset();
  s3Send.mockReset().mockResolvedValue({});
  presignMock.mockClear();
  process.env.ANALYTICS_TABLE_NAME = 'edforge-analytics';
  process.env.USER_SESSION_EVENTS_TABLE_NAME = 'edforge-user-session-events';
  process.env.EXPORT_BUCKET_NAME = 'edforge-analytics-exports';
  process.env.SYSTEM_ADMIN_EMAILS = 'sysadmin@example.com';
});

function freshHandler(): typeof import('./handler').handler {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./handler').handler;
}

describe('handler — Sprint 1', () => {
  describe('authz boundaries', () => {
    it('TenantAdmin of tenant-B → 403 on tenant-A series', async () => {
      const handler = freshHandler();
      const r = await handler(
        evt('GET', '/analytics/tenants/tenant-A',
          { ...tenantAdminA, 'custom:tenantId': 'tenant-B', email: 'b@x.com' },
          { from: '2026-04-01', to: '2026-04-14', granularity: 'day' }),
      );
      expect(r.statusCode).toBe(403);
    });

    it('own-tenant → 200', async () => {
      ddbSend.mockResolvedValue({ Items: [] });
      const handler = freshHandler();
      const r = await handler(
        evt('GET', '/analytics/tenants/tenant-A', tenantAdminA,
          { from: '2026-04-01', to: '2026-04-14', granularity: 'day' }),
      );
      expect(r.statusCode).toBe(200);
      expect(JSON.parse(r.body)).toEqual([]);
    });

    it('TenantAdmin → 403 on /analytics/fleet', async () => {
      const handler = freshHandler();
      const r = await handler(
        evt('GET', '/analytics/fleet', tenantAdminA,
          { from: '2026-04-01', to: '2026-04-14' }),
      );
      expect(r.statusCode).toBe(403);
    });

    it('SystemAdmin → 200 on /analytics/fleet', async () => {
      ddbSend.mockResolvedValue({ Items: [] });
      const handler = freshHandler();
      const r = await handler(
        evt('GET', '/analytics/fleet',
          { ...tenantAdminA, email: 'sysadmin@example.com' },
          { from: '2026-04-01', to: '2026-04-14' }),
      );
      expect(r.statusCode).toBe(200);
    });

    it('missing Authorization → 401', async () => {
      const handler = freshHandler();
      const event: APIGatewayProxyEvent = {
        ...evt('GET', '/analytics/fleet', tenantAdminA, { from: '2026-04-01', to: '2026-04-14' }),
        headers: {},
      };
      const r = await handler(event);
      expect(r.statusCode).toBe(401);
    });
  });

  describe('validation', () => {
    it('400 on missing from', async () => {
      const handler = freshHandler();
      const r = await handler(
        evt('GET', '/analytics/tenants/tenant-A', tenantAdminA, { to: '2026-04-14', granularity: 'day' }),
      );
      expect(r.statusCode).toBe(400);
    });
    it('400 on bad granularity', async () => {
      const handler = freshHandler();
      const r = await handler(
        evt('GET', '/analytics/tenants/tenant-A', tenantAdminA, { from: '2026-04-01', to: '2026-04-14', granularity: 'hour' }),
      );
      expect(r.statusCode).toBe(400);
    });
    it('400 on bad week format for adoption-report', async () => {
      const handler = freshHandler();
      const r = await handler(
        evt('GET', '/analytics/tenants/tenant-A/adoption-report', tenantAdminA, { week: '2026-04-14' }),
      );
      expect(r.statusCode).toBe(400);
    });
  });

  describe('routing', () => {
    it('unknown path → 404', async () => {
      const handler = freshHandler();
      const r = await handler(evt('GET', '/something/unknown', tenantAdminA));
      expect(r.statusCode).toBe(404);
    });
    it('OPTIONS preflight → 204 with CORS headers', async () => {
      const handler = freshHandler();
      const event = evt('OPTIONS', '/analytics/fleet', tenantAdminA);
      // OPTIONS bypasses auth check
      const e2: APIGatewayProxyEvent = { ...event, headers: {} };
      const r = await handler(e2);
      expect(r.statusCode).toBe(204);
      expect(r.headers?.['Access-Control-Allow-Methods']).toBe('GET,OPTIONS');
    });
  });

  describe('session history', () => {
    it('always uses claims.sub for PK, never path', async () => {
      ddbSend.mockResolvedValue({ Items: [] });
      const handler = freshHandler();
      await handler(evt('GET', '/analytics/me/session-history', tenantAdminA, { days: '30' }));
      const queryCmd = ddbSend.mock.calls[0][0];
      expect(queryCmd.input.ExpressionAttributeValues[':pk'].S).toBe('USER#user-a');
    });
  });

  describe('CSV export URL', () => {
    it('returns presigned S3 URL', async () => {
      ddbSend.mockResolvedValue({ Items: [] });
      const handler = freshHandler();
      const r = await handler(
        evt('GET', '/analytics/tenants/tenant-A/export-csv-url', tenantAdminA,
          { from: '2026-04-01', to: '2026-04-14', granularity: 'day' }),
      );
      expect(r.statusCode).toBe(200);
      const body = JSON.parse(r.body);
      expect(body.url).toBe('https://signed.example.com/url');
      expect(body.expiresIn).toBe(600);
      // S3 PutObject was invoked
      expect(s3Send).toHaveBeenCalled();
    });
    it('500 if EXPORT_BUCKET_NAME unset', async () => {
      delete process.env.EXPORT_BUCKET_NAME;
      const handler = freshHandler();
      const r = await handler(
        evt('GET', '/analytics/tenants/tenant-A/export-csv-url', tenantAdminA,
          { from: '2026-04-01', to: '2026-04-14', granularity: 'day' }),
      );
      expect(r!.statusCode).toBe(500);
    });
  });

  describe('A-WS2.T3 — EventBridge dispatch (WorkspaceSettingsUpdated)', () => {
    function settingsUpdatedEvent(tenantId: string) {
      return {
        version: '0',
        id: 'eb-id',
        source: 'edforge.identity-service',
        'detail-type': 'WorkspaceSettingsUpdated',
        account: '111111111111',
        time: '2026-04-16T12:00:00Z',
        region: 'us-east-2',
        resources: [],
        detail: { tenantId, changedSections: ['regional'] },
      };
    }

    it('returns null and does not invoke API Gateway path', async () => {
      const handler = freshHandler();
      const result = await handler(settingsUpdatedEvent('tenant-A') as any);
      // No HTTP response — EventBridge target invocations don't read a body.
      expect(result).toBeNull();
      // No DDB or S3 traffic — invalidation is in-memory only.
      expect(s3Send).not.toHaveBeenCalled();
    });

    it('invalidates cached settings — next API call re-fetches', async () => {
      const handler = freshHandler();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tenantSettingsResolver } = require('./handler');
      const invalidateSpy = jest.spyOn(tenantSettingsResolver, 'invalidate');

      await handler(settingsUpdatedEvent('tenant-A') as any);

      expect(invalidateSpy).toHaveBeenCalledWith('tenant-A');
    });

    it('ignores events without tenantId — no invalidate call', async () => {
      const handler = freshHandler();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tenantSettingsResolver } = require('./handler');
      const invalidateSpy = jest.spyOn(tenantSettingsResolver, 'invalidate');

      const malformed = settingsUpdatedEvent('') as any;
      malformed.detail = {};
      const result = await handler(malformed);

      expect(result).toBeNull();
      expect(invalidateSpy).not.toHaveBeenCalled();
    });

    it('ignores non-WorkspaceSettingsUpdated EventBridge events', async () => {
      const handler = freshHandler();
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { tenantSettingsResolver } = require('./handler');
      const invalidateSpy = jest.spyOn(tenantSettingsResolver, 'invalidate');

      const otherEvent = {
        ...settingsUpdatedEvent('tenant-A'),
        'detail-type': 'SomeOtherEvent',
      };
      const result = await handler(otherEvent as any);

      expect(result).toBeNull();
      expect(invalidateSpy).not.toHaveBeenCalled();
    });
  });
});
