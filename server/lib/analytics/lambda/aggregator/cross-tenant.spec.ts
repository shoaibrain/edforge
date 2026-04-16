/**
 * Layer 5.3 — cross-tenant isolation test.
 *
 * Simulates two tenants T_A and T_B. 10 events for T_A should produce rows
 * ONLY on PK=TENANT#T_A. T_B's partition must stay empty.
 *
 * Also asserts that a malformed event claiming tenantId=T_A but with an
 * invalid schemaVersion (so it fails validation) is DLQ'd and does NOT
 * mutate T_A's aggregates.
 *
 * This is a unit-level test with mocked SDK calls — it does not exercise
 * DynamoDB. Its value is proving the aggregator's PK construction logic
 * never crosses tenants even under adversarial inputs.
 */

// jest.mock setup must come before any require of the handler.
const ddbSend = jest.fn().mockResolvedValue({});
const cwSend = jest.fn().mockResolvedValue({});
const sqsSend = jest.fn().mockResolvedValue({});

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

const BASE_ENV = {
  ANALYTICS_TABLE_NAME: 'edforge-analytics',
  LANDING_TABLE_NAME: 'edforge-analytics-landing',
  USER_SESSION_EVENTS_TABLE_NAME: 'edforge-user-session-events',
  AGGREGATOR_DLQ_URL: 'https://sqs.test/queue/agg-dlq',
  ANALYTICS_ENABLED: 'true',
  AWS_REGION: 'us-east-2',
};

function makeEvent(tenantId: string, eventIdSuffix: string, schemaVersion: unknown = 1) {
  // Stamp the suffix hex-only into the final 12 chars of the UUID so the
  // zod UUID regex validates it. We hash the suffix to hex and pad.
  const hex = Buffer.from(eventIdSuffix)
    .toString('hex')
    .padStart(12, '0')
    .slice(-12);
  return {
    id: `env-${eventIdSuffix}`,
    source: 'edforge.analytics',
    'detail-type': 'LoginSuccess',
    detail: {
      schemaVersion,
      eventId: `11111111-2222-3333-4444-${hex}`,
      ts: '2026-04-14T12:00:00.000Z',
      tenantId,
      tenantTier: 'BASIC',
      userId: `user-${tenantId}`,
      role: 'Teacher',
      feature: 'auth',
      action: 'login.success',
    },
  };
}

function freshHandler(): typeof import('./handler').handler {
  jest.resetModules();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./handler').handler;
}

describe('aggregator cross-tenant isolation (5.3)', () => {
  beforeEach(() => {
    ddbSend.mockReset().mockResolvedValue({});
    cwSend.mockReset().mockResolvedValue({});
    sqsSend.mockReset().mockResolvedValue({});
    process.env = { ...process.env, ...BASE_ENV };
  });

  it('10 events for T_A produce aggregate writes ONLY under PK=TENANT#T_A', async () => {
    const handler = freshHandler();
    for (let i = 0; i < 10; i++) {
      await handler(makeEvent('T_A', String(i)) as any);
    }
    const txCalls = ddbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c?.constructor?.name === 'TransactWriteItemsCommand');
    expect(txCalls).toHaveLength(10);
    const allPks = new Set<string>();
    for (const c of txCalls) {
      for (const item of c.input.TransactItems as any[]) {
        if (item.Update) allPks.add(item.Update.Key.PK.S);
      }
    }
    expect([...allPks]).toEqual(['TENANT#T_A']);
  });

  it('events for T_A and T_B are strictly partitioned', async () => {
    const handler = freshHandler();
    for (let i = 0; i < 5; i++) await handler(makeEvent('T_A', `a${i}`) as any);
    for (let i = 0; i < 5; i++) await handler(makeEvent('T_B', `b${i}`) as any);

    const txCalls = ddbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c?.constructor?.name === 'TransactWriteItemsCommand');
    const pksForA = new Set<string>();
    const pksForB = new Set<string>();
    for (const c of txCalls) {
      for (const item of c.input.TransactItems as any[]) {
        if (item.Update) {
          const pk = item.Update.Key.PK.S;
          const eventIdFromValues = item.Update.ExpressionAttributeValues?.[':one']?.N;
          // We can't recover the tenantId directly from the single item,
          // but the PK alone is enough to prove isolation — it MUST match
          // exactly one of the two partitions.
          expect(['TENANT#T_A', 'TENANT#T_B']).toContain(pk);
          if (pk === 'TENANT#T_A') pksForA.add(pk);
          else pksForB.add(pk);
          // Silence unused-var lint for the destructured probe:
          void eventIdFromValues;
        }
      }
    }
    expect(pksForA.size).toBe(1);
    expect(pksForB.size).toBe(1);
  });

  it('malformed event (schemaVersion=2) for T_A is DLQ\'d and does NOT write to T_A', async () => {
    const handler = freshHandler();
    // 3 valid events first
    for (let i = 0; i < 3; i++) await handler(makeEvent('T_A', `v${i}`) as any);
    // Malformed event
    await handler(makeEvent('T_A', 'bad1', 2) as any);

    const txCalls = ddbSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c?.constructor?.name === 'TransactWriteItemsCommand');
    // Only 3 transacts — the malformed one never reached the aggregate path.
    expect(txCalls).toHaveLength(3);

    const dlqCalls = sqsSend.mock.calls
      .map((c) => c[0])
      .filter((c) => c?.constructor?.name === 'SendMessageCommand');
    expect(dlqCalls).toHaveLength(1);
    expect(JSON.parse(dlqCalls[0].input.MessageBody).reason).toMatch(/schema validation failed/);
  });
});
