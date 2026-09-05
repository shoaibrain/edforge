/** Deprovisioner handler — C7.2, default-deny gate D7.4. */
const cognitoSend = jest.fn();
const ddbSend = jest.fn();
const snsSend = jest.fn();
const eventsSend = jest.fn();
const cfnSend = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const actual = jest.requireActual('@aws-sdk/client-cognito-identity-provider');
  return { ...actual, CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: (...a: unknown[]) => cognitoSend(...a) })) };
});
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return { ...actual, DynamoDBClient: jest.fn().mockImplementation(() => ({ send: (...a: unknown[]) => ddbSend(...a) })) };
});
jest.mock('@aws-sdk/client-sns', () => {
  const actual = jest.requireActual('@aws-sdk/client-sns');
  return { ...actual, SNSClient: jest.fn().mockImplementation(() => ({ send: (...a: unknown[]) => snsSend(...a) })) };
});
jest.mock('@aws-sdk/client-eventbridge', () => {
  const actual = jest.requireActual('@aws-sdk/client-eventbridge');
  return { ...actual, EventBridgeClient: jest.fn().mockImplementation(() => ({ send: (...a: unknown[]) => eventsSend(...a) })) };
});
jest.mock('@aws-sdk/client-cloudformation', () => {
  const actual = jest.requireActual('@aws-sdk/client-cloudformation');
  return { ...actual, CloudFormationClient: jest.fn().mockImplementation(() => ({ send: (...a: unknown[]) => cfnSend(...a) })) };
});

const ENV = {
  EVENT_BUS_NAME: 'sbt-bus',
  EVENT_SOURCE: 'sbt.application.plane',
  SUCCESS_DETAIL_TYPE: 'sbt_aws_deprovisionSuccess',
  FAILURE_DETAIL_TYPE: 'sbt_aws_deprovisionFailure',
  TENANT_STACK_NAME: 'tenant-template-stack-basic',
  IDENTITY_TABLE_NAME: 'edforge-identity-basic',
  ACADEMICS_TABLE_NAME: 'edforge-academics-basic',
  FINANCE_TABLE_NAME: 'edforge-finance-basic',
  PROVISIONING_ALERT_TOPIC_ARN: 'arn:aws:sns:ap-south-1:111111111111:edforge-provisioning-alerts',
  TENANT_ALERT_TOPIC_PREFIX: 'edforge-alerts-tenant-',
};
const CONTEXT = { invokedFunctionArn: 'arn:aws:lambda:ap-south-1:111111111111:function:edforge-tenant-deprovisioner' };

type Cmd = { constructor: { name: string }; input: Record<string, any> };
const name = (c: unknown) => (c as Cmd).constructor.name;
const calls = (mock: jest.Mock, ctor: string) => mock.mock.calls.map((c) => c[0] as Cmd).filter((c) => name(c) === ctor);

function freshHandler() {
  jest.resetModules();
  Object.assign(process.env, ENV);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./deprovisioner').handler as (e: unknown, c: unknown) => Promise<void>;
}

function offboarding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-2',
    source: 'sbt.control.plane',
    'detail-type': 'sbt_aws_offboardingRequest',
    detail: { tenantRegistrationId: 'reg-1', tenantId: 'tenant-1', tier: 'BASIC', ...overrides },
  };
}

/** METADATA row (or none) + one page of tenant items per table. */
function ddbWith(metadataTag: string | null | undefined, itemsPerTable = 3) {
  ddbSend.mockImplementation(async (cmd: Cmd) => {
    switch (name(cmd)) {
      case 'GetItemCommand':
        if (metadataTag === undefined) return {};
        return { Item: metadataTag === null ? { tenantId: { S: 'tenant-1' } } : { tenantId: { S: 'tenant-1' }, tenantTag: { S: metadataTag } } };
      case 'QueryCommand':
        return { Items: Array.from({ length: itemsPerTable }, (_, i) => ({ tenantId: { S: 'tenant-1' }, entityKey: { S: `ROW#${i}` } })) };
      case 'BatchWriteItemCommand':
        return { UnprocessedItems: {} };
      default:
        return {};
    }
  });
}

beforeEach(() => {
  cognitoSend.mockReset().mockImplementation(async (cmd: Cmd) => (name(cmd) === 'ListUsersInGroupCommand' ? { Users: [{ Username: 'admin@example.com' }, { Username: 'teacher@example.com' }] } : {}));
  ddbSend.mockReset();
  snsSend.mockReset().mockResolvedValue({});
  eventsSend.mockReset().mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'e' }] });
  cfnSend.mockReset().mockResolvedValue({ Stacks: [{ Outputs: [{ OutputKey: 'TenantUserpoolId', OutputValue: 'ap-south-1_pool' }] }] });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('tenant deprovisioner', () => {
  it('deprovisions an internal-dev tenant: users, group, three partitions, topic, then deprovisionSuccess', async () => {
    ddbWith('internal-dev');
    const handler = freshHandler();
    await handler(offboarding(), CONTEXT);

    expect(calls(cognitoSend, 'AdminDeleteUserCommand').map((c) => c.input.Username)).toEqual(['admin@example.com', 'teacher@example.com']);
    expect(calls(cognitoSend, 'DeleteGroupCommand')[0].input).toEqual({ UserPoolId: 'ap-south-1_pool', GroupName: 'tenant-1' });
    expect(calls(ddbSend, 'QueryCommand').map((c) => c.input.TableName)).toEqual(['edforge-identity-basic', 'edforge-academics-basic', 'edforge-finance-basic']);
    const batches = calls(ddbSend, 'BatchWriteItemCommand');
    expect(batches).toHaveLength(3);
    expect(batches[0].input.RequestItems['edforge-identity-basic']).toHaveLength(3);
    expect(batches[0].input.RequestItems['edforge-identity-basic'][0]).toEqual({ DeleteRequest: { Key: { tenantId: { S: 'tenant-1' }, entityKey: { S: 'ROW#0' } } } });
    expect(calls(snsSend, 'DeleteTopicCommand')[0].input).toEqual({ TopicArn: 'arn:aws:sns:ap-south-1:111111111111:edforge-alerts-tenant-tenant-1' });

    const put = calls(eventsSend, 'PutEventsCommand');
    expect(put).toHaveLength(1);
    expect(put[0].input.Entries[0].DetailType).toBe('sbt_aws_deprovisionSuccess');
    expect(JSON.parse(put[0].input.Entries[0].Detail)).toEqual({
      tenantRegistrationId: 'reg-1',
      tenantId: 'tenant-1',
      jobOutput: { tenantData: {}, tenantRegistrationData: { registrationStatus: 'Deleted' } },
    });
    expect(calls(snsSend, 'PublishCommand')).toHaveLength(0);
  });

  it.each([
    ['production', 'production'],
    ['no tenantTag', null],
    ['no METADATA row', undefined],
  ])('refuses a %s tenant without confirmProduction: deprovisionFailure, alert, nothing deleted', async (_label, tag) => {
    ddbWith(tag as string | null | undefined);
    const handler = freshHandler();
    await expect(handler(offboarding(), CONTEXT)).resolves.toBeUndefined();
    expect(calls(cognitoSend, 'AdminDeleteUserCommand')).toHaveLength(0);
    expect(calls(ddbSend, 'BatchWriteItemCommand')).toHaveLength(0);
    expect(calls(snsSend, 'DeleteTopicCommand')).toHaveLength(0);
    const put = calls(eventsSend, 'PutEventsCommand');
    expect(put).toHaveLength(1);
    expect(put[0].input.Entries[0].DetailType).toBe('sbt_aws_deprovisionFailure');
    expect(JSON.parse(put[0].input.Entries[0].Detail).jobOutput).toMatchObject({ tenantStatus: 'Failed to deprovision tenant.' });
    expect(calls(snsSend, 'PublishCommand')[0].input.Subject).toMatch(/refused/);
  });

  it('deprovisions a production tenant when the request carries confirmProduction: true', async () => {
    ddbWith('production', 30);
    const handler = freshHandler();
    await handler(offboarding({ confirmProduction: true }), CONTEXT);
    const batches = calls(ddbSend, 'BatchWriteItemCommand');
    expect(batches).toHaveLength(6);
    expect(batches[0].input.RequestItems['edforge-identity-basic']).toHaveLength(25);
    expect(batches[1].input.RequestItems['edforge-identity-basic']).toHaveLength(5);
    expect(calls(eventsSend, 'PutEventsCommand')[0].input.Entries[0].DetailType).toBe('sbt_aws_deprovisionSuccess');
  });

  it('retries unprocessed batch deletes and tolerates a group that is already gone', async () => {
    let first = true;
    ddbSend.mockImplementation(async (cmd: Cmd) => {
      switch (name(cmd)) {
        case 'GetItemCommand':
          return { Item: { tenantTag: { S: 'internal-dev' } } };
        case 'QueryCommand':
          return { Items: [{ tenantId: { S: 'tenant-1' }, entityKey: { S: 'ROW#0' } }] };
        case 'BatchWriteItemCommand': {
          if (first) {
            first = false;
            return { UnprocessedItems: cmd.input.RequestItems };
          }
          return { UnprocessedItems: {} };
        }
        default:
          return {};
      }
    });
    cognitoSend.mockImplementation(async (cmd: Cmd) => {
      if (name(cmd) === 'ListUsersInGroupCommand') throw Object.assign(new Error('gone'), { name: 'ResourceNotFoundException' });
      return {};
    });
    const handler = freshHandler();
    await handler(offboarding(), CONTEXT);
    expect(calls(ddbSend, 'BatchWriteItemCommand')).toHaveLength(4);
    expect(calls(eventsSend, 'PutEventsCommand')[0].input.Entries[0].DetailType).toBe('sbt_aws_deprovisionSuccess');
  });

  it('emits deprovisionFailure and rethrows on an unexpected error', async () => {
    ddbWith('internal-dev');
    cognitoSend.mockImplementation(async (cmd: Cmd) => {
      if (name(cmd) === 'ListUsersInGroupCommand') throw Object.assign(new Error('throttled'), { name: 'TooManyRequestsException' });
      return {};
    });
    const handler = freshHandler();
    await expect(handler(offboarding(), CONTEXT)).rejects.toThrow('throttled');
    expect(calls(eventsSend, 'PutEventsCommand')[0].input.Entries[0].DetailType).toBe('sbt_aws_deprovisionFailure');
    expect(calls(snsSend, 'PublishCommand')[0].input.Subject).toMatch(/failed/);
  });
});
