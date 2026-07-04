/**
 * C0a — Cognito PostAuthentication trigger tests.
 *
 * Verifies:
 *   - emits LoginSuccess to the configured bus with shape compatible with
 *     AnalyticsEventsService.emitLoginSuccess
 *   - returns the event object unchanged (Cognito contract)
 *   - never throws on EventBridge failure (would otherwise break login)
 *   - skips emit (and warns) when EVENT_BUS_NAME is missing or
 *     custom:tenantId is missing
 *   - normalizes Principal/VicePrincipal/lowercase variants to canonical roles
 */

const ebSend = jest.fn();

jest.mock('@aws-sdk/client-eventbridge', () => {
  const actual = jest.requireActual('@aws-sdk/client-eventbridge');
  return {
    ...actual,
    EventBridgeClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => ebSend(...args),
    })),
  };
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';

const ddbSend = jest.fn();

// Only the document client's send is mocked; PutCommand stays real (it relies
// on the real @aws-sdk/client-dynamodb PutItemCommand internally). new
// DynamoDBClient(...) constructs a harmless real client the mocked .from() ignores.
jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn(() => ({
        send: (...args: unknown[]) => ddbSend(...args),
      })),
    },
  };
});

const BASE_ENV = {
  EVENT_BUS_NAME: 'test-bus',
  TABLE_NAME: 'edforge-identity-basic-test',
  AWS_REGION: 'us-east-2',
};

function withEnv(overrides: Record<string, string>, run: () => Promise<void>) {
  const saved = process.env;
  process.env = { ...saved, ...BASE_ENV, ...overrides };
  return run().finally(() => {
    process.env = saved;
  });
}

function freshHandler(): typeof import('./handler').handler {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./handler').handler;
}

function mkEvent(overrides: Partial<{
  userAttributes: Record<string, string>;
  triggerSource: string;
  userName: string;
}> = {}): import('./handler').CognitoPostAuthEvent {
  return {
    version: '1',
    region: 'us-east-2',
    userPoolId: 'us-east-2_test',
    userName: overrides.userName ?? '41dbb590-00f1-7074-e6a1-98262c3e9c68',
    triggerSource: overrides.triggerSource ?? 'PostAuthentication_Authentication',
    request: {
      userAttributes: overrides.userAttributes ?? {
        sub: '41dbb590-00f1-7074-e6a1-98262c3e9c68',
        email: 'shoaib.rain@outlook.com',
        'custom:tenantId': '264ff030-1cd8-4dc3-bdfe-f2728c3e40d0',
        'custom:userRole': 'TenantAdmin',
      },
    },
    response: {},
  };
}

beforeEach(() => {
  ebSend.mockReset().mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'e1' }] });
  ddbSend.mockReset().mockResolvedValue({});
});

describe('Cognito PostAuthentication trigger', () => {
  it('emits LoginSuccess with shape compatible with AnalyticsEventsService', async () => {
    await withEnv({}, async () => {
      const handler = freshHandler();
      const result = await handler(mkEvent());

      // Returns the event unchanged (Cognito contract)
      expect(result).toEqual(mkEvent());

      const calls = ebSend.mock.calls;
      expect(calls).toHaveLength(1);
      const cmd = calls[0][0];
      // jest.resetModules() can produce a duplicate PutEventsCommand class
      // (same name, different module instance) so check by constructor name.
      expect(cmd?.constructor?.name).toBe('PutEventsCommand');
      const entry = cmd.input.Entries[0];
      expect(entry.Source).toBe('edforge.identity-service');
      expect(entry.DetailType).toBe('LoginSuccess');
      expect(entry.EventBusName).toBe('test-bus');

      const detail = JSON.parse(entry.Detail);
      expect(detail).toMatchObject({
        schemaVersion: 1,
        tenantId: '264ff030-1cd8-4dc3-bdfe-f2728c3e40d0',
        tenantTier: 'BASIC',
        userId: '41dbb590-00f1-7074-e6a1-98262c3e9c68',
        role: 'TenantAdmin',
        feature: 'auth',
        action: 'login.success',
      });
      expect(detail.eventId).toMatch(/^[0-9a-f-]{36}$/);
      expect(typeof detail.ts).toBe('string');
      expect(detail.metadata.email).toBe('shoaib.rain@outlook.com');
      expect(detail.metadata.source).toBe('cognito-post-auth-trigger');
    });
  });

  it('coerces Principal and VicePrincipal to Teacher (umbrella for teaching staff)', async () => {
    await withEnv({}, async () => {
      const handler = freshHandler();
      for (const raw of ['Principal', 'VicePrincipal', 'principal', 'viceprincipal', 'teacher']) {
        ebSend.mockClear();
        await handler(mkEvent({
          userAttributes: {
            sub: 'u1',
            email: 'a@b',
            'custom:tenantId': 't1',
            'custom:userRole': raw,
          },
        }));
        const detail = JSON.parse(ebSend.mock.calls[0][0].input.Entries[0].Detail);
        expect(detail.role).toBe('Teacher');
        expect(detail.metadata.rawRole).toBe(raw);
      }
    });
  });

  it('lowercases Parent/Student variants are coerced to canonical roles', async () => {
    await withEnv({}, async () => {
      const handler = freshHandler();
      ebSend.mockClear();
      await handler(mkEvent({
        userAttributes: {
          sub: 'u1', email: 'a@b', 'custom:tenantId': 't1', 'custom:userRole': 'parent',
        },
      }));
      expect(JSON.parse(ebSend.mock.calls[0][0].input.Entries[0].Detail).role).toBe('Parent');

      ebSend.mockClear();
      await handler(mkEvent({
        userAttributes: {
          sub: 'u1', email: 'a@b', 'custom:tenantId': 't1', 'custom:userRole': 'student',
        },
      }));
      expect(JSON.parse(ebSend.mock.calls[0][0].input.Entries[0].Detail).role).toBe('Student');
    });
  });

  it('unknown roles default to TenantAdmin (passes downstream schema enum)', async () => {
    await withEnv({}, async () => {
      const handler = freshHandler();
      await handler(mkEvent({
        userAttributes: {
          sub: 'u1', email: 'a@b', 'custom:tenantId': 't1', 'custom:userRole': 'something-weird',
        },
      }));
      const detail = JSON.parse(ebSend.mock.calls[0][0].input.Entries[0].Detail);
      expect(detail.role).toBe('TenantAdmin');
      expect(detail.metadata.rawRole).toBe('something-weird');
    });
  });

  it('skips emit when EVENT_BUS_NAME is missing (does not throw)', async () => {
    await withEnv({ EVENT_BUS_NAME: '' }, async () => {
      const handler = freshHandler();
      const result = await handler(mkEvent());
      expect(result).toBeDefined();
      expect(ebSend).not.toHaveBeenCalled();
    });
  });

  it('skips emit when custom:tenantId is missing (does not throw)', async () => {
    await withEnv({}, async () => {
      const handler = freshHandler();
      const result = await handler(mkEvent({
        userAttributes: { sub: 'u1', email: 'a@b' },  // no custom:tenantId
      }));
      expect(result).toBeDefined();
      expect(ebSend).not.toHaveBeenCalled();
    });
  });

  it('NEVER throws when EventBridge fails (login must not break)', async () => {
    await withEnv({}, async () => {
      ebSend.mockReset().mockRejectedValue(new Error('boom'));
      const handler = freshHandler();
      const event = mkEvent();
      await expect(handler(event)).resolves.toEqual(event);
    });
  });

  it('NEVER throws when PutEvents reports a partial failure', async () => {
    await withEnv({}, async () => {
      ebSend.mockReset().mockResolvedValue({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'InternalError', ErrorMessage: 'partial' }],
      });
      const handler = freshHandler();
      const event = mkEvent();
      await expect(handler(event)).resolves.toEqual(event);
    });
  });

  // --- #422: login-history capture at the PostAuth seam ---

  it('writes a LOGIN_HISTORY row to the identity table with the expected shape', async () => {
    await withEnv({}, async () => {
      const handler = freshHandler();
      await handler(mkEvent());

      expect(ddbSend).toHaveBeenCalledTimes(1);
      const cmd = ddbSend.mock.calls[0][0];
      // resetModules can duplicate the class; check by constructor name.
      expect(cmd?.constructor?.name).toBe('PutCommand');
      const { TableName, Item } = cmd.input;
      expect(TableName).toBe('edforge-identity-basic-test');
      expect(Item).toMatchObject({
        tenantId: '264ff030-1cd8-4dc3-bdfe-f2728c3e40d0', // bare UUID PK
        entityType: 'LOGIN_HISTORY',
        userId: '41dbb590-00f1-7074-e6a1-98262c3e9c68',
        status: 'success',
        source: 'cognito-post-auth-trigger',
      });
      expect(Item.entityKey).toMatch(
        /^USER#41dbb590-00f1-7074-e6a1-98262c3e9c68#LOGIN#.+/,
      );
      expect(Item.entityKey).toContain(Item.timestamp); // SK carries the ts
      // TTL is ~180 days out, in SECONDS (not ms) — matches the identity table's
      // `ttl` attribute so the row self-prunes.
      const nowSec = Math.floor(Date.now() / 1000);
      expect(Item.ttl).toBeGreaterThan(nowSec + 179 * 86400);
      expect(Item.ttl).toBeLessThan(nowSec + 181 * 86400);
    });
  });

  it('login-history write NEVER throws and does not block the analytics emit when DynamoDB fails', async () => {
    await withEnv({}, async () => {
      ddbSend.mockReset().mockRejectedValue(new Error('ddb boom'));
      const handler = freshHandler();
      const event = mkEvent();
      // The user's login must proceed (event returned) AND the analytics emit
      // must still fire — the two side-effects are independent.
      await expect(handler(event)).resolves.toEqual(event);
      expect(ebSend).toHaveBeenCalledTimes(1);
    });
  });

  it('skips the login-history write when TABLE_NAME is missing (does not throw; emit unaffected)', async () => {
    await withEnv({ TABLE_NAME: '' }, async () => {
      const handler = freshHandler();
      const event = mkEvent();
      await expect(handler(event)).resolves.toEqual(event);
      expect(ddbSend).not.toHaveBeenCalled();
      expect(ebSend).toHaveBeenCalledTimes(1);
    });
  });

  it('does not write login history when custom:tenantId is missing (guard before both side-effects)', async () => {
    await withEnv({}, async () => {
      const handler = freshHandler();
      await handler(mkEvent({ userAttributes: { sub: 'u1', email: 'a@b' } }));
      expect(ddbSend).not.toHaveBeenCalled();
      expect(ebSend).not.toHaveBeenCalled();
    });
  });

  // --- #423 review P1: bounded latency, not just caught exceptions ---
  // A PostAuthentication trigger runs synchronously on the login path; a STALLED
  // (never-returning) side-effect would run the Lambda out to timeout and fail
  // the login. The try/catch can't rescue that — only a wall-clock bound can.

  it('bounds the login-history write — a HUNG DynamoDB call does not stall the login', async () => {
    await withEnv({ LOGIN_SIDE_EFFECT_TIMEOUT_MS: '50' }, async () => {
      ddbSend.mockReset().mockReturnValue(new Promise(() => {})); // never resolves — a stall
      const handler = freshHandler();
      const event = mkEvent();
      const start = Date.now();
      await expect(handler(event)).resolves.toEqual(event);
      expect(Date.now() - start).toBeLessThan(1000); // bounded ~50ms, not the 5s Lambda timeout
      expect(ebSend).toHaveBeenCalledTimes(1); // emit ran concurrently, unaffected
    });
  });

  it('bounds the analytics emit — a HUNG EventBridge call does not stall the login', async () => {
    await withEnv({ LOGIN_SIDE_EFFECT_TIMEOUT_MS: '50' }, async () => {
      ebSend.mockReset().mockReturnValue(new Promise(() => {})); // never resolves — a stall
      const handler = freshHandler();
      const event = mkEvent();
      const start = Date.now();
      await expect(handler(event)).resolves.toEqual(event);
      expect(Date.now() - start).toBeLessThan(1000);
      expect(ddbSend).toHaveBeenCalledTimes(1); // history write ran concurrently, unaffected
    });
  });
});
