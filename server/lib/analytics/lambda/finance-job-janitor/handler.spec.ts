/**
 * finance-job-janitor handler unit tests.
 *
 * Mirrors iemis-job-janitor/handler.spec.ts shape:
 *   - empty scan (nothing to sweep) — does not publish SNS
 *   - one orphan, successful conditional update — publishes SNS summary
 *   - multiple orphans across multiple tenants — paginated scan
 *   - ConditionalCheckFailedException — counts as `conditionalSkips`, not error
 *   - generic DDB error during update — recorded in errors, alert still sent
 *   - missing env vars — handler throws (configuration error)
 *   - Scan FilterExpression carries FINANCE_JOB entity type and running status
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

import type { ScanCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { PublishCommand } from '@aws-sdk/client-sns';

const ENV = {
  FINANCE_TABLE_NAME: 'edforge-finance-basic',
  ALERT_TOPIC_ARN:
    'arn:aws:sns:ap-south-1:257526644020:edforge-alerts-operator',
  STALE_THRESHOLD_MIN: '60',
};

beforeEach(() => {
  jest.resetAllMocks();
  process.env.FINANCE_TABLE_NAME = ENV.FINANCE_TABLE_NAME;
  process.env.ALERT_TOPIC_ARN = ENV.ALERT_TOPIC_ARN;
  process.env.STALE_THRESHOLD_MIN = ENV.STALE_THRESHOLD_MIN;
});

afterEach(() => {
  jest.resetModules();
});

// =============================================================================

describe('finance-job-janitor handler', () => {
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
            entityKey: 'FINANCE_JOB#f238181f-ec65-4b8c-a655-4ef9ffc06453',
            jobId: 'f238181f-ec65-4b8c-a655-4ef9ffc06453',
            jobType: 'bulk_receipt_pdf_export',
            schoolId: '4209e3d8-d2e2-4e0e-9961-790341c264f4',
            operatorId: 'b1736dfa-80d1-70fb-dd92-ca30cbf9a0ca',
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
            entityKey: 'FINANCE_JOB#job-a',
            jobId: 'job-a',
            jobType: 'bulk_invoice_pdf_export',
            createdAt: '2026-05-12T10:00:00.000Z',
          },
        ],
        LastEvaluatedKey: {
          tenantId: 'tenant-a',
          entityKey: 'FINANCE_JOB#job-a',
        },
      })
      .mockResolvedValueOnce({
        Items: [
          {
            tenantId: 'tenant-b',
            entityKey: 'FINANCE_JOB#job-b',
            jobId: 'job-b',
            jobType: 'bulk_receipt_pdf_export',
            createdAt: '2026-05-12T10:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    snsSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    const result = await handler();

    expect(result.scanned).toBe(2);
    expect(result.marked).toBe(2);

    expect(ddbDocSend).toHaveBeenCalledTimes(4);
    const secondScan = ddbDocSend.mock.calls[1][0] as ScanCommand;
    expect(secondScan.input.ExclusiveStartKey).toEqual({
      tenantId: 'tenant-a',
      entityKey: 'FINANCE_JOB#job-a',
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
            entityKey: 'FINANCE_JOB#raced',
            jobId: 'raced',
            jobType: 'bulk_invoice_generate',
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
            entityKey: 'FINANCE_JOB#failing',
            jobId: 'failing',
            jobType: 'bulk_receipt_pdf_export',
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
      entityKey: 'FINANCE_JOB#failing',
      message: 'ThrottlingException',
    });

    expect(snsSend).toHaveBeenCalledTimes(1);
    const publishCall = snsSend.mock.calls[0][0] as PublishCommand;
    expect(publishCall.input.Subject).toContain('error');
  });

  it('throws when FINANCE_TABLE_NAME is not set', async () => {
    delete process.env.FINANCE_TABLE_NAME;
    const { handler } = await import('./handler');
    await expect(handler()).rejects.toThrow(
      'FINANCE_TABLE_NAME env var is required',
    );
  });

  it('throws when ALERT_TOPIC_ARN is not set', async () => {
    delete process.env.ALERT_TOPIC_ARN;
    const { handler } = await import('./handler');
    await expect(handler()).rejects.toThrow(
      'ALERT_TOPIC_ARN env var is required',
    );
  });

  it('Scan FilterExpression carries FINANCE_JOB entity type and running status', async () => {
    ddbDocSend.mockResolvedValueOnce({ Items: [] });

    const { handler } = await import('./handler');
    await handler();

    const scanCall = ddbDocSend.mock.calls[0][0] as ScanCommand;
    expect(scanCall.input.FilterExpression).toBe(
      'entityType = :et AND #status = :running AND createdAt < :cutoff',
    );
    expect(scanCall.input.ExpressionAttributeValues).toMatchObject({
      ':et': 'FINANCE_JOB',
      ':running': 'running',
    });
    expect(scanCall.input.ExpressionAttributeValues?.[':cutoff']).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('SNS body includes jobType so operators can distinguish invoice vs receipt exports', async () => {
    ddbDocSend
      .mockResolvedValueOnce({
        Items: [
          {
            tenantId: 't1',
            entityKey: 'FINANCE_JOB#j1',
            jobId: 'j1',
            jobType: 'bulk_receipt_pdf_export',
            schoolId: 's1',
            createdAt: '2026-05-12T10:00:00.000Z',
          },
        ],
      })
      .mockResolvedValueOnce({});
    snsSend.mockResolvedValueOnce({});

    const { handler } = await import('./handler');
    await handler();

    const publishCall = snsSend.mock.calls[0][0] as PublishCommand;
    const body = JSON.parse(publishCall.input.Message ?? '{}');
    expect(body.swept[0].jobType).toBe('bulk_receipt_pdf_export');
  });
});
