/**
 * reporting-scheduler handler unit tests — Sprint E.1.6
 *
 * Covers:
 *   - REPORTING_SCHEDULER_ENABLED=false → no-op
 *   - enumerator failure → returns zeros, does not throw
 *   - per-tenant query → publishes one metric data point per tenant
 *   - pagination — handles LastEvaluatedKey
 *   - per-tenant query failure → continues with next tenant
 */

const ddbSend = jest.fn();
const cwSend = jest.fn();

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

const mockEnumerate = jest.fn();
jest.mock('../shared/tenant-enumerator', () => ({
  enumerateActiveTenants: (...args: unknown[]) => mockEnumerate(...args),
}));

import { QueryCommand } from '@aws-sdk/client-dynamodb';
import { PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AWS_REGION = 'ap-south-1';
  process.env.IDENTITY_TABLE_NAME = 'edforge-identity-basic';
  delete process.env.REPORTING_SCHEDULER_ENABLED;
});

afterEach(() => {
  jest.resetModules();
});

describe('reporting-scheduler', () => {
  it('disabled via env → returns zeros, no DDB / CW calls', async () => {
    process.env.REPORTING_SCHEDULER_ENABLED = 'false';
    const { handler } = await import('./handler');
    const result = await handler();
    expect(result).toEqual({ tenants: 0, pendingTotal: 0 });
    expect(ddbSend).not.toHaveBeenCalled();
    expect(cwSend).not.toHaveBeenCalled();
  });

  it('enumerator failure → returns zeros, does not throw', async () => {
    mockEnumerate.mockRejectedValueOnce(new Error('boom'));
    const { handler } = await import('./handler');
    const result = await handler();
    expect(result).toEqual({ tenants: 0, pendingTotal: 0 });
  });

  it('happy path — one tenant, two pending snapshots → publishes one metric', async () => {
    mockEnumerate.mockResolvedValueOnce([
      { tenantId: 't1', name: 'Tenant 1', tier: 'basic', status: 'active', provisionedAt: '2026-01-01' },
    ]);
    ddbSend.mockResolvedValueOnce({
      Items: [{ snapshotId: { S: 'a' } }, { snapshotId: { S: 'b' } }],
    });
    cwSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    const result = await handler();

    expect(result).toEqual({ tenants: 1, pendingTotal: 2 });
    expect(cwSend).toHaveBeenCalledTimes(1);
    const cwCall = cwSend.mock.calls[0]?.[0] as PutMetricDataCommand;
    expect(cwCall.input.Namespace).toBe('Edforge/Reporting');
    expect(cwCall.input.MetricData![0].MetricName).toBe('SnapshotsPendingSubmission');
    expect(cwCall.input.MetricData![0].Value).toBe(2);
    expect(cwCall.input.MetricData![0].Dimensions![0]).toEqual({ Name: 'TenantId', Value: 't1' });
  });

  it('paginated Query → totals across pages', async () => {
    mockEnumerate.mockResolvedValueOnce([
      { tenantId: 't1', name: 'Tenant 1', tier: 'basic', status: 'active', provisionedAt: '2026-01-01' },
    ]);
    ddbSend
      .mockResolvedValueOnce({
        Items: [{ snapshotId: { S: 'a' } }],
        LastEvaluatedKey: { tenantId: { S: 'k' } },
      })
      .mockResolvedValueOnce({
        Items: [{ snapshotId: { S: 'b' } }, { snapshotId: { S: 'c' } }],
      });
    cwSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    const result = await handler();

    expect(result.pendingTotal).toBe(3);
    expect(ddbSend).toHaveBeenCalledTimes(2);
    // Second call carries ExclusiveStartKey
    const secondQuery = ddbSend.mock.calls[1]?.[0] as QueryCommand;
    expect(secondQuery.input.ExclusiveStartKey).toEqual({ tenantId: { S: 'k' } });
  });

  it('one tenant fails to query → continues with the rest', async () => {
    mockEnumerate.mockResolvedValueOnce([
      { tenantId: 't1', name: 'a', tier: 'basic', status: 'active', provisionedAt: '2026-01-01' },
      { tenantId: 't2', name: 'b', tier: 'basic', status: 'active', provisionedAt: '2026-01-01' },
    ]);
    ddbSend
      .mockRejectedValueOnce(new Error('throttled'))
      .mockResolvedValueOnce({ Items: [{ snapshotId: { S: 'x' } }] });
    cwSend.mockResolvedValue({});

    const { handler } = await import('./handler');
    const result = await handler();

    expect(result.tenants).toBe(2);
    expect(result.pendingTotal).toBe(1);
    // Only one metric publish (the second tenant's; first tenant errored before the publish call)
    expect(cwSend).toHaveBeenCalledTimes(1);
  });
});
