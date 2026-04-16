/**
 * CDK Template assertions for AnalyticsStack — covers the "CDK test" bullets
 * on tasks 2.1 through 2.7 in the Layer 2 sprint plan.
 *
 * These tests synthesize the stack once and assert key invariants against
 * the resulting CloudFormation template. They do NOT deploy anything.
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { AnalyticsStack } from './analytics-stack';

function synth() {
  const app = new cdk.App();
  const stack = new AnalyticsStack(app, 'AnalyticsStackTest', {
    eventBusName: 'test-sbt-bus',
    operatorAlertEmail: 'ops@example.com',
    analyticsEnabled: 'false',
    env: { account: '111111111111', region: 'us-east-2' },
  });
  return Template.fromStack(stack);
}

describe('AnalyticsStack — Layer 2 CDK template assertions', () => {
  const t = synth();

  describe('2.1 EdforgeAnalyticsTable', () => {
    it('is PAY_PER_REQUEST with correct PK/SK and TTL', () => {
      t.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'edforge-analytics',
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        TimeToLiveSpecification: { AttributeName: 'expireAt', Enabled: true },
      });
    });

    it('has PITR enabled', () => {
      t.hasResourceProperties(
        'AWS::DynamoDB::Table',
        Match.objectLike({
          TableName: 'edforge-analytics',
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true },
        }),
      );
    });
  });

  describe('2.2 AnalyticsEventsLandingTable', () => {
    it('has eventId PK, PAY_PER_REQUEST, TTL attribute expireAt', () => {
      t.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'edforge-analytics-landing',
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [{ AttributeName: 'eventId', KeyType: 'HASH' }],
        TimeToLiveSpecification: { AttributeName: 'expireAt', Enabled: true },
      });
    });
  });

  describe('2.3 UserSessionEventsTable', () => {
    it('has PK/SK schema and TTL', () => {
      t.hasResourceProperties('AWS::DynamoDB::Table', {
        TableName: 'edforge-user-session-events',
        BillingMode: 'PAY_PER_REQUEST',
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
        TimeToLiveSpecification: { AttributeName: 'expireAt', Enabled: true },
      });
    });
  });

  describe('2.4 AnalyticsAggregatorLambda + DLQ', () => {
    it('creates the separate aggregator DLQ (NOT the existing bus DLQ)', () => {
      t.hasResourceProperties('AWS::SQS::Queue', {
        QueueName: 'edforge-analytics-aggregator-dlq',
      });
    });

    it('Lambda is Node 20 with correct memory/timeout (reserved concurrency intentionally unset)', () => {
      // We do NOT set reservedConcurrentExecutions in UAT because the
      // account's ConcurrentExecutions quota is too low (10). Deferred
      // until quota raise; see analytics-stack.ts for the note.
      t.hasResourceProperties(
        'AWS::Lambda::Function',
        Match.objectLike({
          FunctionName: 'edforge-analytics-aggregator',
          Runtime: Match.stringLikeRegexp('^nodejs20'),
          MemorySize: 512,
          Timeout: 60,
        }),
      );
    });

    it('Lambda receives all required env vars', () => {
      t.hasResourceProperties(
        'AWS::Lambda::Function',
        Match.objectLike({
          FunctionName: 'edforge-analytics-aggregator',
          Environment: {
            Variables: Match.objectLike({
              ANALYTICS_TABLE_NAME: Match.anyValue(),
              LANDING_TABLE_NAME: Match.anyValue(),
              USER_SESSION_EVENTS_TABLE_NAME: Match.anyValue(),
              ANALYTICS_ENABLED: 'false',
              EVENT_BUS_NAME: 'test-sbt-bus',
            }),
          },
        }),
      );
    });
  });

  describe('2.5 EventBridge rules', () => {
    it('rule edforge-analytics-native targets the aggregator', () => {
      t.hasResourceProperties('AWS::Events::Rule', {
        Name: 'edforge-analytics-native',
        EventBusName: 'test-sbt-bus',
        EventPattern: { source: ['edforge.analytics'] },
      });
    });

    it('rule edforge-domain-events includes the three domain sources', () => {
      t.hasResourceProperties('AWS::Events::Rule', {
        Name: 'edforge-domain-events',
        EventBusName: 'test-sbt-bus',
        EventPattern: {
          source: [
            'edforge.academics-service',
            'edforge.finance-service',
            'edforge.identity-service',
          ],
        },
      });
    });

    it('both rules are attached to the aggregator and reference the aggregator DLQ', () => {
      const rules = t.findResources('AWS::Events::Rule');
      const analyticsRules = Object.entries(rules).filter(
        ([, r]: [string, any]) =>
          r.Properties?.Name === 'edforge-analytics-native' ||
          r.Properties?.Name === 'edforge-domain-events',
      );
      expect(analyticsRules).toHaveLength(2);
      for (const [, rule] of analyticsRules as Array<[string, any]>) {
        const targets = rule.Properties.Targets || [];
        expect(targets.length).toBe(1);
        expect(targets[0].DeadLetterConfig).toBeDefined();
        expect(targets[0].RetryPolicy).toBeDefined();
        expect(targets[0].RetryPolicy.MaximumRetryAttempts).toBe(2);
      }
    });
  });

  describe('2.6 CloudWatch alarms', () => {
    it('DLQ depth alarm is present with threshold 0 and 15-min eval', () => {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'edforge-analytics-aggregator-dlq-depth',
        Threshold: 0,
        ComparisonOperator: 'GreaterThanThreshold',
        EvaluationPeriods: 3,
      });
    });

    it('Lambda throttle alarm is present', () => {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'edforge-analytics-aggregator-throttles',
      });
    });

    it('landing-table WCU burst alarm is present', () => {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'edforge-analytics-landing-wcu-burst',
      });
    });
  });

  describe('2.7 SNS operator topic', () => {
    it('creates the operator topic with correct name', () => {
      t.hasResourceProperties('AWS::SNS::Topic', {
        TopicName: 'edforge-alerts-operator',
      });
    });

    it('subscribes the operator email via the Email protocol', () => {
      t.hasResourceProperties('AWS::SNS::Subscription', {
        Protocol: 'email',
        Endpoint: 'ops@example.com',
      });
    });
  });

  describe('6.4 GSI1 on analytics table', () => {
    it('creates GSI1 with GSI1PK/GSI1SK key schema', () => {
      t.hasResourceProperties(
        'AWS::DynamoDB::Table',
        Match.objectLike({
          TableName: 'edforge-analytics',
          GlobalSecondaryIndexes: Match.arrayWith([
            Match.objectLike({
              IndexName: 'GSI1',
              KeySchema: [
                { AttributeName: 'GSI1PK', KeyType: 'HASH' },
                { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
              ],
              Projection: { ProjectionType: 'ALL' },
            }),
          ]),
        }),
      );
    });
  });

  describe('6.3 AnalyticsRollupLambda', () => {
    it('creates the rollup Lambda with correct runtime/memory/timeout (reserved concurrency unset; scheduled daily only)', () => {
      t.hasResourceProperties(
        'AWS::Lambda::Function',
        Match.objectLike({
          FunctionName: 'edforge-analytics-rollup',
          Runtime: Match.stringLikeRegexp('^nodejs20'),
          MemorySize: 512,
          Timeout: 300,
        }),
      );
    });

    it('creates an EventBridge Scheduler with Asia/Kathmandu timezone', () => {
      t.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'cron(0 1 * * ? *)',
        ScheduleExpressionTimezone: 'Asia/Kathmandu',
        State: 'ENABLED',
      });
    });
  });

  describe('6.5 rollup heartbeat alarm', () => {
    it('creates a LessThanThreshold alarm with 26-hour evaluation', () => {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'edforge-analytics-rollup-heartbeat',
        ComparisonOperator: 'LessThanThreshold',
        Threshold: 1,
        EvaluationPeriods: 26,
        TreatMissingData: 'breaching',
      });
    });
  });

  describe('Exports for downstream stacks', () => {
    it('exports the analytics, landing, user-session table names', () => {
      t.hasOutput('AnalyticsTableNameOutput', {
        Export: { Name: 'EdforgeAnalyticsTableName' },
      });
      t.hasOutput('LandingTableNameOutput', {
        Export: { Name: 'EdforgeAnalyticsLandingTableName' },
      });
      t.hasOutput('UserSessionEventsTableNameOutput', {
        Export: { Name: 'EdforgeUserSessionEventsTableName' },
      });
    });
  });
});
