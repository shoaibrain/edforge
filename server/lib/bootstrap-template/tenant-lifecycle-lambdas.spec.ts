import * as cdk from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import * as sbt from '@cdklabs/sbt-aws';
import { TenantLifecycleLambdas } from './tenant-lifecycle-lambdas';

function synth() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'LifecycleTest', { env: { account: '111111111111', region: 'us-east-2' } });
  const eventManager = new sbt.EventManager(stack, 'EventManager');
  new TenantLifecycleLambdas(stack, 'TenantLifecycle', {
    eventManager,
    tenantStackName: 'tenant-template-stack-basic',
    tenantApiUrl: 'https://api.example.com/prod',
    tableNames: { identity: 'edforge-identity-basic', academics: 'edforge-academics-basic', finance: 'edforge-finance-basic' },
  });
  return Template.fromStack(stack);
}

describe('TenantLifecycleLambdas — C7.1/C7.2', () => {
  const t = synth();
  const functions = Object.values(t.findResources('AWS::Lambda::Function')) as Array<{ Properties: Record<string, any> }>;
  const named = (n: string) => functions.find((f) => f.Properties.FunctionName === n)!;

  it('creates the provisioner and deprovisioner on nodejs22.x with the SBT event names from the event manager', () => {
    const prov = named('edforge-tenant-provisioner');
    const deprov = named('edforge-tenant-deprovisioner');
    expect(prov.Properties.Runtime).toBe('nodejs22.x');
    expect(deprov.Properties.Runtime).toBe('nodejs22.x');
    expect(prov.Properties.Environment.Variables).toMatchObject({
      EVENT_SOURCE: 'sbt.application.plane',
      SUCCESS_DETAIL_TYPE: 'sbt_aws_provisionSuccess',
      FAILURE_DETAIL_TYPE: 'sbt_aws_provisionFailure',
      TENANT_STACK_NAME: 'tenant-template-stack-basic',
      TENANT_API_URL: 'https://api.example.com/prod',
      TENANT_ALERT_TOPIC_PREFIX: 'edforge-alerts-tenant-',
    });
    expect(deprov.Properties.Environment.Variables).toMatchObject({
      SUCCESS_DETAIL_TYPE: 'sbt_aws_deprovisionSuccess',
      FAILURE_DETAIL_TYPE: 'sbt_aws_deprovisionFailure',
      IDENTITY_TABLE_NAME: 'edforge-identity-basic',
      ACADEMICS_TABLE_NAME: 'edforge-academics-basic',
      FINANCE_TABLE_NAME: 'edforge-finance-basic',
    });
    expect(deprov.Properties.Timeout).toBe(300);
  });

  it('listens for the two request events on the SBT bus with the control-plane source', () => {
    t.hasResourceProperties('AWS::Events::Rule', {
      Name: 'edforge-tenant-provisioner',
      EventPattern: { source: ['sbt.control.plane'], 'detail-type': ['sbt_aws_onboardingRequest'] },
    });
    t.hasResourceProperties('AWS::Events::Rule', {
      Name: 'edforge-tenant-deprovisioner',
      EventPattern: { source: ['sbt.control.plane'], 'detail-type': ['sbt_aws_offboardingRequest'] },
    });
    t.resourceCountIs('AWS::Events::Rule', 2);
  });

  it('grants each function only its own calls and never a wildcard resource', () => {
    const policies = Object.values(t.findResources('AWS::IAM::Policy')) as Array<{ Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> } } }>;
    const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
    const actions = statements.flatMap((s) => (Array.isArray(s.Action) ? s.Action : [s.Action]));
    expect(actions).toEqual(
      expect.arrayContaining([
        'events:PutEvents',
        'cloudformation:DescribeStacks',
        'sns:Publish',
        'cognito-idp:AdminCreateUser',
        'cognito-idp:CreateGroup',
        'cognito-idp:AdminAddUserToGroup',
        'sns:CreateTopic',
        'sns:Subscribe',
        'cognito-idp:ListUsersInGroup',
        'cognito-idp:AdminDeleteUser',
        'cognito-idp:DeleteGroup',
        'dynamodb:GetItem',
        'dynamodb:Query',
        'dynamodb:BatchWriteItem',
        'sns:DeleteTopic',
      ]),
    );
    expect(actions.some((a) => a.startsWith('codebuild:') || a.startsWith('kms:'))).toBe(false);
    // The CDK log-retention helper legitimately holds logs:* on '*'; none of the lifecycle grants may.
    const lifecycleStatements = statements.filter((s) => !(Array.isArray(s.Action) ? s.Action : [s.Action]).some((a) => a.startsWith('logs:')));
    expect(lifecycleStatements.length).toBeGreaterThan(5);
    expect(lifecycleStatements.some((s) => s.Resource === '*')).toBe(false);
    const json = JSON.stringify(statements);
    expect(json).toContain('edforge-alerts-tenant-*');
    expect(json).toContain('edforge-provisioning-alerts');
    expect(json).toContain('stack/tenant-template-stack-basic/*');
  });

  it('sets the failure retry policy on both rule targets', () => {
    t.hasResourceProperties('AWS::Events::Rule', {
      Targets: Match.arrayWith([Match.objectLike({ RetryPolicy: { MaximumRetryAttempts: 2, MaximumEventAgeInSeconds: 900 } })]),
    });
  });
});
