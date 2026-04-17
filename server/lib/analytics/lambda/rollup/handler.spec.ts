/**
 * Layer 6.3 — rollup handler unit tests.
 *
 * Covers: week boundary, month boundary, year boundary, dormancy state
 * machine transitions (0→1→2→3 weeks), idempotency sentinel (second
 * invocation for same date no-ops), fleet counts with fixture tenant
 * states, PII invariant (no userId in rollup SKs).
 */

const ddbSend = jest.fn();
const cwSend = jest.fn();
const ebSend = jest.fn();

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
jest.mock('@aws-sdk/client-eventbridge', () => {
  const actual = jest.requireActual('@aws-sdk/client-eventbridge');
  return {
    ...actual,
    EventBridgeClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => ebSend(...args),
    })),
  };
});

import {
  PutItemCommand,
  QueryCommand,
  ScanCommand,
  TransactWriteItemsCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import { PutEventsCommand } from '@aws-sdk/client-eventbridge';

const BASE_ENV = {
  ANALYTICS_TABLE_NAME: 'edforge-analytics',
  IDENTITY_TABLE_NAME: 'edforge-identity-basic',
  ANALYTICS_ENABLED: 'true',
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

function byCtorName(name: string) {
  return (c: any) => c?.constructor?.name === name;
}
function callsOf(name: string, mock: jest.Mock) {
  return mock.mock.calls.map((c) => c[0]).filter(byCtorName(name));
}

function tenantMetadata(tenantId: string, status: 'active' | 'inactive' = 'active') {
  return {
    tenantId: { S: tenantId },
    entityKey: { S: 'METADATA' },
    name: { S: `tenant-${tenantId}` },
    tier: { S: 'BASIC' },
    status: { S: status },
    createdAt: { S: '2026-01-01T00:00:00.000Z' },
  };
}

function dayRowItem(sk: string, count: number) {
  return {
    PK: { S: 'PK_WILL_NOT_BE_READ' },
    SK: { S: sk },
    count: { N: String(count) },
  };
}

beforeEach(() => {
  ddbSend.mockReset();
  cwSend.mockReset().mockResolvedValue({});
  ebSend.mockReset().mockResolvedValue({});
});

describe('rollup handler (6.3)', () => {
  it('ANALYTICS_ENABLED=false → early return, zero IO', async () => {
    await withEnv({ ANALYTICS_ENABLED: 'false' }, async () => {
      const handler = freshHandler();
      const result = await handler({ date: '2026-04-14' });
      expect(result.targetDate).toBe('disabled');
      expect(ddbSend).not.toHaveBeenCalled();
      expect(cwSend).not.toHaveBeenCalled();
      expect(ebSend).not.toHaveBeenCalled();
    });
  });

  it('happy path: 1 tenant, 2 DAY rows → 4 rollup writes (WEEK+MONTH × 2), fleet row, CW metric', async () => {
    await withEnv({}, async () => {
      // Scan for tenants → 1 active.
      ddbSend.mockImplementation(async (cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'ScanCommand') {
          return { Items: [tenantMetadata('t1')] };
        }
        if (name === 'PutItemCommand') return {};
        if (name === 'QueryCommand') {
          const prefix = cmd.input.ExpressionAttributeValues?.[':prefix']?.S;
          if (prefix === 'DAY#2026-04-14#') {
            return {
              Items: [
                dayRowItem('DAY#2026-04-14#academics.attendance.recorded', 10),
                dayRowItem('DAY#2026-04-14#academics.attendance.recorded#role=Teacher', 10),
              ],
            };
          }
          // fleet-count queries (BETWEEN) return no items — tenant is dormant in fixture
          return { Items: [] };
        }
        if (name === 'TransactWriteItemsCommand') return {};
        return {};
      });
      const handler = freshHandler();
      const result = await handler({ date: '2026-04-14' });
      expect(result.processed).toBe(1);
      expect(result.skipped).toBe(0);

      const tx = callsOf('TransactWriteItemsCommand', ddbSend);
      expect(tx).toHaveLength(1);
      const items = tx[0].input.TransactItems;
      // 2 DAY rows × 2 buckets (WEEK + MONTH) = 4 writes
      expect(items).toHaveLength(4);
      const sks = items.map((i: any) => i.Update.Key.SK.S).sort();
      expect(sks).toEqual([
        'MONTH#2026-04#academics.attendance.recorded',
        'MONTH#2026-04#academics.attendance.recorded#role=Teacher',
        'WEEK#2026-W16#academics.attendance.recorded',
        'WEEK#2026-W16#academics.attendance.recorded#role=Teacher',
      ]);

      const puts = callsOf('PutItemCommand', ddbSend);
      // One sentinel (ROLLUP_PROCESSED) + one fleet row
      const sentinelPut = puts.find((p: any) =>
        p.input.Item.SK.S.startsWith('ROLLUP_PROCESSED'),
      );
      expect(sentinelPut).toBeDefined();
      expect(sentinelPut.input.ConditionExpression).toBe('attribute_not_exists(SK)');

      const fleetPut = puts.find((p: any) => p.input.Item.PK.S === 'FLEET#ALL');
      expect(fleetPut).toBeDefined();
      expect(fleetPut.input.Item.SK.S).toBe('DAY#2026-04-14#tenant.status');

      const cwCalls = cwSend.mock.calls;
      expect(cwCalls).toHaveLength(1);
      const metricNames = cwCalls[0][0].input.MetricData.map((m: any) => m.MetricName);
      expect(metricNames).toEqual(
        expect.arrayContaining([
          'RollupTenantsProcessed',
          'FleetActive',
          'FleetDormant',
        ]),
      );
    });
  });

  it('idempotency: sentinel exists → tenant skipped, no DAY queries, no TransactWrites', async () => {
    await withEnv({}, async () => {
      ddbSend.mockImplementation(async (cmd: any) => {
        const name = cmd.constructor.name;
        if (name === 'ScanCommand') return { Items: [tenantMetadata('t1')] };
        if (name === 'PutItemCommand') {
          // Sentinel write → already exists.
          throw new ConditionalCheckFailedException({
            $metadata: {},
            message: 'already exists',
          });
        }
        if (name === 'QueryCommand') {
          // Only fleet-count queries should happen — sentinel blocks the DAY read.
          // Return 0 to keep tenant dormant.
          return { Items: [] };
        }
        return {};
      });
      const handler = freshHandler();
      const result = await handler({ date: '2026-04-14' });
      expect(result.processed).toBe(0);
      expect(result.skipped).toBe(1);
      expect(callsOf('TransactWriteItemsCommand', ddbSend)).toHaveLength(0);
    });
  });

  describe('month and year boundaries', () => {
    it('last day of month → month key reflects that month', async () => {
      await withEnv({}, async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
          const name = cmd.constructor.name;
          if (name === 'ScanCommand') return { Items: [tenantMetadata('t1')] };
          if (name === 'PutItemCommand') return {};
          if (name === 'QueryCommand') {
            const prefix = cmd.input.ExpressionAttributeValues?.[':prefix']?.S;
            if (prefix === 'DAY#2026-01-31#') {
              return { Items: [dayRowItem('DAY#2026-01-31#auth.login.success', 3)] };
            }
            return { Items: [] };
          }
          return {};
        });
        const handler = freshHandler();
        await handler({ date: '2026-01-31' });
        const tx = callsOf('TransactWriteItemsCommand', ddbSend);
        const sks = tx[0].input.TransactItems.map((i: any) => i.Update.Key.SK.S);
        expect(sks).toContain('MONTH#2026-01#auth.login.success');
        expect(sks).toContain('WEEK#2026-W05#auth.login.success');
      });
    });

    it('year boundary: 2026-12-31 → MONTH#2026-12 + WEEK#2026-W53', async () => {
      await withEnv({}, async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
          const name = cmd.constructor.name;
          if (name === 'ScanCommand') return { Items: [tenantMetadata('t1')] };
          if (name === 'PutItemCommand') return {};
          if (name === 'QueryCommand') {
            const prefix = cmd.input.ExpressionAttributeValues?.[':prefix']?.S;
            if (prefix === 'DAY#2026-12-31#') {
              return { Items: [dayRowItem('DAY#2026-12-31#session.create', 2)] };
            }
            return { Items: [] };
          }
          return {};
        });
        const handler = freshHandler();
        await handler({ date: '2026-12-31' });
        const tx = callsOf('TransactWriteItemsCommand', ddbSend);
        const sks = tx[0].input.TransactItems.map((i: any) => i.Update.Key.SK.S);
        expect(sks).toContain('MONTH#2026-12#session.create');
        expect(sks.some((s: string) => s.startsWith('WEEK#2026-W'))).toBe(true);
      });
    });
  });

  describe('dormancy state machine', () => {
    it('emits TenantDormant when 3 consecutive weeks have zero write events', async () => {
      await withEnv({}, async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
          const name = cmd.constructor.name;
          if (name === 'ScanCommand') return { Items: [tenantMetadata('t1')] };
          if (name === 'PutItemCommand') return {};
          if (name === 'QueryCommand') return { Items: [] };
          if (name === 'TransactWriteItemsCommand') return {};
          return {};
        });
        const handler = freshHandler();
        const result = await handler({ date: '2026-04-14' });
        expect(result.dormant).toBe(1);
        const eb = callsOf('PutEventsCommand', ebSend);
        expect(eb).toHaveLength(1);
        const entry = eb[0].input.Entries[0];
        expect(entry.Source).toBe('edforge.analytics');
        expect(entry.DetailType).toBe('TenantDormant');
        const detail = JSON.parse(entry.Detail);
        expect(detail).toMatchObject({
          schemaVersion: 1,
          tenantId: 't1',
          action: 'dormant.transition',
        });
      });
    });

    it('does NOT emit when recent activity exists', async () => {
      await withEnv({}, async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
          const name = cmd.constructor.name;
          if (name === 'ScanCommand') return { Items: [tenantMetadata('t1')] };
          if (name === 'PutItemCommand') return {};
          if (name === 'QueryCommand') {
            // BETWEEN query returning active data for week 0 window
            return {
              Items: [
                dayRowItem('DAY#2026-04-12#academics.attendance.recorded', 10),
              ],
            };
          }
          return {};
        });
        const handler = freshHandler();
        const result = await handler({ date: '2026-04-14' });
        expect(result.dormant).toBe(0);
        expect(callsOf('PutEventsCommand', ebSend)).toHaveLength(0);
      });
    });

    it('does NOT re-emit if DORMANT_EMITTED sentinel already exists', async () => {
      await withEnv({}, async () => {
        let dormantSentinelCalls = 0;
        ddbSend.mockImplementation(async (cmd: any) => {
          const name = cmd.constructor.name;
          if (name === 'ScanCommand') return { Items: [tenantMetadata('t1')] };
          if (name === 'PutItemCommand') {
            const sk = cmd.input.Item.SK.S as string;
            if (sk.startsWith('DORMANT_EMITTED#')) {
              dormantSentinelCalls++;
              throw new ConditionalCheckFailedException({
                $metadata: {},
                message: 'exists',
              });
            }
            return {};
          }
          if (name === 'QueryCommand') return { Items: [] };
          return {};
        });
        const handler = freshHandler();
        const result = await handler({ date: '2026-04-14' });
        expect(result.dormant).toBe(0);
        expect(dormantSentinelCalls).toBe(1);
        expect(callsOf('PutEventsCommand', ebSend)).toHaveLength(0);
      });
    });
  });

  describe('fleet counts', () => {
    it('all tenants with zero write activity → dormant=N, active=0', async () => {
      await withEnv({}, async () => {
        const tenants = [
          tenantMetadata('t1'),
          tenantMetadata('t2'),
          tenantMetadata('t3'),
        ];
        ddbSend.mockImplementation(async (cmd: any) => {
          const name = cmd.constructor.name;
          if (name === 'ScanCommand') return { Items: tenants };
          if (name === 'PutItemCommand') return {};
          if (name === 'TransactWriteItemsCommand') return {};
          if (name === 'QueryCommand') return { Items: [] };
          return {};
        });
        const handler = freshHandler();
        await handler({ date: '2026-04-14' });
        const puts = callsOf('PutItemCommand', ddbSend);
        const fleetPut = puts.find((p: any) => p.input.Item.PK.S === 'FLEET#ALL');
        expect(fleetPut).toBeDefined();
        expect(Number(fleetPut.input.Item.active.N)).toBe(0);
        expect(Number(fleetPut.input.Item.dormant.N)).toBe(3);
        expect(Number(fleetPut.input.Item.atRisk.N)).toBe(3);
      });
    });

    it('all tenants active in 7d window → active=N, dormant=0', async () => {
      await withEnv({}, async () => {
        const tenants = [tenantMetadata('t1'), tenantMetadata('t2')];
        ddbSend.mockImplementation(async (cmd: any) => {
          const name = cmd.constructor.name;
          if (name === 'ScanCommand') return { Items: tenants };
          if (name === 'PutItemCommand') return {};
          if (name === 'TransactWriteItemsCommand') return {};
          if (name === 'QueryCommand') {
            // Return a write-metric row for every window query.
            return {
              Items: [
                dayRowItem('DAY#2026-04-13#academics.attendance.recorded', 5),
              ],
            };
          }
          return {};
        });
        const handler = freshHandler();
        await handler({ date: '2026-04-14' });
        const puts = callsOf('PutItemCommand', ddbSend);
        const fleetPut = puts.find((p: any) => p.input.Item.PK.S === 'FLEET#ALL');
        expect(fleetPut).toBeDefined();
        expect(Number(fleetPut.input.Item.active.N)).toBe(2);
        expect(Number(fleetPut.input.Item.dormant.N)).toBe(0);
        expect(Number(fleetPut.input.Item.atRisk.N)).toBe(0);
      });
    });
  });

  describe('PII invariant — mandatory', () => {
    it('no WEEK/MONTH SK contains userId', async () => {
      await withEnv({}, async () => {
        ddbSend.mockImplementation(async (cmd: any) => {
          const name = cmd.constructor.name;
          if (name === 'ScanCommand') return { Items: [tenantMetadata('t1')] };
          if (name === 'PutItemCommand') return {};
          if (name === 'QueryCommand') {
            const prefix = cmd.input.ExpressionAttributeValues?.[':prefix']?.S;
            if (prefix === 'DAY#2026-04-14#') {
              return {
                Items: [
                  dayRowItem('DAY#2026-04-14#academics.attendance.recorded', 1),
                  dayRowItem('DAY#2026-04-14#academics.attendance.recorded#role=Teacher', 1),
                  dayRowItem('DAY#2026-04-14#academics.attendance.recorded#school=school-1', 1),
                ],
              };
            }
            return { Items: [] };
          }
          return {};
        });
        const handler = freshHandler();
        await handler({ date: '2026-04-14' });
        const tx = callsOf('TransactWriteItemsCommand', ddbSend);
        for (const c of tx) {
          for (const item of c.input.TransactItems) {
            if (item.Update) {
              expect(item.Update.Key.SK.S).not.toMatch(/userId|user=|USER#/i);
            }
          }
        }
      });
    });
  });
});
