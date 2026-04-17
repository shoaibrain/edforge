import { AnalyticsEventsService, ANALYTICS_EVENT_SOURCE } from './analytics-events.service';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';

// Mock EventBridgeClient.send globally. Each test resets the mock.
const sendMock = jest.fn();
jest.mock('@aws-sdk/client-eventbridge', () => {
  const actual = jest.requireActual('@aws-sdk/client-eventbridge');
  return {
    ...actual,
    EventBridgeClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => sendMock(...args),
    })),
  };
});

const validInput = () => ({
  tenantId: 'tenant-abc',
  userId: 'user-xyz',
  role: 'Teacher' as const,
  schoolId: 'school-1',
});

describe('AnalyticsEventsService', () => {
  beforeEach(() => {
    sendMock.mockReset();
    sendMock.mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'e1' }] });
    process.env.EVENT_BUS_NAME = 'test-bus';
  });

  afterEach(() => {
    delete process.env.ANALYTICS_ENABLED;
    delete process.env.EVENT_BUS_NAME;
  });

  describe('when ANALYTICS_ENABLED=true', () => {
    let svc: AnalyticsEventsService;
    beforeEach(() => {
      process.env.ANALYTICS_ENABLED = 'true';
      svc = new AnalyticsEventsService();
    });

    it('reports enabled', () => {
      expect(svc.isEnabled()).toBe(true);
    });

    const helperCases: Array<[string, keyof AnalyticsEventsService, string, string, string]> = [
      ['emitLoginSuccess',     'emitLoginSuccess',     'LoginSuccess',     'auth',    'login.success'],
      ['emitLoginFailure',     'emitLoginFailure',     'LoginFailure',     'auth',    'login.failure'],
      ['emitLogout',           'emitLogout',           'Logout',           'auth',    'logout'],
      ['emitPasswordReset',    'emitPasswordReset',    'PasswordReset',    'auth',    'password.reset'],
      ['emitSessionCreated',   'emitSessionCreated',   'SessionCreated',   'session', 'create'],
      ['emitSessionRevoked',   'emitSessionRevoked',   'SessionRevoked',   'session', 'revoke'],
      ['emitSessionRefreshed', 'emitSessionRefreshed', 'SessionRefreshed', 'session', 'refresh'],
      ['emitUserCreated',      'emitUserCreated',      'UserCreated',      'user',    'create'],
      ['emitUserUpdated',      'emitUserUpdated',      'UserUpdated',      'user',    'update'],
      ['emitUserDisabled',     'emitUserDisabled',     'UserDisabled',     'user',    'disable'],
      ['emitAuditLogged',      'emitAuditLogged',      'AuditLogged',      'audit',   'logged'],
    ];

    it.each(helperCases)(
      '%s publishes PutEvents with correct Source, DetailType, feature, action',
      async (_label, method, detailType, feature, action) => {
        await (svc[method] as any).call(svc, validInput());
        expect(sendMock).toHaveBeenCalledTimes(1);
        const cmd = sendMock.mock.calls[0][0] as PutEventsCommand;
        const entry = cmd.input.Entries![0];
        expect(entry.Source).toBe(ANALYTICS_EVENT_SOURCE);
        expect(entry.DetailType).toBe(detailType);
        expect(entry.EventBusName).toBe('test-bus');
        const detail = JSON.parse(entry.Detail!);
        expect(detail).toMatchObject({
          schemaVersion: 1,
          tenantTier: 'BASIC',
          tenantId: 'tenant-abc',
          userId: 'user-xyz',
          role: 'Teacher',
          schoolId: 'school-1',
          feature,
          action,
        });
        expect(detail.eventId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
        );
        expect(Date.parse(detail.ts)).not.toBeNaN();
      },
    );

    it('emitFeatureUsage publishes FeatureUsage with feature+action metadata passthrough', async () => {
      await svc.emitFeatureUsage({
        ...validInput(),
        metadata: { feature: 'attendance', action: 'create' },
      });
      expect(sendMock).toHaveBeenCalledTimes(1);
      const entry = (sendMock.mock.calls[0][0] as PutEventsCommand).input.Entries![0];
      expect(entry.DetailType).toBe('FeatureUsage');
      const detail = JSON.parse(entry.Detail!);
      expect(detail.metadata).toEqual({ feature: 'attendance', action: 'create' });
    });

    it('swallows EventBridge errors (does not throw)', async () => {
      sendMock.mockRejectedValueOnce(new Error('network down'));
      await expect(svc.emitLoginSuccess(validInput())).resolves.toBeUndefined();
    });

    it('logs but does not throw on FailedEntryCount > 0', async () => {
      sendMock.mockResolvedValueOnce({
        FailedEntryCount: 1,
        Entries: [{ ErrorCode: 'InternalException', ErrorMessage: 'x' }],
      });
      await expect(svc.emitLoginSuccess(validInput())).resolves.toBeUndefined();
    });

    it('generates unique eventId and fresh ts per call', async () => {
      await svc.emitLoginSuccess(validInput());
      await svc.emitLoginSuccess(validInput());
      const d1 = JSON.parse((sendMock.mock.calls[0][0] as PutEventsCommand).input.Entries![0].Detail!);
      const d2 = JSON.parse((sendMock.mock.calls[1][0] as PutEventsCommand).input.Entries![0].Detail!);
      expect(d1.eventId).not.toBe(d2.eventId);
    });
  });

  describe('when ANALYTICS_ENABLED=false', () => {
    let svc: AnalyticsEventsService;
    beforeEach(() => {
      process.env.ANALYTICS_ENABLED = 'false';
      svc = new AnalyticsEventsService();
    });

    it('reports disabled', () => {
      expect(svc.isEnabled()).toBe(false);
    });

    it('every helper is a silent no-op (zero PutEvents calls)', async () => {
      await svc.emitLoginSuccess(validInput());
      await svc.emitLoginFailure(validInput());
      await svc.emitLogout(validInput());
      await svc.emitPasswordReset(validInput());
      await svc.emitSessionCreated(validInput());
      await svc.emitSessionRevoked(validInput());
      await svc.emitSessionRefreshed(validInput());
      await svc.emitUserCreated(validInput());
      await svc.emitUserUpdated(validInput());
      await svc.emitUserDisabled(validInput());
      await svc.emitAuditLogged(validInput());
      await svc.emitFeatureUsage({
        ...validInput(),
        metadata: { feature: 'attendance', action: 'create' },
      });
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe('when ANALYTICS_ENABLED is unset', () => {
    it('defaults to disabled', () => {
      delete process.env.ANALYTICS_ENABLED;
      const svc = new AnalyticsEventsService();
      expect(svc.isEnabled()).toBe(false);
    });
  });

  describe('when EVENT_BUS_NAME missing while enabled', () => {
    it('skips publish without throwing', async () => {
      process.env.ANALYTICS_ENABLED = 'true';
      delete process.env.EVENT_BUS_NAME;
      const svc = new AnalyticsEventsService();
      await expect(svc.emitLoginSuccess(validInput())).resolves.toBeUndefined();
      expect(sendMock).not.toHaveBeenCalled();
    });
  });

  describe('ConfigService integration', () => {
    it('reads ANALYTICS_ENABLED from ConfigService when provided', () => {
      delete process.env.ANALYTICS_ENABLED;
      const fakeConfig = {
        get: jest.fn((key: string) => (key === 'ANALYTICS_ENABLED' ? 'true' : 'test-bus')),
      } as any;
      const svc = new AnalyticsEventsService(fakeConfig);
      expect(svc.isEnabled()).toBe(true);
    });

    it('coerces non-"true" strings to false', () => {
      const fakeConfig = {
        get: jest.fn((key: string) => (key === 'ANALYTICS_ENABLED' ? 'TRUE' : 'test-bus')),
      } as any;
      const svc = new AnalyticsEventsService(fakeConfig);
      expect(svc.isEnabled()).toBe(false);
    });
  });
});
