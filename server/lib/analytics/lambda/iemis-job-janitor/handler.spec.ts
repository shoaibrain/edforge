/**
 * iemis-job-janitor handler unit tests.
 *
 * Covers:
 *   - empty scan (nothing to sweep) — does not publish SNS
 *   - one orphan, successful conditional update — publishes SNS summary
 *   - multiple orphans across multiple tenants — paginated scan
 *   - ConditionalCheckFailedException — counts as `conditionalSkips`, not error
 *   - generic DDB error during update — recorded in errors, alert still sent
 *   - missing env vars — handler throws (configuration error)
 *   - stale cutoff math — items with createdAt newer than cutoff are excluded by FilterExpression
 *     (sanity check on the FilterExpression / not on the SDK behavior)
 */

const ddbDocSend = jest.fn();
const snsSend = jest.fn();

jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({})),
  };
});

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...actual,
    DynamoDBDocumentClient: {
      from: jest.fn().mockImplementation(() => ({
        send: (...args: unknown[]) => ddbDocSend(...args),
      })),
    },
  };
});

jest.mock('@aws-sdk/client-sns', () => {
  const actual = jest.requireActual('@aws-sdk/client-sns');
  return {
    ...actual,
    SNSClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => snsSend(...args),
    })),
  };
});

import type {
  ScanCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { PublishCommand } from '@aws-sdk/client-sns';

const ENV = {
  ACADEMICS_TABLE_NAME: 'edforge-academics-basic',
  ALERT_TOPIC_ARN:
    'arn:aws:sns:ap-south-1:257526644020:edforge-alerts-operator',
  STALE_THRESHOLD_MIN: '30',
};

beforeEach(() => {
  jest.resetAllMocks();
  process.env.ACADEMICS_TABLE_NAME = ENV.ACADEMICS_TABLE_NAME;
  process.env.ALERT_TOPIC_ARN = ENV.ALERT_TOPIC_ARN;
  process.env.STALE_THRESHOLD_MIN = ENV.STALE_THRESHOLD_MIN;
});

afterEach(() => {
  jest.resetModules();
});

// =============================================================================

describe('iemis-job-janitor handler', () => {
  it('returns zero counts and does NOT publish SNS when no orphans found', async () => {
    ddbDocSend.mockResolvedValueOnce({ Items: [] });

    const { handler } = await import('./handler');
    const result = await handler();

    expect(result).toEqual({
      scanned: 0,
      marked: 0,
      conditionalSkips: 0,
      errors: [],
    });
    expect(snsSend).not.toHaveBeenCalled();
    expect(ddbDocSend).toHaveBeenCalledTimes(1);
    const scanCall = ddbDocSend.mock.calls[0][0];
    expect(scanCall.constructor.name).toBe('ScanCommand');
  });

  it('marks one orphan failed and publishes SNS summary', async () => {
    ddbDocSend
      .mockResolvedValueOnce({
        Items: [
          {
            tenantId: '21aea5da-511f-4dfa-a6f2-6971f63a719f',
            entityKey:
              'IEMIS_IMPORT_JOB#9abdfc8f-f3a7-4364-b548-69d0953d3000',
            jobId: '9abdfc8f-f3a7-4364-b548-69d0953d3000',
            schoolId: '4209e3d8-d2e2-4e0e-9961-790341c264f4',
            createdAt: '2026-05-12T10:00:00.000Z',
            startedAt: '2026-05-12T10:00:01.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({});
    snsSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    const result = await handler();

    expect(result).toEqual({
      scanned: 1,
      marked: 1,
      conditionalSkips: 0,
      errors: [],
    });

    const updateCall = ddbDocSend.mock.calls[1][0];
    expect(updateCall.constructor.name).toBe('UpdateCommand');
    expect((updateCall as UpdateCommand).input.ConditionExpression).toBe(
      '#status = :running',
    );
    expect((updateCall as UpdateCommand).input.UpdateExpression).toContain(
      ':failed',
    );

    expect(snsSend).toHaveBeenCalledTimes(1);
    const publishCall = snsSend.mock.calls[0][0];
    expect(publishCall.constructor.name).toBe('PublishCommand');
    expect((publishCall as PublishCommand).input.Subject).toContain('1 orphan');
  });

  it('paginates Scan when LastEvaluatedKey is set', async () => {
    ddbDocSend
      .mockResolvedValueOnce({
        Items: [
          {
            tenantId: 'tenant-a',
            entityKey: 'IEMIS_IMPORT_JOB#job-a',
            jobId: 'job-a',
            createdAt: '2026-05-12T10:00:00.000Z',
          },
        ],
        LastEvaluatedKey: { tenantId: 'tenant-a', entityKey: 'IEMIS_IMPORT_JOB#job-a' },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            tenantId: 'tenant-b',
            entityKey: 'IEMIS_IMPORT_JOB#job-b',
            jobId: 'job-b',
            createdAt: '2026-05-12T10:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({}) // update for orphan a
      .mockResolvedValueOnce({}); // update for orphan b
    snsSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    const result = await handler();

    expect(result.scanned).toBe(2);
    expect(result.marked).toBe(2);

    // 2 scan pages + 2 updates = 4 DDB calls
    expect(ddbDocSend).toHaveBeenCalledTimes(4);
    const secondScan = ddbDocSend.mock.calls[1][0] as ScanCommand;
    expect(secondScan.input.ExclusiveStartKey).toEqual({
      tenantId: 'tenant-a',
      entityKey: 'IEMIS_IMPORT_JOB#job-a',
    });
  });

  it('treats ConditionalCheckFailedException as a skip, not an error', async () => {
    const condErr = Object.assign(new Error('Conditional check failed'), {
      name: 'ConditionalCheckFailedException',
    });

    ddbDocSend
      .mockResolvedValueOnce({
        Items: [
          {
            tenantId: 'tenant-a',
            entityKey: 'IEMIS_IMPORT_JOB#raced',
            jobId: 'raced',
            createdAt: '2026-05-12T10:00:00.000Z',
          },
        ],
      })
      .mockRejectedValueOnce(condErr);

    const { handler } = await import('./handler');
    const result = await handler();

    expect(result).toEqual({
      scanned: 1,
      marked: 0,
      conditionalSkips: 1,
      errors: [],
    });
    // No SNS publish — neither marked nor errored
    expect(snsSend).not.toHaveBeenCalled();
  });

  it('records generic UpdateItem errors and STILL publishes SNS so operator sees the failure', async () => {
    const ddbErr = Object.assign(new Error('ThrottlingException'), {
      name: 'ProvisionedThroughputExceededException',
    });

    ddbDocSend
      .mockResolvedValueOnce({
        Items: [
          {
            tenantId: 'tenant-a',
            entityKey: 'IEMIS_IMPORT_JOB#failing',
            jobId: 'failing',
            createdAt: '2026-05-12T10:00:00.000Z',
          },
        ],
      })
      .mockRejectedValueOnce(ddbErr);
    snsSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    const result = await handler();

    expect(result.scanned).toBe(1);
    expect(result.marked).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({
      tenantId: 'tenant-a',
      entityKey: 'IEMIS_IMPORT_JOB#failing',
      message: 'ThrottlingException',
    });

    // Errors-only path still publishes the alert
    expect(snsSend).toHaveBeenCalledTimes(1);
    const publishCall = snsSend.mock.calls[0][0] as PublishCommand;
    expect(publishCall.input.Subject).toContain('error');
  });

  it('throws when ACADEMICS_TABLE_NAME is not set', async () => {
    delete process.env.ACADEMICS_TABLE_NAME;
    const { handler } = await import('./handler');
    await expect(handler()).rejects.toThrow(
      'ACADEMICS_TABLE_NAME env var is required',
    );
  });

  it('throws when ALERT_TOPIC_ARN is not set', async () => {
    delete process.env.ALERT_TOPIC_ARN;
    const { handler } = await import('./handler');
    await expect(handler()).rejects.toThrow(
      'ALERT_TOPIC_ARN env var is required',
    );
  });

  it('Scan FilterExpression carries the correct IEMIS_IMPORT_JOB entity type and running status', async () => {
    ddbDocSend.mockResolvedValueOnce({ Items: [] });

    const { handler } = await import('./handler');
    await handler();

    const scanCall = ddbDocSend.mock.calls[0][0] as ScanCommand;
    expect(scanCall.input.FilterExpression).toBe(
      'entityType = :et AND #status = :running AND createdAt < :cutoff',
    );
    expect(scanCall.input.ExpressionAttributeValues).toMatchObject({
      ':et': 'IEMIS_IMPORT_JOB',
      ':running': 'running',
    });
    // cutoff is computed at handler runtime, just sanity-check the shape
    expect(
      scanCall.input.ExpressionAttributeValues?.[':cutoff'],
    ).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});
