/**
 * Provisioner handler — C7.1. SDK clients are jest-mocked (same approach as
 * the aggregator spec); the handler is re-required per test so module-level
 * clients and the cached stack outputs start fresh.
 */
const cognitoSend = jest.fn();
const snsSend = jest.fn();
const eventsSend = jest.fn();
const cfnSend = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity-provider', () => {
  const actual = jest.requireActual('@aws-sdk/client-cognito-identity-provider');
  return { ...actual, CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({ send: (...a: unknown[]) => cognitoSend(...a) })) };
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
  SUCCESS_DETAIL_TYPE: 'sbt_aws_provisionSuccess',
  FAILURE_DETAIL_TYPE: 'sbt_aws_provisionFailure',
  TENANT_STACK_NAME: 'tenant-template-stack-basic',
  TENANT_API_URL: 'https://api.example.com/prod',
  PROVISIONING_ALERT_TOPIC_ARN: 'arn:aws:sns:ap-south-1:111111111111:edforge-provisioning-alerts',
  TENANT_ALERT_TOPIC_PREFIX: 'edforge-alerts-tenant-',
};

type Cmd = { constructor: { name: string }; input: Record<string, any> };
const name = (c: unknown) => (c as Cmd).constructor.name;
const calls = (mock: jest.Mock, ctor: string) => mock.mock.calls.map((c) => c[0] as Cmd).filter((c) => name(c) === ctor);

function freshHandler() {
  jest.resetModules();
  Object.assign(process.env, ENV);
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('./provisioner').handler as (e: unknown) => Promise<void>;
}

function onboarding(overrides: Record<string, unknown> = {}) {
  return {
    id: 'evt-1',
    source: 'sbt.control.plane',
    'detail-type': 'sbt_aws_onboardingRequest',
    detail: {
      tenantRegistrationId: 'reg-1',
      tenantId: 'tenant-1',
      tenantName: 'saraswati',
      email: 'Admin@Example.com',
      tier: 'BASIC',
      country: 'npl',
      archetype: 'PABSON',
      tenantTag: 'internal-dev-rehearsal',
      prices: [{ id: 'p1', metricName: 'seats' }],
      ...overrides,
    },
  };
}

beforeEach(() => {
  cognitoSend.mockReset().mockResolvedValue({});
  snsSend.mockReset().mockImplementation(async (cmd: Cmd) =>
    name(cmd) === 'CreateTopicCommand' ? { TopicArn: `arn:aws:sns:ap-south-1:111111111111:${cmd.input.Name}` } : {},
  );
  eventsSend.mockReset().mockResolvedValue({ FailedEntryCount: 0, Entries: [{ EventId: 'e' }] });
  cfnSend.mockReset().mockResolvedValue({
    Stacks: [{ Outputs: [{ OutputKey: 'TenantUserpoolId', OutputValue: 'ap-south-1_pool' }, { OutputKey: 'UserPoolClientId', OutputValue: 'client-1' }] }],
  });
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('tenant provisioner', () => {
  it('creates the admin user, group, membership and alert topic, then emits provisionSuccess in the script job envelope', async () => {
    const handler = freshHandler();
    await handler(onboarding());

    const createUser = calls(cognitoSend, 'AdminCreateUserCommand');
    expect(createUser).toHaveLength(1);
    expect(createUser[0].input).toMatchObject({ UserPoolId: 'ap-south-1_pool', Username: 'admin@example.com', DesiredDeliveryMediums: ['EMAIL'] });
    const attrs = Object.fromEntries(createUser[0].input.UserAttributes.map((a: { Name: string; Value: string }) => [a.Name, a.Value]));
    expect(attrs).toMatchObject({
      email: 'Admin@Example.com',
      email_verified: 'true',
      'custom:userRole': 'TenantAdmin',
      'custom:tenantId': 'tenant-1',
      'custom:tenantTier': 'BASIC',
      'custom:tenantName': 'saraswati',
    });
    expect(calls(cognitoSend, 'CreateGroupCommand')[0].input).toEqual({ UserPoolId: 'ap-south-1_pool', GroupName: 'tenant-1' });
    expect(calls(cognitoSend, 'AdminAddUserToGroupCommand')[0].input).toEqual({ UserPoolId: 'ap-south-1_pool', Username: 'admin@example.com', GroupName: 'tenant-1' });
    expect(calls(snsSend, 'CreateTopicCommand')[0].input).toEqual({ Name: 'edforge-alerts-tenant-tenant-1' });
    expect(calls(snsSend, 'SubscribeCommand')[0].input).toMatchObject({ Protocol: 'email', Endpoint: 'Admin@Example.com' });

    const put = calls(eventsSend, 'PutEventsCommand');
    expect(put).toHaveLength(1);
    const entry = put[0].input.Entries[0];
    expect(entry).toMatchObject({ EventBusName: 'sbt-bus', Source: 'sbt.application.plane', DetailType: 'sbt_aws_provisionSuccess' });
    const detail = JSON.parse(entry.Detail);
    expect(detail.tenantRegistrationId).toBe('reg-1');
    expect(detail.jobOutput.tenantRegistrationData).toEqual({ registrationStatus: 'Created' });
    expect(detail.jobOutput.tenantData).toMatchObject({
      tenantId: 'tenant-1',
      tier: 'BASIC',
      country: 'NPL',
      archetype: 'PABSON',
      tenantTag: 'internal-dev-rehearsal',
      alertTopicArn: 'arn:aws:sns:ap-south-1:111111111111:edforge-alerts-tenant-tenant-1',
      prices: [{ id: 'p1', metricName: 'seats' }],
    });
    expect(JSON.parse(detail.jobOutput.tenantData.tenantConfig)).toEqual({
      userPoolId: 'ap-south-1_pool',
      appClientId: 'client-1',
      apiGatewayUrl: 'https://api.example.com/prod',
    });
    expect(calls(snsSend, 'PublishCommand')).toHaveLength(0);
  });

  it('is idempotent: an existing user and group are not errors, and a retry converges', async () => {
    cognitoSend.mockImplementation(async (cmd: Cmd) => {
      if (name(cmd) === 'AdminCreateUserCommand') throw Object.assign(new Error('exists'), { name: 'UsernameExistsException' });
      if (name(cmd) === 'CreateGroupCommand') throw Object.assign(new Error('exists'), { name: 'GroupExistsException' });
      return {};
    });
    const handler = freshHandler();
    await handler(onboarding());
    expect(calls(cognitoSend, 'AdminAddUserToGroupCommand')).toHaveLength(1);
    const detail = JSON.parse(calls(eventsSend, 'PutEventsCommand')[0].input.Entries[0].Detail);
    expect(detail.jobOutput.tenantRegistrationData.registrationStatus).toBe('Created');
  });

  it('refuses a non-BASIC tier: provisionFailure + operator alert, nothing created, no throw', async () => {
    const handler = freshHandler();
    await expect(handler(onboarding({ tier: 'PREMIUM' }))).resolves.toBeUndefined();
    expect(cognitoSend).not.toHaveBeenCalled();
    const put = calls(eventsSend, 'PutEventsCommand');
    expect(put).toHaveLength(1);
    expect(put[0].input.Entries[0].DetailType).toBe('sbt_aws_provisionFailure');
    const detail = JSON.parse(put[0].input.Entries[0].Detail);
    expect(detail).toMatchObject({ tenantRegistrationId: 'reg-1', jobOutput: { tenantStatus: 'Failed to provision tenant.' } });
    expect(detail.jobOutput.reason).toMatch(/BASIC/);
    const alert = calls(snsSend, 'PublishCommand');
    expect(alert).toHaveLength(1);
    expect(alert[0].input.TopicArn).toBe(ENV.PROVISIONING_ALERT_TOPIC_ARN);
    expect(alert[0].input.Subject).toMatch(/refused/);
  });

  it('normalises an unknown archetype to GENERIC and a bad tag to production', async () => {
    const handler = freshHandler();
    await handler(onboarding({ archetype: 'NAIS_US', tenantTag: 'prod' }));
    const detail = JSON.parse(calls(eventsSend, 'PutEventsCommand')[0].input.Entries[0].Detail);
    expect(detail.jobOutput.tenantData).toMatchObject({ archetype: 'GENERIC', tenantTag: 'production' });
  });

  it('emits provisionFailure and rethrows on an unexpected error, so the retry and the alarm see it', async () => {
    cognitoSend.mockImplementation(async (cmd: Cmd) => {
      if (name(cmd) === 'AdminCreateUserCommand') throw Object.assign(new Error('rate exceeded'), { name: 'TooManyRequestsException' });
      return {};
    });
    const handler = freshHandler();
    await expect(handler(onboarding())).rejects.toThrow('rate exceeded');
    const put = calls(eventsSend, 'PutEventsCommand');
    expect(put).toHaveLength(1);
    expect(put[0].input.Entries[0].DetailType).toBe('sbt_aws_provisionFailure');
    expect(calls(snsSend, 'PublishCommand')[0].input.Subject).toMatch(/failed/);
  });

  it('throws without emitting anything when the event has no registration id or tenant id', async () => {
    const handler = freshHandler();
    await expect(handler(onboarding({ tenantRegistrationId: undefined }))).rejects.toThrow(/tenantRegistrationId/);
    expect(eventsSend).not.toHaveBeenCalled();
    expect(cognitoSend).not.toHaveBeenCalled();
  });
});
