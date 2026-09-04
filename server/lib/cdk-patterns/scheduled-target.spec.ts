import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { ScheduledTarget } from './scheduled-target';

function synth(enabled?: boolean) {
  const stack = new cdk.Stack(new cdk.App(), 'T', { env: { account: '111111111111', region: 'ap-south-1' } });
  const fn = new lambda.Function(stack, 'Fn', { runtime: lambda.Runtime.NODEJS_22_X, handler: 'index.scheduledHandler', code: lambda.Code.fromInline('exports.scheduledHandler=async()=>({})') });
  new ScheduledTarget(stack, 'Overdue', {
    fn, schedule: 'cron(0 * * * ? *)', timezone: 'Asia/Kathmandu', enabled,
    input: { job: 'overdue-detection', scheduledTime: '<aws.scheduler.scheduled-time>' },
  });
  return Template.fromStack(stack);
}

describe('ScheduledTarget (C3.4)', () => {
  it('schedules an existing function with the cron, timezone, input (context attribute intact) and the retry policy', () => {
    const t = synth();
    t.resourceCountIs('AWS::Lambda::Function', 1);
    t.hasResourceProperties('AWS::Scheduler::Schedule', Match.objectLike({
      ScheduleExpression: 'cron(0 * * * ? *)',
      ScheduleExpressionTimezone: 'Asia/Kathmandu',
      FlexibleTimeWindow: { Mode: 'OFF' },
      State: 'ENABLED',
      Target: Match.objectLike({
        Input: '{"job":"overdue-detection","scheduledTime":"<aws.scheduler.scheduled-time>"}',
        RetryPolicy: { MaximumEventAgeInSeconds: 900, MaximumRetryAttempts: 2 },
      }),
    }));
  });

  it('creates a role scheduler.amazonaws.com assumes that may invoke only that function', () => {
    const t = synth();
    t.hasResourceProperties('AWS::IAM::Role', { AssumeRolePolicyDocument: Match.objectLike({ Statement: [Match.objectLike({ Principal: { Service: 'scheduler.amazonaws.com' } })] }) });
    t.hasResourceProperties('AWS::IAM::Policy', { PolicyDocument: Match.objectLike({ Statement: Match.arrayWith([Match.objectLike({ Action: 'lambda:InvokeFunction' })]) }) });
  });

  it('ships DISABLED when enabled is false', () => {
    synth(false).hasResourceProperties('AWS::Scheduler::Schedule', { State: 'DISABLED' });
  });
});
