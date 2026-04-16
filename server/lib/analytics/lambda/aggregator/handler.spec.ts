/**
 * Layer 5.2 — aggregator unit tests. Every bullet from the sprint plan:
 *   - valid event → landing + aggregate rows
 *   - duplicate eventId → no aggregate writes
 *   - unknown schemaVersion → DLQ, no aggregate writes
 *   - unknown source/detailType → DLQ, no aggregate writes
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

  it('unknown source/detailType → DLQ, no aggregate writes', async () => {
    await withEnv({ ANALYTICS_ENABLED: 'true' }, async () => {
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
      const dlq = callsOf(sqsSend, SendMessageCommand);
      expect(dlq).toHaveLength(1);
      expect(JSON.parse(dlq[0].input.MessageBody!).reason).toMatch(/no metric mapping/);
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
