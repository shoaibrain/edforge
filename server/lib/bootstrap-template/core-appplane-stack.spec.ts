/**
 * C7.3 — the SBT script jobs (CodeBuild, Step Functions, two KMS keys and the
 * CodeBuild-failures alarm) exist only behind CDK_PARAM_SBT_SCRIPT_JOBS=true.
 * The provisioning-alerts topic stays in both modes: the lifecycle functions
 * publish refusals and failures to it.
 */
import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import * as sbt from '@cdklabs/sbt-aws';
import { CoreAppPlaneStack } from './core-appplane-stack';

function synth(scriptJobsEnabled: boolean) {
  const app = new cdk.App();
  const env = { account: '111111111111', region: 'us-east-2' };
  const deps = new cdk.Stack(app, 'CoreAppPlaneTestDeps', { env });
  const eventManager = new sbt.EventManager(deps, 'EventManager');
  const stack = new CoreAppPlaneStack(app, 'CoreAppPlaneTest', {
    eventManager,
    eventBusName: eventManager.busName,
    regApiGatewayUrl: 'https://control.example.com/',
    // Unused by the stack body; the real construct needs Docker to synthesize.
    auth: {} as unknown as sbt.CognitoAuth,
    clientAppUrl: 'https://app.example.com',
    accessLogsBucket: new s3.Bucket(deps, 'Logs'),
    tenantMappingTable: new Table(deps, 'Mapping', { partitionKey: { name: 'tenantId', type: AttributeType.STRING } }),
    operatorAlertEmail: 'ops@example.com',
    scriptJobsEnabled,
    env,
  });
  return Template.fromStack(stack);
}

describe('CoreAppPlaneStack — script jobs behind a flag (C7.3)', () => {
  it('flag off (the default): no KMS key, CodeBuild project, state machine or CodeBuild alarm; the alert topic stays', () => {
    const t = synth(false);
    t.resourceCountIs('AWS::KMS::Key', 0);
    t.resourceCountIs('AWS::CodeBuild::Project', 0);
    t.resourceCountIs('AWS::StepFunctions::StateMachine', 0);
    t.resourceCountIs('AWS::CloudWatch::Alarm', 0);
    t.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'edforge-provisioning-alerts' });
    t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'ops@example.com' });
  });

  it('flag on: the two script jobs with their keys, projects, state machines and the failures alarm', () => {
    const t = synth(true);
    t.resourceCountIs('AWS::KMS::Key', 2);
    t.resourceCountIs('AWS::CodeBuild::Project', 2);
    t.resourceCountIs('AWS::StepFunctions::StateMachine', 2);
    t.hasResourceProperties('AWS::CloudWatch::Alarm', { AlarmName: 'edforge-provisioning-codebuild-failures' });
    t.hasResourceProperties('AWS::SNS::Topic', { TopicName: 'edforge-provisioning-alerts' });
  });
});
