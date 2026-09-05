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
import { AnalyticsStack, type AnalyticsStackProps } from './analytics-stack';

function synth(overrides: Partial<AnalyticsStackProps> = {}) {
  const app = new cdk.App();
  // tenantSeederLambda needs an IFunction. Creating a placeholder Lambda in a
  // helper stack is the canonical CDK test pattern for cross-stack references
  // under Template.fromStack.
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
    tenantSeederLambda,
    corsAllowedOrigins:
      'https://test-tenant-frontend.example.com,https://test-frontend-*.preview.example.com',
    env: { account: '111111111111', region: 'us-east-2' },
    ...overrides,
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

    it('Lambda is Node 22 with correct memory/timeout (reserved concurrency intentionally unset)', () => {
      // We do NOT set reservedConcurrentExecutions in UAT because the
      // account's ConcurrentExecutions quota is too low (10). Deferred
      // until quota raise; see analytics-stack.ts for the note.
      t.hasResourceProperties(
        'AWS::Lambda::Function',
        Match.objectLike({
          FunctionName: 'edforge-analytics-aggregator',
          Runtime: Match.stringLikeRegexp('^nodejs22'),
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

  describe('2.6 CloudWatch alarms (consolidated, cost-redesign C0.4)', () => {
    it('emits exactly three alarms: analytics functions, control-plane functions, rollup heartbeat', () => {
      t.resourceCountIs('AWS::CloudWatch::Alarm', 3);
    });

    it('analytics-functions alarm sums every function error term plus the aggregator DLQ, FILLed to 0', () => {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'edforge-analytics-functions-errors',
        Threshold: 0,
        ComparisonOperator: 'GreaterThanThreshold',
        EvaluationPeriods: 1,
        TreatMissingData: 'notBreaching',
        Metrics: Match.arrayWith([
          Match.objectLike({
            Expression:
              'FILL(agg, 0) + FILL(dlq, 0) + FILL(rollup, 0) + FILL(report, 0) + IF(FILL(iemis, 0) > 2, 1, 0) + IF(FILL(fin, 0) > 2, 1, 0)',
          }),
          Match.objectLike({ Id: 'agg' }),
          Match.objectLike({ Id: 'dlq' }),
          Match.objectLike({ Id: 'rollup' }),
          Match.objectLike({ Id: 'report' }),
          Match.objectLike({ Id: 'iemis' }),
          Match.objectLike({ Id: 'fin' }),
        ]),
      });
    });

    it('control-plane-functions alarm wraps the tenant-seeder errors in metric math (C7.3 adds terms)', () => {
      t.hasResourceProperties('AWS::CloudWatch::Alarm', {
        AlarmName: 'edforge-control-plane-functions-errors',
        Threshold: 0,
        ComparisonOperator: 'GreaterThanThreshold',
        Metrics: Match.arrayWith([
          Match.objectLike({ Expression: 'FILL(seeder, 0)' }),
          Match.objectLike({ Id: 'seeder' }),
        ]),
      });
    });

    it('retired alarms are gone', () => {
      const alarms = Object.values(t.findResources('AWS::CloudWatch::Alarm')).map(
        (r) => (r as { Properties: { AlarmName: string } }).Properties.AlarmName,
      );
      for (const retired of [
        'edforge-analytics-aggregator-dlq-depth',
        'edforge-analytics-aggregator-throttles',
        'edforge-analytics-landing-wcu-burst',
        'edforge-analytics-aggregator-errors',
        'edforge-tenant-seeder-errors',
        'edforge-alb-5xx-surge',
        'edforge-finance-sequence-latency-p95',
        'edforge-iemis-job-janitor-errors',
        'edforge-finance-job-janitor-errors',
        'edforge-report-aggregator-errors',
      ]) {
        expect(alarms).not.toContain(retired);
      }
    });
  });

  describe('dashboards (cost-redesign C0.3)', () => {
    it('emits two dashboards — the fourth account-wide dashboard crossed the free tier', () => {
      t.resourceCountIs('AWS::CloudWatch::Dashboard', 2);
      const names = Object.values(t.findResources('AWS::CloudWatch::Dashboard')).map(
        (r) => (r as { Properties: { DashboardName?: string } }).Properties.DashboardName,
      );
      expect(names).not.toContain('edforge-finance-performance');
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
          Runtime: Match.stringLikeRegexp('^nodejs22'),
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
          Runtime: Match.stringLikeRegexp('^nodejs22'),
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

  describe('API-A left behind (C6.2)', () => {
    it('owns no API Gateway resource, method or authorizer, and imports nothing from API-A', () => {
      t.resourceCountIs('AWS::ApiGateway::Authorizer', 0);
      t.resourceCountIs('AWS::ApiGateway::Method', 0);
      t.resourceCountIs('AWS::ApiGateway::Resource', 0);
      const body = JSON.stringify(t.toJSON());
      for (const name of ['TenantApiRestApiId', 'TenantApiRootResourceId', 'TenantApiAuthorizerArn']) expect(body).not.toContain(name);
      expect(body).not.toContain('AWS/ApplicationELB');
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

  // ============================================================
  // 2026-05-27 regression guard — PdfAssetsBucket CORS
  // ============================================================
  describe('PdfAssetsBucket CORS (regression guard, 2026-05-27)', () => {
    it('declares CORS rules for the M3 phase 2 browser-direct upload flow', () => {
      // Without this CorsConfiguration, Chrome's OPTIONS preflight before
      // the presigned-PUT gets no Access-Control-Allow-Origin from S3 and
      // blocks the upload before it ever leaves the browser. Discovered
      // by Sprint M3 phase 2 testing (edforge-saas-frontend PR #90) on
      // 2026-05-27, after the AWS SDK v3 checksum bug was already fixed
      // (server PR #209). The two bugs were orthogonal — both needed
      // fixing before asset upload worked end-to-end.
      //
      // Origins are propagated from the operator-supplied
      // CDK_PARAM_CORS_ALLOWED_ORIGINS via the corsAllowedOrigins prop;
      // the test fixture above uses two synthetic example origins so
      // the assertion can verify the propagation pipeline regardless
      // of any operator-specific deployment URL.
      t.hasResourceProperties('AWS::S3::Bucket', {
        BucketName: Match.stringLikeRegexp('^edforge-pdf-assets-'),
        CorsConfiguration: {
          CorsRules: Match.arrayWith([
            Match.objectLike({
              Id: 'm3-phase2-branding-asset-upload',
              AllowedMethods: Match.arrayWith(['PUT', 'GET', 'HEAD']),
              AllowedOrigins: Match.arrayWith([
                'https://test-tenant-frontend.example.com',
                'https://test-frontend-*.preview.example.com',
              ]),
              AllowedHeaders: ['*'],
              ExposedHeaders: Match.arrayWith(['ETag']),
              MaxAge: 3000,
            }),
          ]),
        },
      });
    });
  });
});

describe('API-B invoke permission (cost-redesign C2.7, unconditional since C8.5)', () => {
  const apiBPermission = (t: Template) =>
    Object.values(t.findResources('AWS::Lambda::Permission')).filter((r) => JSON.stringify(r.Properties.SourceArn ?? '').includes('TenantApiLambdaRestApiId'));

  it('grants apigateway.amazonaws.com on the API function scoped to the imported API-B id', () => {
    const perms = apiBPermission(synth());
    expect(perms).toHaveLength(1);
    expect(perms[0].Properties.Principal).toBe('apigateway.amazonaws.com');
    expect(JSON.stringify(perms[0].Properties.SourceArn)).toContain('/*/*/*');
  });
});

describe('reports-staging bucket — IEMIS staging expiry (cost-redesign C3.11)', () => {
  it('expires tagged iemis-import objects after a day and leaves the untagged archive transition alone', () => {
    const t = synth();
    const buckets = Object.values(t.findResources('AWS::S3::Bucket')).filter((b) => String(b.Properties.BucketName ?? '').includes('reports-staging'));
    expect(buckets).toHaveLength(1);
    const rules = buckets[0].Properties.LifecycleConfiguration.Rules as Array<Record<string, unknown>>;
    const expire = rules.find((r) => r.Id === 'expire-iemis-import-staging');
    expect(expire).toEqual(expect.objectContaining({ Status: 'Enabled', ExpirationInDays: 1, TagFilters: [{ Key: 'edforge:ephemeral', Value: 'iemis-import' }] }));
    expect(rules.find((r) => r.Id === 'transition-to-archive')).toBeDefined();
  });
});

describe('job janitors — cost-redesign Sprint 8 (sparse running-jobs index)', () => {
  const t = synth();
  const policies = Object.values(t.findResources('AWS::IAM::Policy')) as Array<{
    Properties: { PolicyDocument: { Statement: Array<{ Action: string | string[]; Resource: unknown }> } };
  }>;
  const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
  const actionsOf = (st: { Action: string | string[] }) => (Array.isArray(st.Action) ? st.Action : [st.Action]);

  it('both janitors sweep every 15 minutes', () => {
    const schedules = Object.values(t.findResources('AWS::Scheduler::Schedule')) as Array<{
      Properties: { ScheduleExpression: string };
    }>;
    const every15 = schedules.filter((s) => s.Properties.ScheduleExpression === 'cron(*/15 * * * ? *)');
    expect(every15).toHaveLength(2);
    expect(schedules.some((s) => s.Properties.ScheduleExpression === 'cron(*/5 * * * ? *)')).toBe(false);
  });

  it('neither janitor may Scan its table; each Queries the table\'s GSI15', () => {
    const scanTargets = statements
      .filter((st) => actionsOf(st).includes('dynamodb:Scan'))
      .map((st) => JSON.stringify(st.Resource));
    for (const table of ['edforge-academics-basic', 'edforge-finance-basic']) {
      expect(scanTargets.some((r) => r.includes(`table/${table}`))).toBe(false);
    }
    const queryResources = statements
      .filter((st) => actionsOf(st).includes('dynamodb:Query'))
      .map((st) => JSON.stringify(st.Resource));
    for (const table of ['edforge-academics-basic', 'edforge-finance-basic']) {
      expect(queryResources.some((r) => r.includes(`table/${table}/index/GSI15`))).toBe(true);
    }
  });
});
