/**
 * CDK Template assertions for AnalyticsStack — covers the "CDK test" bullets
 * on tasks 2.1 through 2.7 in the Layer 2 sprint plan.
 *
 * These tests synthesize the stack once and assert key invariants against
 * the resulting CloudFormation template. They do NOT deploy anything.
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { AnalyticsStack } from './analytics-stack';

function synth() {
  const app = new cdk.App();
  // Phase 4 (Sprint I-2) added two required props to AnalyticsStackProps.
  // albLoadBalancerFullName is a plain string used as a CloudWatch
  // dimension; tenantSeederLambda needs an IFunction. Creating a placeholder
  // Lambda in a helper stack is the canonical CDK test pattern for
  // cross-stack references under Template.fromStack.
  const depsStack = new cdk.Stack(app, 'AnalyticsStackTestDeps', {
    env: { account: '111111111111', region: 'us-east-2' },
  });
  const tenantSeederLambda = new lambda.Function(depsStack, 'TenantSeederStub', {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => ({});'),
  });

  const stack = new AnalyticsStack(app, 'AnalyticsStackTest', {
    eventBusName: 'test-sbt-bus',
    operatorAlertEmail: 'ops@example.com',
    analyticsEnabled: 'false',
    albLoadBalancerFullName: 'app/test-alb/1234567890abcdef',
    tenantSeederLambda,
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
              // A-WS1.T7: identity table for tenant-settings resolver.
              IDENTITY_TABLE_NAME: 'edforge-identity-basic',
            }),
          },
        }),
      );
    });

    // A-WS1.T7 — IAM grant for tenant settings resolver.
    it('aggregator role has dynamodb:GetItem on identity table', () => {
      t.hasResourceProperties(
        'AWS::IAM::Policy',
        Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([
              Match.objectLike({
                Sid: 'TenantSettingsRead',
                Action: 'dynamodb:GetItem',
                Effect: 'Allow',
                Resource: Match.stringLikeRegexp(
                  'arn:aws:dynamodb:us-east-2:111111111111:table/edforge-identity-basic',
                ),
              }),
            ]),
          }),
        }),
      );
    });
  });

  // A-WS2.T3 — analytics-api Lambda settings invalidation wiring.
  describe('A-WS2.T3 — analytics-api settings invalidation', () => {
    it('api Lambda has IDENTITY_TABLE_NAME env var', () => {
      t.hasResourceProperties(
        'AWS::Lambda::Function',
        Match.objectLike({
          FunctionName: 'edforge-analytics-api',
          Environment: {
            Variables: Match.objectLike({
              IDENTITY_TABLE_NAME: 'edforge-identity-basic',
            }),
          },
        }),
      );
    });

    it('api Lambda role has dynamodb:GetItem on identity table', () => {
      // Both aggregator and api Lambda have a TenantSettingsRead Sid; both
      // are valid — assert at least one such grant exists for the api role.
      const policies = t.findResources('AWS::IAM::Policy');
      const apiPolicies = Object.values(policies).filter((p) => {
        const stmts = (p.Properties as { PolicyDocument: { Statement: unknown[] } })
          .PolicyDocument.Statement;
        return stmts.some(
          (s) =>
            (s as { Sid?: string }).Sid === 'TenantSettingsRead' &&
            (s as { Resource: string }).Resource?.includes('edforge-identity-basic'),
        );
      });
      // At least 2: one for aggregator role, one for api Lambda role.
      expect(apiPolicies.length).toBeGreaterThanOrEqual(2);
    });

    it('EventBridge rule routes WorkspaceSettingsUpdated to api Lambda', () => {
      t.hasResourceProperties('AWS::Events::Rule', {
        Name: 'edforge-workspace-settings-updated-to-api',
        EventBusName: 'test-sbt-bus',
        EventPattern: {
          source: ['edforge.identity-service'],
          'detail-type': ['WorkspaceSettingsUpdated'],
        },
      });
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

  // ACRIT.1.T4 — every NPT-correctness assertion lives here so a future change
  // that flips back to UTC bucketing breaks the build, not just one test
  // file. The runtime correctness of the date helpers themselves is asserted
  // by lib/analytics/lambda/shared/date-utils.spec.ts (21 boundary tests) +
  // 2 integration tests in lib/analytics/lambda/aggregator/handler.spec.ts.
  describe('ACRIT.1 — NPT correctness invariants at the CDK level', () => {
    it('rollup scheduler timezone is Asia/Kathmandu (not UTC)', () => {
      // If this asserts UTC, day boundaries will mis-bucket events
      // 18:15–23:59 UTC (= 00:00–05:44 NPT next day).
      t.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpressionTimezone: 'Asia/Kathmandu',
      });
    });

    it('rollup runs at 01:00 NPT — after the NPT day has closed', () => {
      // 01:00 NPT = 19:15 UTC the previous day. The "yesterday NPT"
      // resolveTargetDate() in date-utils picks the just-finished NPT day.
      t.hasResourceProperties('AWS::Scheduler::Schedule', {
        ScheduleExpression: 'cron(0 1 * * ? *)',
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

  describe('Sprint 1 — analytics-api Lambda + export bucket', () => {
    it('creates ApiLambda with correct config', () => {
      t.hasResourceProperties(
        'AWS::Lambda::Function',
        Match.objectLike({
          FunctionName: 'edforge-analytics-api',
          Runtime: Match.stringLikeRegexp('^nodejs20'),
          MemorySize: 1024,
          Timeout: 30,
          Environment: {
            Variables: Match.objectLike({
              ANALYTICS_TABLE_NAME: Match.anyValue(),
              USER_SESSION_EVENTS_TABLE_NAME: Match.anyValue(),
              EXPORT_BUCKET_NAME: Match.anyValue(),
              SYSTEM_ADMIN_EMAILS: '',
            }),
          },
        }),
      );
    });

    it('creates ExportBucket with TLS-only + 1-day lifecycle + BlockPublicAccess', () => {
      t.hasResourceProperties(
        'AWS::S3::Bucket',
        Match.objectLike({
          BucketName: Match.stringLikeRegexp('edforge-analytics-exports-'),
          PublicAccessBlockConfiguration: {
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true,
          },
          LifecycleConfiguration: {
            Rules: Match.arrayWith([
              Match.objectLike({ Id: 'expire-exports-1d', Status: 'Enabled', ExpirationInDays: 1 }),
            ]),
          },
        }),
      );
    });

    it('export bucket has TLS-only bucket policy', () => {
      t.hasResourceProperties(
        'AWS::S3::BucketPolicy',
        Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: 'Deny',
                Condition: Match.objectLike({ Bool: { 'aws:SecureTransport': 'false' } }),
              }),
            ]),
          }),
        }),
      );
    });
  });

  describe('Sprint 2 — API Gateway wiring', () => {
    it('creates a shared TokenAuthorizer referencing the imported authorizer ARN', () => {
      // TOKEN type matches the existing tenant_authorizer.py Lambda which
      // reads event.authorizationToken (only populated by TOKEN-type auth).
      t.hasResourceProperties(
        'AWS::ApiGateway::Authorizer',
        Match.objectLike({
          Type: 'TOKEN',
          IdentitySource: 'method.request.header.Authorization',
        }),
      );
    });

    it('adds 5 GET methods protected by the custom authorizer', () => {
      const methods = t.findResources('AWS::ApiGateway::Method', {
        Properties: {
          HttpMethod: 'GET',
          AuthorizationType: 'CUSTOM',
        },
      });
      expect(Object.keys(methods).length).toBeGreaterThanOrEqual(5);
    });

    it('adds 5 OPTIONS mock integrations for CORS preflight', () => {
      const optionsMethods = t.findResources('AWS::ApiGateway::Method', {
        Properties: {
          HttpMethod: 'OPTIONS',
          AuthorizationType: 'NONE',
        },
      });
      expect(Object.keys(optionsMethods).length).toBeGreaterThanOrEqual(5);
    });

    it('creates Lambda invoke permissions for API Gateway', () => {
      const perms = t.findResources('AWS::Lambda::Permission', {
        Properties: {
          Principal: 'apigateway.amazonaws.com',
          Action: 'lambda:InvokeFunction',
        },
      });
      expect(Object.keys(perms).length).toBeGreaterThanOrEqual(5);
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
