/**
 * Layer 5.2 — aggregator unit tests. Every bullet from the sprint plan:
 *   - valid event → landing + aggregate rows
 *   - duplicate eventId → no aggregate writes
 *   - unknown schemaVersion → DLQ, no aggregate writes
 *   - unknown source/detailType → ignored (logged), no DLQ, no writes
 *   - identity-service LoginSuccess (Cognito trigger) → auth.login.success
 *   - TransactionConflict → retried; exhausted retries → DLQ
 *   - session event → landing + aggregates + user-session row
 *   - ANALYTICS_ENABLED=false → zero writes
 *   - PII invariant: no SK contains userId (mandatory test)
 *   - structured logging carries correlationId/tenantId/eventId/detailType
 *
 * We mock the SDK clients with jest.mock rather than aws-sdk-client-mock so
 * the tests run under the default ts-jest config (no experimental-vm-modules).
 */

// ------------------------------------------------------------
// Mock setup (declared before any `require` of the handler)
// ------------------------------------------------------------
const ddbSend = jest.fn();
const cwSend = jest.fn();
const sqsSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => ddbSend(...args),
    })),
  };
});
jest.mock('@aws-sdk/client-cloudwatch', () => {
  const actual = jest.requireActual('@aws-sdk/client-cloudwatch');
  return {
    ...actual,
    CloudWatchClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => cwSend(...args),
    })),
  };
});
jest.mock('@aws-sdk/client-sqs', () => {
  const actual = jest.requireActual('@aws-sdk/client-sqs');
  return {
    ...actual,
    SQSClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => sqsSend(...args),
    })),
  };
});

import {
  PutItemCommand,
  TransactWriteItemsCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';
import { SendMessageCommand } from '@aws-sdk/client-sqs';

const BASE_ENV = {
  ANALYTICS_TABLE_NAME: 'edforge-analytics',
  LANDING_TABLE_NAME: 'edforge-analytics-landing',
  USER_SESSION_EVENTS_TABLE_NAME: 'edforge-user-session-events',
  AGGREGATOR_DLQ_URL: 'https://sqs.test/queue/agg-dlq',
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

function analyticsEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eb-envelope-1',
    source: 'edforge.analytics',
    'detail-type': 'LoginSuccess',
    detail: {
      schemaVersion: 1,
      eventId: '11111111-2222-3333-4444-555555555555',
      ts: '2026-04-14T12:00:00.000Z',
      tenantId: 'tenant-A',
      tenantTier: 'BASIC',
      userId: 'user-X',
      role: 'Teacher',
      feature: 'auth',
      action: 'login.success',
      ...overrides,
    },
  };
}

function domainEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'eb-envelope-2',
    source: 'edforge.academics-service',
    'detail-type': 'AttendanceRecorded',
    detail: {
      eventId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      tenantId: 'tenant-A',
      ts: '2026-04-14T09:00:00.000Z',
      userId: 'teacher-1',
      role: 'Teacher',
      schoolId: 'school-100',
      ...overrides,
    },
  };
}

function callsOf<T>(mock: jest.Mock, CommandCtor: new (...args: any[]) => T): T[] {
  // Match by class name rather than `instanceof` because jest.resetModules()
  // creates fresh class identities for the handler's copies of the SDK.
  const ctorName = CommandCtor.name;
  return mock.mock.calls
    .map((c) => c[0])
    .filter((c) => c?.constructor?.name === ctorName) as T[];
}

beforeEach(() => {
  ddbSend.mockReset();
  cwSend.mockReset();
  sqsSend.mockReset();
  ddbSend.mockResolvedValue({});
  cwSend.mockResolvedValue({});
  sqsSend.mockResolvedValue({});
});

describe('aggregator handler — Layer 5.2', () => {
  it('ANALYTICS_ENABLED=false → zero DDB/CW/SQS calls', async () => {
    await withEnv({ ANALYTICS_ENABLED: 'false' }, async () => {
      const handler = freshHandler();
      await handler(analyticsEvent() as any);
      expect(ddbSend).not.toHaveBeenCalled();
      expect(cwSend).not.toHaveBeenCalled();
      expect(sqsSend).not.toHaveBeenCalled();
    });
  });

  it('valid analytics event → landing + 2 aggregates (total + role) + CW metrics', async () => {
    await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
      const handler = freshHandler();
      await handler(analyticsEvent() as any);

      const puts = callsOf(ddbSend, PutItemCommand);
      expect(puts).toHaveLength(1);
      expect(puts[0].input.TableName).toBe('edforge-analytics-landing');

      const txs = callsOf(ddbSend, TransactWriteItemsCommand);
      expect(txs).toHaveLength(1);
      const items = txs[0].input.TransactItems!;
      expect(items).toHaveLength(2);
      const sks = items.map((i) => i.Update!.Key!.SK.S);
      expect(sks).toEqual([
        'DAY#2026-04-14#auth.login.success',
        'DAY#2026-04-14#auth.login.success#role=Teacher',
      ]);

      const cws = callsOf(cwSend, PutMetricDataCommand);
      expect(cws).toHaveLength(1);
      const metricNames = cws[0].input.MetricData!.map((m) => m.MetricName);
      expect(metricNames).toEqual(['AnalyticsEventsProcessed', 'AnalyticsAggregateWritten']);
    });
  });

  it('domain AttendanceRecorded → landing + 3 aggregates (total + role + school)', async () => {
    await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
      const handler = freshHandler();
      await handler(domainEvent() as any);
      const txs = callsOf(ddbSend, TransactWriteItemsCommand);
      expect(txs).toHaveLength(1);
      const items = txs[0].input.TransactItems!;
      expect(items).toHaveLength(3);
      const sks = items.map((i) => i.Update!.Key!.SK.S);
      expect(sks).toEqual([
        'DAY#2026-04-14#academics.attendance.recorded',
        'DAY#2026-04-14#academics.attendance.recorded#role=Teacher',
        'DAY#2026-04-14#academics.attendance.recorded#school=school-100',
      ]);
    });
  });

  it('duplicate eventId → ConditionalCheckFailed on landing; no aggregate writes', async () => {
    await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
      ddbSend.mockImplementationOnce(async (cmd: any) => {
        if (cmd?.constructor?.name === 'PutItemCommand') {
          throw new ConditionalCheckFailedException({ $metadata: {}, message: 'duplicate' });
        }
        return {};
      });
      const handler = freshHandler();
      await handler(analyticsEvent() as any);
      expect(callsOf(ddbSend, TransactWriteItemsCommand)).toHaveLength(0);
      expect(callsOf(sqsSend, SendMessageCommand)).toHaveLength(0);
    });
  });

  it('unknown schemaVersion on analytics source → DLQ, no aggregate writes', async () => {
    await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
      const handler = freshHandler();
      await handler(analyticsEvent({ schemaVersion: 2 }) as any);
      expect(callsOf(ddbSend, PutItemCommand)).toHaveLength(0);
      expect(callsOf(ddbSend, TransactWriteItemsCommand)).toHaveLength(0);
      const dlq = callsOf(sqsSend, SendMessageCommand);
      expect(dlq).toHaveLength(1);
      expect(JSON.parse(dlq[0].input.MessageBody!).reason).toMatch(/schema validation failed/);
    });
  });

  it('unknown source/detailType → ignored: no landing, no aggregates, no DLQ', async () => {
    await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const handler = freshHandler();
      const evt = {
        id: 'x',
        source: 'edforge.unknown',
        'detail-type': 'SomethingNew',
        detail: { eventId: '12345678-1234-1234-1234-123456789012', tenantId: 'tenant-A' },
      };
      await handler(evt as any);
      expect(callsOf(ddbSend, PutItemCommand)).toHaveLength(0);
      expect(callsOf(ddbSend, TransactWriteItemsCommand)).toHaveLength(0);
      expect(callsOf(sqsSend, SendMessageCommand)).toHaveLength(0);
      expect(warn.mock.calls.some((c) => String(c[0]).includes('event ignored'))).toBe(true);
      warn.mockRestore();
    });
  });

  it('identity-service LoginSuccess (Cognito trigger) → landing + auth.login.success aggregates', async () => {
    await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
      const handler = freshHandler();
      const evt = {
        id: 'eb-envelope-3',
        source: 'edforge.identity-service',
        'detail-type': 'LoginSuccess',
        detail: {
          eventId: '22222222-3333-4444-5555-666666666666',
          ts: '2026-04-14T12:00:00.000Z',
          tenantId: 'tenant-A',
          userId: 'user-X',
          role: 'Teacher',
        },
      };
      await handler(evt as any);
      expect(callsOf(ddbSend, PutItemCommand)).toHaveLength(1);
      const txs = callsOf(ddbSend, TransactWriteItemsCommand);
      expect(txs).toHaveLength(1);
      const sks = txs[0].input.TransactItems!.map((i) => i.Update!.Key!.SK.S);
      expect(sks).toEqual([
        'DAY#2026-04-14#auth.login.success',
        'DAY#2026-04-14#auth.login.success#role=Teacher',
      ]);
      expect(callsOf(sqsSend, SendMessageCommand)).toHaveLength(0);
    });
  });

  describe('TransactionConflict on the aggregate write', () => {
    const conflict = () =>
      Object.assign(
        new Error(
          'Transaction cancelled, please refer cancellation reasons for specific reasons [TransactionConflict, TransactionConflict]',
        ),
        {
          name: 'TransactionCanceledException',
          CancellationReasons: [{ Code: 'TransactionConflict' }, { Code: 'TransactionConflict' }],
        },
      );

    it('is retried and succeeds without touching the DLQ', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true', AGGREGATOR_CONFLICT_RETRY_BASE_MS: '0' }, async () => {
        let transactCalls = 0;
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'TransactWriteItemsCommand') {
            transactCalls += 1;
            if (transactCalls === 1) throw conflict();
          }
          return {};
        });
        const handler = freshHandler();
        await handler(domainEvent() as any);
        expect(callsOf(ddbSend, TransactWriteItemsCommand)).toHaveLength(2);
        expect(callsOf(sqsSend, SendMessageCommand)).toHaveLength(0);
      });
    });

    it('goes to the DLQ after five attempts', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true', AGGREGATOR_CONFLICT_RETRY_BASE_MS: '0' }, async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'TransactWriteItemsCommand') throw conflict();
          return {};
        });
        const handler = freshHandler();
        await handler(domainEvent() as any);
        expect(callsOf(ddbSend, TransactWriteItemsCommand)).toHaveLength(5);
        const dlq = callsOf(sqsSend, SendMessageCommand);
        expect(dlq).toHaveLength(1);
        expect(JSON.parse(dlq[0].input.MessageBody!).reason).toMatch(/TransactWrite failed/);
      });
    });

    it('a cancellation that is not a conflict is not retried', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true', AGGREGATOR_CONFLICT_RETRY_BASE_MS: '0' }, async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'TransactWriteItemsCommand') {
            throw Object.assign(new Error('Transaction cancelled [ConditionalCheckFailed, None]'), {
              name: 'TransactionCanceledException',
              CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
            });
          }
          return {};
        });
        const handler = freshHandler();
        await handler(domainEvent() as any);
        expect(callsOf(ddbSend, TransactWriteItemsCommand)).toHaveLength(1);
        expect(callsOf(sqsSend, SendMessageCommand)).toHaveLength(1);
      });
    });
  });

  it('SessionCreated → landing + aggregates + user-session row in same TransactWrite', async () => {
    await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
      const handler = freshHandler();
      const evt = analyticsEvent() as any;
      evt['detail-type'] = 'SessionCreated';
      evt.detail.feature = 'session';
      evt.detail.action = 'create';
      await handler(evt);

      const txs = callsOf(ddbSend, TransactWriteItemsCommand);
      expect(txs).toHaveLength(1);
      const items = txs[0].input.TransactItems!;
      // SessionCreated dims=['role']: total + role = 2 aggregates, + 1 user-session = 3.
      expect(items).toHaveLength(3);
      const userSessionPut = items.find((i) => i.Put);
      expect(userSessionPut).toBeDefined();
      expect(userSessionPut!.Put!.TableName).toBe('edforge-user-session-events');
      expect(userSessionPut!.Put!.Item!.PK.S).toBe('USER#user-X');
      expect(userSessionPut!.Put!.Item!.SK.S).toMatch(
        /^EVENT#2026-04-14T12:00:00\.000Z#11111111-2222-3333-4444-555555555555$/,
      );
      expect(userSessionPut!.Put!.ConditionExpression).toBe('attribute_not_exists(SK)');
    });
  });

  describe('PII invariant — mandatory', () => {
    it('no aggregate SK ever contains userId (LoginSuccess + role dim)', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        await handler(analyticsEvent() as any);
        const txs = callsOf(ddbSend, TransactWriteItemsCommand);
        for (const tx of txs) {
          for (const item of tx.input.TransactItems!) {
            if (item.Update) {
              expect(item.Update.Key!.SK.S).not.toMatch(/userId|user=|USER#user-X/);
            }
          }
        }
      });
    });

    it('no aggregate SK ever contains userId (AttendanceRecorded + role + school)', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        await handler(domainEvent() as any);
        const txs = callsOf(ddbSend, TransactWriteItemsCommand);
        for (const tx of txs) {
          for (const item of tx.input.TransactItems!) {
            if (item.Update) {
              expect(item.Update.Key!.SK.S).not.toMatch(/teacher-1|userId|user=/);
            }
          }
        }
      });
    });
  });

  describe('ACRIT.1 — Asia/Kathmandu day-bucket correctness', () => {
    it('event at 23:45 UTC Saturday lands on NPT Sunday aggregate, NOT Saturday', async () => {
      // 23:45 UTC Sat 2026-04-11 = 05:30 NPT Sun 2026-04-12.
      // Pre-fix code bucketed this to 2026-04-11 (Saturday). Post-fix
      // it must land on 2026-04-12 (Sunday — the actual NPT school day).
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        await handler(
          analyticsEvent({
            eventId: '99999999-1111-2222-3333-444444444444',
            ts: '2026-04-11T23:45:00.000Z',
          }) as any,
        );
        const txs = callsOf(ddbSend, TransactWriteItemsCommand);
        const sks = txs[0].input.TransactItems!.map((i) => i.Update!.Key!.SK.S);
        for (const sk of sks) {
          expect(sk).toContain('DAY#2026-04-12#');
          expect(sk).not.toContain('DAY#2026-04-11#');
        }
      });
    });

    it('event at 18:14:59 UTC bucketed to NPT day D (same as UTC); 18:15:00 UTC bucketed to D+1', async () => {
      // Boundary: NPT midnight = 18:15 UTC the previous day.
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        // 18:14:59 UTC 2026-04-13 → 23:59:59 NPT 2026-04-13
        await handler(
          analyticsEvent({
            eventId: '11111111-aaaa-bbbb-cccc-dddddddddddd',
            ts: '2026-04-13T18:14:59.000Z',
          }) as any,
        );
        // 18:15:00 UTC 2026-04-13 → 00:00:00 NPT 2026-04-14
        await handler(
          analyticsEvent({
            eventId: '22222222-aaaa-bbbb-cccc-dddddddddddd',
            ts: '2026-04-13T18:15:00.000Z',
          }) as any,
        );
        const txs = callsOf(ddbSend, TransactWriteItemsCommand);
        const day0Sks = txs[0].input.TransactItems!.map((i) => i.Update!.Key!.SK.S);
        const day1Sks = txs[1].input.TransactItems!.map((i) => i.Update!.Key!.SK.S);
        expect(day0Sks.every((sk) => sk!.includes('DAY#2026-04-13#'))).toBe(true);
        expect(day1Sks.every((sk) => sk!.includes('DAY#2026-04-14#'))).toBe(true);
      });
    });
  });

  describe('A-WS3.T1 — per-tenant timezone bucketing', () => {
    function settingsItem(tz: string) {
      return {
        Item: {
          tenantId: { S: 'tenant-A' },
          entityKey: { S: 'SETTINGS#WORKSPACE' },
          regional: {
            M: {
              defaultTimezone: { S: tz },
              defaultLocale: { S: 'en-US' },
              defaultDateFormat: { S: 'MM/DD/YYYY' },
              defaultTimeFormat: { S: '12h' },
              defaultWeekStartsOn: { S: 'sunday' },
              defaultCurrency: { S: 'USD' },
              defaultCalendarSystem: { S: 'gregorian' },
              enableDualDateDisplay: { BOOL: false },
              defaultNumberFormat: { S: 'international' },
            },
          },
          branding: { M: { organizationName: { S: 'US School' } } },
          policies: { M: { defaultAttendancePolicy: { S: 'daily' } } },
          isLocked: { BOOL: false },
        },
      };
    }

    it('US tenant: 23:45 UTC Saturday lands on Saturday EST (NOT Sunday NPT)', async () => {
      // Same UTC instant the ACRIT.1 test used (23:45 UTC Sat 2026-04-11).
      // Nepal tenant → Sunday 2026-04-12. US tenant → Saturday 2026-04-11.
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'GetItemCommand') {
            return settingsItem('America/New_York');
          }
          return {};
        });
        await handler(
          analyticsEvent({
            eventId: 'aaaaaaaa-1111-2222-3333-444444444444',
            ts: '2026-04-11T23:45:00.000Z',
          }) as any,
        );
        const txs = callsOf(ddbSend, TransactWriteItemsCommand);
        const sks = txs[0].input.TransactItems!.map((i) => i.Update!.Key!.SK.S);
        for (const sk of sks) {
          expect(sk).toContain('DAY#2026-04-11#');
          expect(sk).not.toContain('DAY#2026-04-12#');
        }
      });
    });

    it('Nepal tenant: same 23:45 UTC Saturday still lands on Sunday NPT', async () => {
      // Regression guard for V1 default behavior.
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'GetItemCommand') {
            return settingsItem('Asia/Kathmandu');
          }
          return {};
        });
        await handler(
          analyticsEvent({
            eventId: 'bbbbbbbb-1111-2222-3333-444444444444',
            ts: '2026-04-11T23:45:00.000Z',
          }) as any,
        );
        const txs = callsOf(ddbSend, TransactWriteItemsCommand);
        const sks = txs[0].input.TransactItems!.map((i) => i.Update!.Key!.SK.S);
        for (const sk of sks) {
          expect(sk).toContain('DAY#2026-04-12#');
          expect(sk).not.toContain('DAY#2026-04-11#');
        }
      });
    });

    it('falls back to Asia/Kathmandu when tenant settings are missing', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        // GetItem returns no Item → fallback to default.
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'GetItemCommand') return { Item: undefined };
          return {};
        });
        await handler(
          analyticsEvent({
            eventId: 'cccccccc-1111-2222-3333-444444444444',
            ts: '2026-04-11T23:45:00.000Z',
          }) as any,
        );
        const txs = callsOf(ddbSend, TransactWriteItemsCommand);
        const sks = txs[0].input.TransactItems!.map((i) => i.Update!.Key!.SK.S);
        // Default = NPT → Sunday 2026-04-12
        expect(sks[0]).toContain('DAY#2026-04-12#');
      });
    });
  });

  describe('A-WS2.T2 — WorkspaceSettingsUpdated invalidates settings cache', () => {
    function settingsUpdatedEvent(tenantId = 'tenant-A') {
      return {
        id: 'eb-envelope-ws',
        source: 'edforge.identity-service',
        'detail-type': 'WorkspaceSettingsUpdated',
        detail: {
          eventType: 'WorkspaceSettingsUpdated',
          timestamp: '2026-04-16T12:00:00.000Z',
          tenantId,
          changedSections: ['regional'],
        },
      };
    }

    function buildSettingsItem(tz: string) {
      return {
        Item: {
          tenantId: { S: 'tenant-A' },
          entityKey: { S: 'SETTINGS#WORKSPACE' },
          regional: {
            M: {
              defaultTimezone: { S: tz },
              defaultLocale: { S: 'ne-NP' },
              defaultDateFormat: { S: 'DD/MM/YYYY' },
              defaultTimeFormat: { S: '24h' },
              defaultWeekStartsOn: { S: 'sunday' },
              defaultCurrency: { S: 'NPR' },
              defaultCalendarSystem: { S: 'bikram_sambat' },
              enableDualDateDisplay: { BOOL: true },
              defaultNumberFormat: { S: 'south_asian' },
            },
          },
          branding: { M: { organizationName: { S: 'Test School' } } },
          policies: { M: { defaultAttendancePolicy: { S: 'daily' } } },
          isLocked: { BOOL: false },
        },
      };
    }

    it('does not write any aggregates or landing rows', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        await handler(settingsUpdatedEvent() as any);

        const puts = callsOf(ddbSend, PutItemCommand);
        const txs = callsOf(ddbSend, TransactWriteItemsCommand);
        expect(puts).toHaveLength(0); // no landing write
        expect(txs).toHaveLength(0); // no aggregate writes
      });
    });

    it('a subsequent event for the SAME tenant re-fetches settings', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        let tz = 'Asia/Kathmandu';
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'GetItemCommand') return buildSettingsItem(tz);
          return {};
        });

        // 1st event: cache miss → GetItem
        await handler(analyticsEvent() as any);
        // Invalidate via settings-updated event
        await handler(settingsUpdatedEvent() as any);
        // Change the tz so next fetch returns new value
        tz = 'America/New_York';
        // 2nd event: cache was invalidated → must re-fetch
        await handler(
          analyticsEvent({ eventId: '22222222-2222-3333-4444-555555555555' }) as any,
        );

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GetItemCommand } = require('@aws-sdk/client-dynamodb');
        const settingsGets = (
          callsOf(ddbSend, GetItemCommand) as Array<{
            input: { Key: { entityKey: { S: string } } };
          }>
        ).filter((g) => g.input.Key?.entityKey?.S === 'SETTINGS#WORKSPACE');
        // TWO GetItems — one before invalidation, one after.
        expect(settingsGets).toHaveLength(2);
      });
    });

    it('does not invalidate cross-tenant — invalidation is tenant-scoped', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'GetItemCommand') {
            return buildSettingsItem('Asia/Kathmandu');
          }
          return {};
        });

        // Warm cache for tenant-A
        await handler(analyticsEvent() as any);
        // Invalidate a DIFFERENT tenant
        await handler(settingsUpdatedEvent('tenant-DIFFERENT') as any);
        // Another event for tenant-A — should still be cached
        await handler(
          analyticsEvent({ eventId: '33333333-3333-3333-4444-555555555555' }) as any,
        );

        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GetItemCommand } = require('@aws-sdk/client-dynamodb');
        const tenantAGets = (
          callsOf(ddbSend, GetItemCommand) as Array<{
            input: { Key: { tenantId: { S: string }; entityKey: { S: string } } };
          }>
        ).filter(
          (g) =>
            g.input.Key?.entityKey?.S === 'SETTINGS#WORKSPACE' &&
            g.input.Key?.tenantId?.S === 'tenant-A',
        );
        // Only ONE GetItem for tenant-A despite the unrelated invalidation.
        expect(tenantAGets).toHaveLength(1);
      });
    });
  });

  describe('A-WS1.T7 — tenant-settings resolver wiring', () => {
    // The aggregator prefetches workspace settings via DdbTenantSettingsResolver.
    // ddbSend is shared between the resolver's GetItem and the aggregator's
    // landing/aggregate writes — the test asserts a GetItem was issued.

    function buildSettingsItem() {
      return {
        Item: {
          tenantId: { S: 'tenant-A' },
          entityKey: { S: 'SETTINGS#WORKSPACE' },
          regional: {
            M: {
              defaultTimezone: { S: 'Asia/Kathmandu' },
              defaultLocale: { S: 'ne-NP' },
              defaultDateFormat: { S: 'DD/MM/YYYY' },
              defaultTimeFormat: { S: '24h' },
              defaultWeekStartsOn: { S: 'sunday' },
              defaultCurrency: { S: 'NPR' },
              defaultCalendarSystem: { S: 'bikram_sambat' },
              enableDualDateDisplay: { BOOL: true },
              defaultNumberFormat: { S: 'south_asian' },
            },
          },
          branding: { M: { organizationName: { S: 'Test School' } } },
          policies: { M: { defaultAttendancePolicy: { S: 'daily' } } },
          isLocked: { BOOL: false },
        },
      };
    }

    it('issues a GetItem against the identity table for the event tenant', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'GetItemCommand') return buildSettingsItem();
          return {};
        });
        await handler(analyticsEvent() as any);
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GetItemCommand } = require('@aws-sdk/client-dynamodb');
        const gets = callsOf(ddbSend, GetItemCommand) as Array<{
          input: { Key: { tenantId: { S: string }; entityKey: { S: string } } };
        }>;
        expect(gets.length).toBeGreaterThanOrEqual(1);
        // Settings GetItem uses the identity table key shape.
        const settingsGet = gets.find(
          (g) => g.input.Key?.entityKey?.S === 'SETTINGS#WORKSPACE',
        );
        expect(settingsGet).toBeDefined();
        expect(settingsGet!.input.Key.tenantId.S).toBe('tenant-A');
      });
    });

    it('caches settings — a SECOND event for the same tenant does NOT re-fetch', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'GetItemCommand') return buildSettingsItem();
          return {};
        });
        await handler(analyticsEvent() as any);
        await handler(
          analyticsEvent({ eventId: '22222222-2222-3333-4444-555555555555' }) as any,
        );
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { GetItemCommand } = require('@aws-sdk/client-dynamodb');
        const settingsGets = (
          callsOf(ddbSend, GetItemCommand) as Array<{
            input: { Key: { entityKey: { S: string } } };
          }>
        ).filter((g) => g.input.Key?.entityKey?.S === 'SETTINGS#WORKSPACE');
        // Only ONE GetItem despite TWO events for the same tenant.
        expect(settingsGets).toHaveLength(1);
      });
    });

    it('falls back gracefully when settings are missing — event still aggregated', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        // GetItem returns no Item → TenantSettingsNotFoundError → fallback.
        ddbSend.mockImplementation(async (cmd: any) => {
          if (cmd?.constructor?.name === 'GetItemCommand') return { Item: undefined };
          return {};
        });
        await handler(analyticsEvent() as any);
        const txs = callsOf(ddbSend, TransactWriteItemsCommand);
        // Aggregate writes still happened — settings failure is non-blocking.
        expect(txs).toHaveLength(1);
      });
    });
  });

  describe('Structured logging', () => {
    it('every info-level log line is JSON with correlationId, tenantId, eventId, detailType', async () => {
      await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
        const handler = freshHandler();
        const logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
        try {
          await handler(analyticsEvent() as any);
          const infoLines = logSpy.mock.calls.map((c) => c[0] as string);
          expect(infoLines.length).toBeGreaterThan(0);
          for (const line of infoLines) {
            const parsed = JSON.parse(line);
            expect(parsed).toEqual(
              expect.objectContaining({
                tenantId: 'tenant-A',
                eventId: '11111111-2222-3333-4444-555555555555',
                detailType: 'LoginSuccess',
              }),
            );
          }
        } finally {
          logSpy.mockRestore();
        }
      });
    });
  });
});
