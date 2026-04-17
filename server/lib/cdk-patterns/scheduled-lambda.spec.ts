/**
 * Layer 6.1 — scheduled-lambda CDK template assertion test.
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { Construct } from 'constructs';
import * as path from 'path';
import { ScheduledLambda } from './scheduled-lambda';

// Tiny host stack to instantiate the construct for tests.
class TestHost extends cdk.Stack {
  constructor(scope: Construct, id: string) {
    super(scope, id);
    new ScheduledLambda(this, 'UnderTest', {
      schedule: 'cron(15 19 * * ? *)', // 19:15 UTC = 01:00 Asia/Kathmandu
      timezone: 'UTC',
      lambdaProps: {
        // Reuse the aggregator handler as a placeholder — the construct
        // test only cares about resource shape, not Lambda behavior.
        entry: path.join(
          __dirname,
          '../analytics/lambda/aggregator/handler.ts',
        ),
        handler: 'handler',
        memorySize: 256,
        timeout: cdk.Duration.seconds(30),
      },
      input: { mode: 'test' },
    });
  }
}

describe('ScheduledLambda (Layer 6.1)', () => {
  const app = new cdk.App();
  const stack = new TestHost(app, 'ScheduledLambdaTest');
  const t = Template.fromStack(stack);

  it('creates a NodejsFunction target', () => {
    t.hasResourceProperties(
      'AWS::Lambda::Function',
      Match.objectLike({ Runtime: Match.stringLikeRegexp('^nodejs20') }),
    );
  });

  it('creates an EventBridge Scheduler schedule with the given cron + timezone', () => {
    t.hasResourceProperties('AWS::Scheduler::Schedule', {
      ScheduleExpression: 'cron(15 19 * * ? *)',
      ScheduleExpressionTimezone: 'UTC',
      State: 'ENABLED',
      FlexibleTimeWindow: { Mode: 'OFF' },
    });
  });

  it('creates an IAM role that scheduler.amazonaws.com can assume', () => {
    t.hasResourceProperties(
      'AWS::IAM::Role',
      Match.objectLike({
        AssumeRolePolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Principal: { Service: 'scheduler.amazonaws.com' },
            }),
          ]),
        },
      }),
    );
  });

  it('passes a retry policy on the schedule target', () => {
    t.hasResourceProperties(
      'AWS::Scheduler::Schedule',
      Match.objectLike({
        Target: Match.objectLike({
          RetryPolicy: {
            MaximumEventAgeInSeconds: 900,
            MaximumRetryAttempts: 2,
          },
        }),
      }),
    );
  });
});
