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

const BASE_ENV = {
  EVENT_BUS_NAME: 'test-bus',
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
});
