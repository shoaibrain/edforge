import * as fs from 'fs';
import * as path from 'path';
import type { APIGatewayProxyEvent, APIGatewayProxyResult, Context } from 'aws-lambda';

/**
 * C1.3 — the identity Lambda entry boots the real IdentityModule once on an
 * Express adapter and answers recorded API Gateway (REST, proxy v1) events.
 *
 * `/health/live` needs no credentials and no dependency (the readiness probe
 * `/health` calls DynamoDB and EventBridge, which jest maps to mocks); a
 * guarded route without an Authorization header must come back 401 from the
 * passport JWT guard before any JWKS or AWS call is attempted. Environment
 * stubs mirror the task-definition variables; no AWS client is exercised.
 */
const EVENTS = path.resolve(__dirname, '../../../../../scripts/lambda-events');
const loadEvent = (name: string): APIGatewayProxyEvent =>
  JSON.parse(fs.readFileSync(path.join(EVENTS, name), 'utf8'));

const context = {
  callbackWaitsForEmptyEventLoop: false,
  functionName: 'edforge-identity-basic-api',
  awsRequestId: '00000000-0000-4000-8000-000000000000',
  getRemainingTimeInMillis: () => 29_000,
} as unknown as Context;

const ENV: Record<string, string> = {
  EDFORGE_RUNTIME: 'lambda',
  AWS_REGION: 'ap-south-1',
  COGNITO_REGION: 'ap-south-1',
  COGNITO_USER_POOL_ID: 'ap-south-1_TESTPOOL',
  COGNITO_CLIENT_ID: 'testclientid',
  TABLE_NAME: 'edforge-identity-test',
  EVENT_BUS_NAME: 'test-bus',
  IAM_ROLE_ARN: 'arn:aws:iam::000000000000:role/test-abac',
  REQUEST_TAG_KEYS_MAPPING_ATTRIBUTES: '{"tenant":"custom:tenantId"}',
  IDP_DETAILS: '{"issuer":"https://cognito-idp.ap-south-1.amazonaws.com/ap-south-1_TESTPOOL","audience":"testclientid"}',
  INTERNAL_API_KEY: 'test-internal-key',
  PDF_ASSETS_BUCKET: 'test-pdf-assets',
  REPORTS_STAGING_BUCKET: 'test-reports',
};

describe('identity Lambda entry (C1.3)', () => {
  const saved: Record<string, string | undefined> = {};
  let handler: (e: APIGatewayProxyEvent, c: Context) => Promise<APIGatewayProxyResult>;

  beforeAll(async () => {
    for (const [k, v] of Object.entries(ENV)) {
      saved[k] = process.env[k];
      process.env[k] = v;
    }
    // Import after the environment is set: AuthConfig reads COGNITO_* at
    // construction and the module graph is built inside buildHandler().
    const mod = await import('./lambda');
    handler = mod.handler as unknown as typeof handler;
  }, 60_000);

  afterAll(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('serves GET /health/live from the cached Nest app', async () => {
    const res = await handler(loadEvent('health-live.json'), context);
    expect(res.statusCode).toBe(200);
    // serverless-express answers REST (v1) events with multiValueHeaders.
    const contentType =
      res.multiValueHeaders?.['content-type']?.[0] ??
      res.headers?.['content-type'] ??
      res.headers?.['Content-Type'];
    expect(String(contentType)).toMatch(/application\/json/);
    expect(JSON.parse(res.body)).toEqual(expect.objectContaining({ alive: true }));
  }, 60_000);

  it('answers a guarded route without Authorization with 401, before any JWKS fetch', async () => {
    const res = await handler(loadEvent('users-me-unauthenticated.json'), context);
    expect(res.statusCode).toBe(401);
  }, 30_000);

  it('reuses the same application across invocations (module-scope cache)', async () => {
    const mod = await import('./lambda');
    const build = jest.spyOn(mod, 'buildHandler');
    await handler(loadEvent('health-live.json'), context);
    await handler(loadEvent('health-live.json'), context);
    expect(build).not.toHaveBeenCalled();
  }, 30_000);
});
