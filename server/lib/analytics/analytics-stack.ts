/**
 * AnalyticsStack — Layer 2 infrastructure for EdForge Usage Analytics.
 *
 * Contents:
 *   2.1 EdforgeAnalyticsTable (aggregates)
 *   2.2 AnalyticsEventsLandingTable (raw events, idempotency check)
 *   2.3 UserSessionEventsTable (per-user session history)
 *   2.4 AnalyticsAggregatorLambda + AnalyticsAggregatorDLQ (SEPARATE from the
 *       existing bus DLQ — cardinal rule: do NOT modify event-dlq-stack)
 *   2.5 Two EventBridge rules on the SBT bus (edforge.analytics + domain events)
 *   2.6 CloudWatch dashboard + alarms (DLQ depth, WCU burst, Lambda throttles)
 *   2.7 SNS operator alert topic
 *
 * Per-tenant alert topics are created by provision-tenant.sh at provisioning
 * time (Layer 3.1), not pre-created here.
 */

import * as cdk from 'aws-cdk-lib';
import { ANALYTICS_API_FUNCTION_NAME } from '../utilities/function-names';
import { grantApiBInvoke } from '../utilities/api-b-invoke';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as events from 'aws-cdk-lib/aws-events';
import * as eventsTargets from 'aws-cdk-lib/aws-events-targets';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as path from 'path';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ScheduledLambda } from '../cdk-patterns/scheduled-lambda';
import { isProdAccount } from '../utilities/account-guards';
import { AnalyticsNag } from '../cdknag/analytics-nag';

export interface AnalyticsStackProps extends cdk.StackProps {
  /**
   * Name of the SBT EventBridge bus exported by controlplane-stack.
   * Obtained from `controlPlaneStack.eventBusName` in bin/.
   */
  readonly eventBusName: string;

  /**
   * Email subscribed to the operator alert topic. Required — every
   * alarm in this stack routes here. In dev/UAT you can set this to
   * a shared dev alias; in prod it must be a monitored inbox.
   */
  readonly operatorAlertEmail: string;

  /**
   * Cost-redesign C2.7 — let API-B (the strangler REST API on Lambda) invoke
   * the analytics API function through its `analyticsFn` stage variable.
   * Wired from CDK_PARAM_LAMBDA_SERVICES in bin/; imports API-B's REST API id
   * from shared-infra, so that stack deploys first. The API-A attach below
   * stays until the frontend has left API-A (C6.3).
   */
  readonly apiBInvokePermission?: boolean;

  /**
   * Controls ANALYTICS_ENABLED env var on the aggregator Lambda.
   * Default: 'false'. Flipping to 'true' is the post-deploy activation
   * step (Layer 11 deploy sequence step 8).
   */
  readonly analyticsEnabled?: string;


  /**
   * Phase 4 (Sprint I-2) — tenant-seeder Lambda reference. Error alarm
   * on this function catches `sbt_aws_provisionSuccess` consumer crashes,
   * which would leave a tenant with an ECS stack deployed but no identity
   * METADATA + SETTINGS#WORKSPACE rows written.
   */
  readonly tenantSeederLambda: lambda.IFunction;

  /**
   * Comma-separated list of CORS allowed origins, sourced from
   * `CDK_PARAM_CORS_ALLOWED_ORIGINS` at the entry point. Applied to the
   * pdfAssetsBucket CORS rule so the browser-direct presigned-PUT flow
   * (Sprint M3 phase 2) works against operator-specific tenant frontend
   * URLs. Each operator sets this to the URLs that should be allowed —
   * e.g., `https://your-tenant-frontend.example.com,https://your-frontend-*.vercel.app`
   * — and EdForge does not assume any specific deployment surface.
   */
  readonly corsAllowedOrigins: string;
}

export class AnalyticsStack extends cdk.Stack {
  public readonly analyticsTable: dynamodb.Table;
  public readonly landingTable: dynamodb.Table;
  public readonly userSessionEventsTable: dynamodb.Table;
  public readonly aggregatorLambda: lambda.IFunction;
  public readonly aggregatorDlq: sqs.Queue;
  public readonly operatorAlertTopic: sns.Topic;
  public readonly rollupLambda: lambda.IFunction;
  public readonly apiLambda: lambda.IFunction;
  public readonly exportBucket: s3.Bucket;
  public readonly iemisJobJanitorLambda: lambda.IFunction;
  public readonly financeJobJanitorLambda: lambda.IFunction;
  public readonly reportingStagingBucket: s3.Bucket;
  public readonly reportingArchiveBucket: s3.Bucket;
  public readonly reportAggregatorLambda: lambda.IFunction;
  public readonly reportingSchedulerLambda: lambda.IFunction;
  // Sprint C.0.6 — PDF Generation Service storage.
  // pdfsBucket: short-lived render outputs (pdf-jobs/* expires 7d). Consumed
  //   by edforge-pdf-batch Lambda (C.4.1) and synchronous render endpoints
  //   (C.1+) for audit-copy persistence if/when that pattern is added.
  // pdfAssetsBucket: long-lived branding assets (logos, signatures,
  //   letterhead backgrounds). Versioned. Consumed by identity ECS via the
  //   presigned-PUT endpoint shipped in C.0.7.
  // Both buckets are intentionally NOT exposed via CfnOutput / cross-stack
  // export — consumers reconstruct the name from the canonical
  // `edforge-{pdfs|pdf-assets}-${account}-${region}` convention or read it
  // from an env var injected at deploy time. Per CLAUDE.md R46 mitigation
  // ("Cross-stack export change pre-flight" rule).
  public readonly pdfsBucket: s3.Bucket;
  public readonly pdfAssetsBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: AnalyticsStackProps) {
    super(scope, id, props);

    // ------------------------------------------------------------
    // 2.7 SNS operator alert topic (built first so alarms can route)
    // ------------------------------------------------------------
    this.operatorAlertTopic = new sns.Topic(this, 'OperatorAlertTopic', {
      topicName: 'edforge-alerts-operator',
      displayName: 'EdForge Operator Alerts',
    });
    this.operatorAlertTopic.addSubscription(
      new snsSubs.EmailSubscription(props.operatorAlertEmail),
    );

    // ------------------------------------------------------------
    // 2.1 EdforgeAnalyticsTable — aggregates (DAY/WEEK/MONTH + FLEET#ALL)
    //
    // PK: TENANT#<tenantId>  or  FLEET#ALL
    // SK: <bucket>#<yyyy-mm-dd>#<metric>[#role=..][#school=..]
    // bucket ∈ {DAY, WEEK, MONTH}
    // TTL (expireAt): DAY=90d, WEEK/MONTH=13mo (set by writers in L5/L6)
    // ------------------------------------------------------------
    this.analyticsTable = new dynamodb.Table(this, 'AnalyticsTable', {
      tableName: 'edforge-analytics',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'expireAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      deletionProtection: isProdAccount(),
    });
    // Layer 6.4 — GSI1 for fleet-wide "top features" queries. Zero-downtime
    // add: DynamoDB backfills existing rows. Writers are expected to set
    // GSI1PK=FEATURE#<metric> and GSI1SK=<yyyy-mm-dd>#<tenantId> — the
    // aggregator (Layer 5) adds these attributes when writing DAY rows;
    // rollup writes are partitioned under different SKs and don't set them.
    this.analyticsTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // ------------------------------------------------------------
    // 2.2 AnalyticsEventsLandingTable — raw event idempotency store
    // ------------------------------------------------------------
    this.landingTable = new dynamodb.Table(this, 'LandingTable', {
      tableName: 'edforge-analytics-landing',
      partitionKey: { name: 'eventId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'expireAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      deletionProtection: isProdAccount(),
    });

    // ------------------------------------------------------------
    // 2.3 UserSessionEventsTable — dedicated store for end-user session
    //     history (GET /me/session-history)
    //
    // PK: USER#<userId>
    // SK: EVENT#<ts>#<eventId>
    // TTL (expireAt): 13 months
    // ------------------------------------------------------------
    this.userSessionEventsTable = new dynamodb.Table(this, 'UserSessionEventsTable', {
      tableName: 'edforge-user-session-events',
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      timeToLiveAttribute: 'expireAt',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      deletionProtection: isProdAccount(),
    });

    // ------------------------------------------------------------
    // 2.4 AnalyticsAggregatorLambda + separate DLQ
    //
    // Reserved concurrency of 20 = cost guardrail (cap runaway invocations).
    // The DLQ is NEW and belongs to this stack. The existing bus DLQ at
    // event-dlq-stack.ts stays untouched per cardinal rule.
    // ------------------------------------------------------------
    this.aggregatorDlq = new sqs.Queue(this, 'AggregatorDLQ', {
      queueName: 'edforge-analytics-aggregator-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    this.aggregatorLambda = new lambdaNodejs.NodejsFunction(
      this,
      'AggregatorFunction',
      {
        functionName: 'edforge-analytics-aggregator',
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambda/aggregator/handler.ts'),
        handler: 'handler',
        memorySize: 512,
        timeout: cdk.Duration.seconds(60),
        // NOTE: reservedConcurrentExecutions intentionally NOT set.
        // UAT/dev accounts commonly have a reduced ConcurrentExecutions
        // quota (observed: 10). Any reservation on a single Lambda
        // violates the "≥10 unreserved must remain" rule and blocks
        // stack create. Cost guardrail is deferred until account quota
        // is raised (service-quotas L-B99A9384).
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
          LANDING_TABLE_NAME: this.landingTable.tableName,
          USER_SESSION_EVENTS_TABLE_NAME: this.userSessionEventsTable.tableName,
          ANALYTICS_ENABLED: props.analyticsEnabled ?? 'false',
          EVENT_BUS_NAME: props.eventBusName,
          AGGREGATOR_DLQ_URL: this.aggregatorDlq.queueUrl,
          // A-WS1.T7: identity table for tenant-settings resolver. V1 BASIC
          // tier only; multi-tier support deferred until Advanced/Premium ship.
          IDENTITY_TABLE_NAME: 'edforge-identity-basic',
        },
        description:
          'Layer 2 scaffold: lands raw events to the landing table with ' +
          'idempotent ConditionalPutItem. Full aggregation logic lands in Layer 5.',
      },
    );

    // IAM — PutItem on all three tables + CW PutMetricData + EventBridge
    // PutEvents (for TenantDormant emission in Layer 6, granted now per plan).
    this.landingTable.grantWriteData(this.aggregatorLambda);
    this.analyticsTable.grantWriteData(this.aggregatorLambda);
    this.userSessionEventsTable.grantWriteData(this.aggregatorLambda);
    // A-WS1.T7: read-only access to identity table for workspace settings.
    // Narrow grant: GetItem only (resolver does not need Query/Scan/Write).
    // Single table ARN; per-tier table ARNs would need to be added when
    // Advanced/Premium tiers ship.
    this.aggregatorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'TenantSettingsRead',
        actions: ['dynamodb:GetItem'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-basic`,
        ],
      }),
    );
    this.aggregatorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'], // PutMetricData requires '*' per AWS docs
        conditions: {
          StringEquals: { 'cloudwatch:namespace': 'Edforge/Analytics' },
        },
      }),
    );
    this.aggregatorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [
          `arn:aws:events:${this.region}:${this.account}:event-bus/${props.eventBusName}`,
        ],
      }),
    );
    // SQS SendMessage to its OWN DLQ (for manual DLQ sends from L5 validation path)
    this.aggregatorDlq.grantSendMessages(this.aggregatorLambda);

    // ------------------------------------------------------------
    // 2.5 EventBridge rules on the SBT bus
    //
    // Rule A  — edforge-analytics-native   source=edforge.analytics
    // Rule B  — edforge-domain-events      source ∈ {edforge.academics-service,
    //                                                edforge.finance-service,
    //                                                edforge.identity-service}
    // Both route to the aggregator Lambda with AggregatorDLQ as the
    // per-target DLQ.
    // ------------------------------------------------------------
    const bus = events.EventBus.fromEventBusName(this, 'SbtBus', props.eventBusName);

    const ruleNative = new events.Rule(this, 'AnalyticsNativeRule', {
      ruleName: 'edforge-analytics-native',
      eventBus: bus,
      eventPattern: { source: ['edforge.analytics'] },
      description: 'Native edforge.analytics events → analytics aggregator',
    });
    ruleNative.addTarget(
      new eventsTargets.LambdaFunction(this.aggregatorLambda, {
        deadLetterQueue: this.aggregatorDlq,
        retryAttempts: 2,
        maxEventAge: cdk.Duration.minutes(5),
      }),
    );

    const ruleDomain = new events.Rule(this, 'AnalyticsDomainRule', {
      ruleName: 'edforge-domain-events',
      eventBus: bus,
      eventPattern: {
        source: [
          'edforge.academics-service',
          'edforge.finance-service',
          'edforge.identity-service',
        ],
      },
      description: 'Domain service events (academics/finance/identity) → analytics aggregator',
    });
    ruleDomain.addTarget(
      new eventsTargets.LambdaFunction(this.aggregatorLambda, {
        deadLetterQueue: this.aggregatorDlq,
        retryAttempts: 2,
        maxEventAge: cdk.Duration.minutes(5),
      }),
    );

    // ------------------------------------------------------------
    // 2.6 CloudWatch dashboard + alarms
    // ------------------------------------------------------------
    const dashboard = new cloudwatch.Dashboard(this, 'AnalyticsDashboard', {
      dashboardName: 'edforge-analytics-health',
    });

    const invocationsMetric = this.aggregatorLambda.metricInvocations({
      period: cdk.Duration.minutes(5),
    });
    const errorsMetric = this.aggregatorLambda.metricErrors({
      period: cdk.Duration.minutes(5),
    });
    const durationP50 = this.aggregatorLambda.metricDuration({
      statistic: 'p50',
      period: cdk.Duration.minutes(5),
    });
    const durationP99 = this.aggregatorLambda.metricDuration({
      statistic: 'p99',
      period: cdk.Duration.minutes(5),
    });
    const throttlesMetric = this.aggregatorLambda.metricThrottles({
      period: cdk.Duration.minutes(5),
    });
    const dlqDepthMetric = this.aggregatorDlq.metricApproximateNumberOfMessagesVisible({
      period: cdk.Duration.minutes(5),
    });

    dashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Aggregator Lambda — invocations & errors',
        left: [invocationsMetric, errorsMetric],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Aggregator Lambda — duration (p50/p99)',
        left: [durationP50, durationP99],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Aggregator DLQ depth',
        left: [dlqDepthMetric],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Landing + Aggregates — WCU consumed',
        left: [
          this.landingTable.metricConsumedWriteCapacityUnits({
            period: cdk.Duration.minutes(5),
          }),
          this.analyticsTable.metricConsumedWriteCapacityUnits({
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
      }),
    );

    // Alarms for the analytics functions are consolidated into ONE
    // metric-math alarm created after every function exists (search for
    // 'AnalyticsFunctionsErrorsAlarm' below). Cost-redesign C0.4 holds the
    // account to ten alarms; the aggregator DLQ depth is a term in that alarm,
    // the throttle and landing-WCU-burst alarms were retired (both dashboards
    // still graph the metrics).

    // ==========================================================
    // Phase 4 (Sprint I-2) — pilot observability alarms + dashboard
    //
    // The existing alarms above watch analytics-stack internals. The block
    // below watches the **tenant-facing surface** (ALB 5xx), the
    // **onboarding path** (tenant-seeder errors), and the **analytics path
    // symptom** (aggregator errors — previously only throttles were watched).
    // All three route to the existing operator topic so subscribers don't
    // fan out.
    // ==========================================================

    // Alarm: control-plane functions errors (CRITICAL).
    // Tenant-seeder writes the identity METADATA + SETTINGS#WORKSPACE rows
    // when SBT emits sbt_aws_provisionSuccess. A failure here means the
    // tenant is un-usable — PABSON gate can't fire, workspace settings are
    // missing. Every failure blocks a new tenant. Expressed as metric math so
    // the provisioner/deprovisioner Lambdas (cost-redesign C7.3) can be added
    // as further terms without a new alarm; FILL keeps a quiet period from
    // reading as INSUFFICIENT_DATA.
    const tenantSeederErrorsMetric = props.tenantSeederLambda.metricErrors({
      period: cdk.Duration.minutes(5),
      statistic: 'Sum',
    });
    const controlPlaneErrorsAlarm = new cloudwatch.Alarm(this, 'TenantSeederErrorAlarm', {
      alarmName: 'edforge-control-plane-functions-errors',
      alarmDescription:
        'A tenant-lifecycle Lambda (tenant-seeder) errored. A just-provisioned tenant is likely missing identity METADATA/SETTINGS rows — the tenant cannot log in or create schools until manually repaired.',
      metric: new cloudwatch.MathExpression({
        expression: 'FILL(seeder, 0)',
        usingMetrics: { seeder: tenantSeederErrorsMetric },
        period: cdk.Duration.minutes(5),
        label: 'Control-plane function errors',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    controlPlaneErrorsAlarm.addAlarmAction(new cwActions.SnsAction(this.operatorAlertTopic));

    // ALB tenant-facing 5xx metric — graphed on the pilot dashboard below.
    // The standalone surge alarm was retired in cost-redesign C0.4 (ten-alarm
    // budget; the ALB itself is removed in C6.3 and this metric with it).
    //
    // Using a raw Metric (not a helper) because the ALB ref lives in
    // shared-infra-stack (an UPSTREAM dependency via controlplane-stack)
    // and we get the LoadBalancer dimension as a string prop to avoid
    // cross-stack coupling beyond what CFN exports already exist for.

    // ----------------------------------------------------------
    // Unified pilot dashboard.
    //
    // The existing `edforge-analytics-health` dashboard covers analytics
    // internals. This new dashboard gives operators a single "is pilot
    // healthy?" screen. Both dashboards stay — analytics-health is the
    // deep-dive view, pilot is the at-a-glance summary.
    // ----------------------------------------------------------
    const pilotDashboard = new cloudwatch.Dashboard(this, 'PilotDashboard', {
      dashboardName: 'edforge-pilot',
    });

    pilotDashboard.addWidgets(
      new cloudwatch.TextWidget({
        markdown:
          '# EdForge Pilot Health\n' +
          '**Alerts route to:** `edforge-alerts-operator` (live-tenant) + `edforge-provisioning-alerts` (onboarding).\n\n' +
          'Runbook: `docs/operations/saraswati-oncall.md` · Drill SOP: `docs/operations/paging-drill.md` · SLOs: `docs/operations/saraswati-slos.md`',
        width: 24,
        height: 3,
      }),
    );

    pilotDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Aggregator Lambda — errors & throttles (CRITICAL if >0)',
        left: [errorsMetric, throttlesMetric],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Tenant-seeder Lambda — errors (CRITICAL if >0)',
        left: [
          tenantSeederErrorsMetric,
          props.tenantSeederLambda.metricInvocations({ period: cdk.Duration.minutes(5) }),
        ],
        width: 12,
      }),
    );

    // DDB: throttle observation (NOT paging — on-demand tables rarely
    // throttle, but when they do it's always a pilot-impacting symptom).
    // Widget only; operators see it on the dashboard and can add an alarm
    // later if pilot load proves it worth paging on.
    const basicTables = ['edforge-identity-basic', 'edforge-academics-basic', 'edforge-finance-basic'];
    pilotDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'DDB basic tables — read throttles',
        left: basicTables.map(
          (t) =>
            new cloudwatch.Metric({
              namespace: 'AWS/DynamoDB',
              metricName: 'ReadThrottleEvents',
              dimensionsMap: { TableName: t },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
              label: t,
            }),
        ),
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'DDB basic tables — write throttles',
        left: basicTables.map(
          (t) =>
            new cloudwatch.Metric({
              namespace: 'AWS/DynamoDB',
              metricName: 'WriteThrottleEvents',
              dimensionsMap: { TableName: t },
              statistic: 'Sum',
              period: cdk.Duration.minutes(5),
              label: t,
            }),
        ),
        width: 12,
      }),
    );

    // CodeBuild provisioning visibility — the project name is a Token at
    // synth time (SBT-generated hash), and analytics-stack is a dependency
    // of core-appplane-stack (where the CodeBuild lives), so passing the
    // name back here would be a circular reference. Leave the widget as
    // a pointer to the alarm name instead; operators click through from
    // the alarms pane.
    pilotDashboard.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'Aggregator DLQ depth (alarm fires at 15+ min > 0)',
        left: [dlqDepthMetric],
        width: 12,
      }),
      new cloudwatch.TextWidget({
        markdown:
          '## Provisioning health\n' +
          '- Alarm: `edforge-provisioning-codebuild-failures` (core-appplane-stack) — routes to `edforge-provisioning-alerts` topic\n' +
          '- Alarm: `edforge-deprovisioning-codebuild-failures` (core-appplane-stack) — routes to `edforge-provisioning-alerts` topic\n' +
          '- Runbook: `docs/operations/saraswati-oncall.md` → "Tenant provisioning failed"\n' +
          '- Root cause commonly: ISSUE-008 (SBT masks CodeBuild failure), DDB table conflict, ECR pull throttled',
        width: 12,
        height: 6,
      }),
    );

    // ============================================================
    // Finance hot-path metrics (issues #344 + #345).
    //
    // The `edforge-finance-performance` dashboard and the
    // `edforge-finance-sequence-latency-p95` alarm that lived here were
    // retired in the cost-redesign (tickets C0.3 / C0.4): the dashboard was
    // the account's fourth and crossed the three-free-dashboards line
    // ($3.00/month), and the account is held to ten alarms. The finance
    // service still emits Edforge/Finance/Sequence and
    // Edforge/Finance/BulkWorker; the SEARCH expressions to graph them
    // ad hoc are in docs/operations/finance-hot-path-dashboard.md.
    // ============================================================

    // ------------------------------------------------------------
    // Sprint 1 (rework) — analytics-api Lambda + export bucket
    //
    // The 5 Layer 7 read endpoints used to live in the identity ECS service.
    // Refactored to a Lambda fronted directly by API Gateway (Sprint 2 wires
    // the routes). Reserved concurrency = 5 to cap cost/throttle blast
    // radius. Will revisit when AWS account quota is raised (Sprint 4.T1).
    // ------------------------------------------------------------
    this.exportBucket = new s3.Bucket(this, 'ExportBucket', {
      bucketName: `edforge-analytics-exports-${this.account}-${this.region}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'expire-exports-1d',
          enabled: true,
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    this.apiLambda = new lambdaNodejs.NodejsFunction(this, 'ApiLambda', {
      functionName: ANALYTICS_API_FUNCTION_NAME,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambda/api/handler.ts'),
      handler: 'handler',
      memorySize: 1024,
      timeout: cdk.Duration.seconds(30),
      logRetention: logs.RetentionDays.ONE_MONTH,
      environment: {
        ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
        USER_SESSION_EVENTS_TABLE_NAME: this.userSessionEventsTable.tableName,
        EXPORT_BUCKET_NAME: this.exportBucket.bucketName,
        SYSTEM_ADMIN_EMAILS: '',
        CORS_ALLOWED_ORIGIN: '*',
        // A-WS2.T3: identity table for tenant-settings resolver. V1 BASIC only.
        IDENTITY_TABLE_NAME: 'edforge-identity-basic',
      },
      description:
        'Sprint-1 rework — serves the 5 Layer 7 read endpoints (tenant series, adoption report, fleet, session history, CSV export URL).',
    });
    this.analyticsTable.grantReadData(this.apiLambda);
    this.userSessionEventsTable.grantReadData(this.apiLambda);
    this.exportBucket.grantReadWrite(this.apiLambda);
    if (props.apiBInvokePermission) grantApiBInvoke(this.apiLambda);
    // A-WS2.T3: read-only access to identity table for tenant settings.
    // Same narrow grant as the aggregator (GetItem only).
    this.apiLambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'TenantSettingsRead',
        actions: ['dynamodb:GetItem'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-basic`,
        ],
      }),
    );

    // A-WS2.T3: route WorkspaceSettingsUpdated events from identity-service
    // to the api Lambda for cache invalidation. Reuses the same SBT bus as
    // the aggregator. Separate from the aggregator rule so a future filter
    // change on one doesn't unintentionally affect the other.
    const settingsBus = events.EventBus.fromEventBusName(
      this,
      'SbtBusForApiLambda',
      props.eventBusName,
    );
    new events.Rule(this, 'WorkspaceSettingsUpdatedToApiLambda', {
      ruleName: 'edforge-workspace-settings-updated-to-api',
      description:
        'A-WS2.T3 — route WorkspaceSettingsUpdated events to the analytics-api Lambda so its in-memory tenant-settings cache is invalidated within seconds.',
      eventBus: settingsBus,
      eventPattern: {
        source: ['edforge.identity-service'],
        detailType: ['WorkspaceSettingsUpdated'],
      },
      targets: [
        new eventsTargets.LambdaFunction(this.apiLambda, {
          retryAttempts: 2,
        }),
      ],
    });


    // S2.T4 — Lambda invoke permission is auto-created by LambdaIntegration
    // for each method. No explicit Lambda.addPermission needed; CDK emits
    // one AWS::Lambda::Permission resource per (method, integration).

    // ------------------------------------------------------------
    // Layer 6.3 — AnalyticsRollupLambda (scheduled daily at 01:00 Kathmandu)
    //
    // EventBridge Scheduler cron has the Kathmandu offset baked in via
    // scheduleExpressionTimezone, so we can write a human-readable cron here.
    // ------------------------------------------------------------
    const rollup = new ScheduledLambda(this, 'RollupLambda', {
      schedule: 'cron(0 1 * * ? *)', // daily at 01:00 local time
      timezone: 'Asia/Kathmandu',
      lambdaProps: {
        functionName: 'edforge-analytics-rollup',
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambda/rollup/handler.ts'),
        handler: 'handler',
        memorySize: 512,
        timeout: cdk.Duration.minutes(5),
        // Rollup is single-threaded by design (one invocation per day via
        // Scheduler). reservedConcurrentExecutions: 1 would be ideal for
        // cost guardrail, but see aggregator note — UAT account quota
        // forbids any reservation. The once-a-day schedule makes this
        // effectively single-threaded anyway.
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          ANALYTICS_TABLE_NAME: this.analyticsTable.tableName,
          IDENTITY_TABLE_NAME: 'edforge-identity-basic',
          ANALYTICS_ENABLED: props.analyticsEnabled ?? 'false',
          EVENT_BUS_NAME: props.eventBusName,
        },
        description:
          'Layer 6.3 rollup — reads DAY rows, writes WEEK/MONTH + FLEET#ALL, emits TenantDormant on 3-week silence.',
      },
    });
    this.rollupLambda = rollup.lambda;

    // IAM — rollup needs full read/write on analytics table + read access
    // on identity (to enumerate tenants) + EventBridge PutEvents for
    // TenantDormant + CloudWatch PutMetricData.
    this.analyticsTable.grantReadWriteData(this.rollupLambda);
    this.rollupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Scan', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-basic`,
        ],
      }),
    );
    this.rollupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [
          `arn:aws:events:${this.region}:${this.account}:event-bus/${props.eventBusName}`,
        ],
      }),
    );
    this.rollupLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: { 'cloudwatch:namespace': 'Edforge/Analytics' },
        },
      }),
    );

    // Layer 6.5 — rollup heartbeat alarm: no successful invocation in 26h.
    const rollupInvocations = this.rollupLambda.metricInvocations({
      period: cdk.Duration.hours(1),
      statistic: 'Sum',
    });
    const rollupHeartbeat = new cloudwatch.Alarm(this, 'RollupHeartbeatAlarm', {
      alarmName: 'edforge-analytics-rollup-heartbeat',
      alarmDescription:
        'Rollup Lambda has not invoked successfully in 26 hours — WEEK/MONTH aggregates are stale.',
      metric: rollupInvocations,
      threshold: 1,
      evaluationPeriods: 26,
      datapointsToAlarm: 26,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
    });
    rollupHeartbeat.addAlarmAction(
      new cwActions.SnsAction(this.operatorAlertTopic),
    );

    // ------------------------------------------------------------
    // F-IEMIS-1 — IEMIS Job Janitor.
    //
    // Sweeps the academics DDB table every 5 min for orphan
    // IEMIS_IMPORT_JOB rows stuck in `status='running'` past a 30-min
    // staleness threshold and marks them `failed`. Without this, a row
    // sits in `running` forever if the academics ECS task dies mid-
    // import (deploy, OOM, ALB drain, autoscaling, post-infra-sunset/6
    // `desiredCount=1` recycle). Publishes a single SNS summary on any
    // sweep that touches >0 rows or hits an error.
    //
    // Lives in analytics-stack rather than core-appplane / tenant-
    // template because: (1) the operator-alert SNS topic is co-located
    // here and direct property access is cleaner than a cross-stack
    // import; (2) the academics table is referenced by name, not via a
    // tenant-stack export, so the janitor stays independent of any
    // per-tier provisioning lifecycle.
    //
    // Scan + FilterExpression is used (not a sparse GSI on `status`)
    // because adding a GSI would force a tenant-template-stack-basic
    // CDK deploy + GSI build on the existing table — a larger blast
    // radius. At pilot scale (~1–2 tenants, ~few thousand rows) the
    // 5-min Scan is well within bounds. If the table grows past ~50k
    // items or tenant count >10, add a sparse GSI on
    // (entityType='IEMIS_IMPORT_JOB', status='running') and switch the
    // janitor to Query.
    // ------------------------------------------------------------
    // V1 is BASIC-only (per CLAUDE.md). Mirror the identity-table hardcode at
    // line ~820 (`IDENTITY_TABLE_NAME: 'edforge-identity-basic'`). When the
    // Advanced / Premium tiers ship, this Lambda will need a multi-table
    // scan loop and a hand-written IAM policy with all three table ARNs.
    const academicsTableName = 'edforge-academics-basic';
    const janitor = new ScheduledLambda(this, 'IemisJobJanitorLambda', {
      schedule: 'cron(*/5 * * * ? *)', // every 5 minutes
      timezone: 'UTC',
      lambdaProps: {
        functionName: 'edforge-iemis-job-janitor',
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambda/iemis-job-janitor/handler.ts'),
        handler: 'handler',
        memorySize: 256,
        timeout: cdk.Duration.minutes(2),
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          ACADEMICS_TABLE_NAME: academicsTableName,
          ALERT_TOPIC_ARN: this.operatorAlertTopic.topicArn,
          STALE_THRESHOLD_MIN: '30',
        },
        description:
          'F-IEMIS-1 janitor — sweeps orphan IEMIS_IMPORT_JOB rows stuck in running state, marks them failed.',
      },
    });
    this.iemisJobJanitorLambda = janitor.lambda;

    // IAM — janitor needs Scan + UpdateItem on the academics table + SNS
    // Publish on the operator-alert topic. The table is in a different
    // CDK stack (tenant-template-stack-basic); we reference it by name
    // rather than cross-stack import, so the policy is hand-written.
    this.iemisJobJanitorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Scan', 'dynamodb:UpdateItem'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${academicsTableName}`,
        ],
      }),
    );
    this.operatorAlertTopic.grantPublish(this.iemisJobJanitorLambda);

    // Janitor errors are a term (tolerance: more than 2 in 15 min, a single
    // failed run is caught by the next 5-min cron) in the consolidated
    // AnalyticsFunctionsErrorsAlarm below.
    const janitorErrors = this.iemisJobJanitorLambda.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: 'Sum',
    });

    // ============================================================
    // Sprint I.1 — finance-job-janitor
    //
    // Sweeps orphan FINANCE_JOB rows stuck in `running` state in the finance
    // DDB table. Mirrors the iemis-job-janitor construct above; different
    // table + entityType + a longer staleness threshold (60 min vs 30) because
    // bulk PDF export legitimately runs 5+ min at scale.
    //
    // V1 is BASIC-only; when Advanced/Premium tiers ship, the finance table
    // list becomes multi-tier and this construct needs the same treatment as
    // the aggregator does.
    const financeTableName = 'edforge-finance-basic';
    const financeJanitor = new ScheduledLambda(this, 'FinanceJobJanitorLambda', {
      schedule: 'cron(*/5 * * * ? *)',
      timezone: 'UTC',
      lambdaProps: {
        functionName: 'edforge-finance-job-janitor',
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambda/finance-job-janitor/handler.ts'),
        handler: 'handler',
        memorySize: 256,
        timeout: cdk.Duration.minutes(2),
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          FINANCE_TABLE_NAME: financeTableName,
          ALERT_TOPIC_ARN: this.operatorAlertTopic.topicArn,
          STALE_THRESHOLD_MIN: '60',
        },
        description:
          'Sprint I.1 janitor — sweeps orphan FINANCE_JOB rows stuck in running state, marks them failed.',
      },
    });
    this.financeJobJanitorLambda = financeJanitor.lambda;

    this.financeJobJanitorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Scan', 'dynamodb:UpdateItem'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/${financeTableName}`,
        ],
      }),
    );
    this.operatorAlertTopic.grantPublish(this.financeJobJanitorLambda);

    const financeJanitorErrors = this.financeJobJanitorLambda.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: 'Sum',
    });

    // ============================================================
    // Sprint E.1 — Reporting subsystem
    //
    //  - 2 S3 buckets (staging + archive) for CSV exports
    //  - report-aggregator Lambda (consumes `reporting.snapshot_requested`
    //    EventBridge events emitted by the identity service when an operator
    //    POSTs /reporting/snapshots; reads identity + academics DDB, builds
    //    Flash I/II CSV, writes to staging bucket, updates the snapshot row
    //    + emits lifecycle event).
    //  - reporting-scheduler Lambda (daily cron at 02:00 Kathmandu / 20:15 UTC;
    //    publishes `SnapshotsPendingSubmission` CloudWatch metric per tenant).
    //  - EventBridge rule wiring + IAM for both Lambdas.
    //
    // Bucket layout:
    //   staging bucket — short-lived; auto-archive transition after 30d
    //   archive bucket — long-lived (multi-year compliance retention)
    // ============================================================
    const reportingStagingBucketName =
      `edforge-reports-staging-${this.account}-${this.region}`;
    const reportingArchiveBucketName =
      `edforge-reports-archive-${this.account}-${this.region}`;

    this.reportingStagingBucket = new s3.Bucket(this, 'ReportingStagingBucket', {
      bucketName: reportingStagingBucketName,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      enforceSSL: true,
      lifecycleRules: [
        {
          // Operator generally submits within days. Transition stale staging
          // objects to archive bucket after 30 days; leave them readable for
          // ad-hoc audit. Auto-delete is intentionally NOT enabled — every
          // historical CSV may be needed for CEHRD reconciliation.
          id: 'transition-to-archive',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.INFREQUENT_ACCESS,
              transitionAfter: cdk.Duration.days(30),
            },
          ],
        },
        {
          // Cost-redesign C3.11 — IEMIS import rows staged for the academics
          // worker (tenant=<id>/iemis-import/*, tagged at upload). The worker
          // deletes them after the run; this is the backstop, and it never
          // touches the CSVs above (no tag).
          id: 'expire-iemis-import-staging',
          enabled: true,
          tagFilters: { 'edforge:ephemeral': 'iemis-import' },
          expiration: cdk.Duration.days(1),
        },
      ],
    });

    this.reportingArchiveBucket = new s3.Bucket(this, 'ReportingArchiveBucket', {
      bucketName: reportingArchiveBucketName,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      lifecycleRules: [
        {
          id: 'long-term-cold',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: cdk.Duration.days(180),
            },
          ],
        },
      ],
    });

    // ============================================================
    // Sprint C.0.6 — PDF Generation Service S3 buckets
    //
    //   pdfsBucket: short-lived render outputs. Layout per
    //     c-epic-pdf-generation-design.md §4.5:
    //       tenants/{tenantId}/schools/{schoolId}/pdf-jobs/{jobId}/...
    //       tenants/{tenantId}/schools/{schoolId}/ad-hoc/{yyyy-mm-dd}/{uuid}.pdf
    //     Lifecycle: TAG-BASED (not prefix). Writers MUST tag pdf-jobs/*
    //     objects with { lifecycle: 'pdf-jobs' } at PutObject time so the
    //     bucket rule expires them at 7d. A literal prefix won't match here
    //     because pdf-jobs/ is buried under tenants/{tid}/schools/{sid}/.
    //     ad-hoc/ and any V1.5 audit-copy lane stay untagged → never expire.
    //
    //   pdfAssetsBucket: long-lived branding assets per design §4.5:
    //       tenants/{tenantId}/schools/{schoolId}/branding/{logo|signature|letterhead}/{uuid}.{ext}
    //       (future) tenants/.../seals/... and signatures/... for cert PDFs
    //     Versioned (template-edit history is auditable). No lifecycle —
    //     historical PDFs may reference any historical asset version
    //     forever; auto-cleanup is V1.5 manual sweep (R49 risk acceptance).
    //
    // NO CfnOutput / cross-stack export for either bucket name. Consumers
    // (edforge-pdf-batch Lambda in C.4.1, identity ECS endpoints in C.0.7)
    // reconstruct names from the deterministic
    // `edforge-{pdfs|pdf-assets}-${account}-${region}` convention OR read
    // from env var. R46 (cross-stack export collision) mitigation.
    // ============================================================
    const pdfsBucketName =
      `edforge-pdfs-${this.account}-${this.region}`;
    const pdfAssetsBucketName =
      `edforge-pdf-assets-${this.account}-${this.region}`;

    // Sprint I.5 — S3 server access logs for `pdfsBucket`.
    //
    // Why: the pdfs bucket holds finance bulk-export ZIPs and merged-PDFs, which
    // carry PII (invoice amounts, student names via invoiceNumber patterns,
    // guardian receipt data). The compliance question "who downloaded my child's
    // invoice at 3:14am" is unanswerable without server-side request logs. S3
    // access logging captures every GetObject (including the presigned-URL fetch
    // by the operator's browser) with source IP, user-agent, key, and status.
    //
    // Retention: 90 days. Long enough for a full audit / IR cycle; short enough
    // to bound storage. Standard access-log retention across the industry.
    //
    // Not routed through CloudWatch Insights natively — S3 server access logs
    // land in S3 and are queried via Athena. The operator runbook (see
    // docs/operations/finance-bulk-ops-lifecycle.md) contains ready-made Athena
    // DDL + typical incident-response queries.
    //
    // Removal policy: RETAIN — the logs ARE the evidence trail. A tenant
    // teardown must not eradicate the audit history of what they downloaded
    // during their subscription.
    const pdfsAccessLogsBucketName =
      `edforge-pdfs-access-logs-${this.account}-${this.region}`;
    const pdfsAccessLogsBucket = new s3.Bucket(this, 'PdfsAccessLogsBucket', {
      bucketName: pdfsAccessLogsBucketName,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      enforceSSL: true,
      // S3 log delivery uses per-service canonical writer IDs, not IAM
      // principals — no bucket policy needed beyond the ACL S3 auto-writes when
      // a bucket is nominated as a serverAccessLogsBucket on another bucket.
      lifecycleRules: [
        {
          id: 'expire-access-logs-90d',
          enabled: true,
          expiration: cdk.Duration.days(90),
        },
      ],
    });

    this.pdfsBucket = new s3.Bucket(this, 'PdfsBucket', {
      bucketName: pdfsBucketName,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: false,
      enforceSSL: true,
      // Sprint I.5 — server access logging for compliance / IR audit trail.
      serverAccessLogsBucket: pdfsAccessLogsBucket,
      serverAccessLogsPrefix: 'pdfs-access-logs/',
      lifecycleRules: [
        {
          // Tag-based filter, not prefix-based, because object keys live under
          //   tenants/{tenantId}/schools/{schoolId}/pdf-jobs/{jobId}/...
          // and S3 lifecycle prefixes only match from the start of the key —
          // a literal 'pdf-jobs/' prefix would never match a real object.
          //
          // CONTRACT: every writer placing an object under .../pdf-jobs/...
          // MUST tag it { lifecycle: 'pdf-jobs' } at PutObject time. Enforced
          // in the render-job producer (C.0.7+ / C.1.1 finance Invoice render
          // endpoint). Untagged objects survive — intentional, so V1.5 can add
          // audit-copy objects to the same bucket without unintended deletion.
          id: 'expire-pdf-jobs-7d',
          enabled: true,
          tagFilters: { lifecycle: 'pdf-jobs' },
          expiration: cdk.Duration.days(7),
        },
      ],
    });

    const pdfAssetsAllowedOrigins = props.corsAllowedOrigins
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0);
    if (pdfAssetsAllowedOrigins.length === 0) {
      throw new Error(
        `AnalyticsStack: corsAllowedOrigins normalized to an empty list. ` +
          `Raw value: '${props.corsAllowedOrigins}'. ` +
          `Provide at least one origin via CDK_PARAM_CORS_ALLOWED_ORIGINS ` +
          `(comma-separated), e.g. 'https://<your-tenant-frontend>'. ` +
          `Deploying with an empty CORS list would silently break the ` +
          `pdfAssetsBucket browser-direct presigned-PUT flow at runtime.`,
      );
    }

    this.pdfAssetsBucket = new s3.Bucket(this, 'PdfAssetsBucket', {
      bucketName: pdfAssetsBucketName,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      versioned: true,
      enforceSSL: true,
      // No lifecycle rules — branding assets are referenced by historical
      // documents indefinitely (a 5-year-old invoice rendered today must show
      // the logo that was active when it was issued). Storage growth is
      // bounded by template-edit cadence; V1.5 may add a manual-sweep tool
      // (R49) once telemetry confirms growth rate.
      //
      // CORS — required for the browser-direct presigned-PUT flow Sprint
      // M3 phase 2 introduced. Without these rules, Chrome's OPTIONS
      // preflight gets no `Access-Control-Allow-Origin` from S3 and blocks
      // the PUT before it ever leaves the browser. The same rules cover
      // the GET path (signed thumbnail URLs in the Branding viewer) and
      // the future batch-download flow (M8).
      //
      // Origins are operator-supplied via the CDK_PARAM_CORS_ALLOWED_ORIGINS
      // env var (comma-separated) and propagated as the `corsAllowedOrigins`
      // prop. Each operator decides which origins are allowed for their
      // deployment surface (custom domain, preview-environment wildcard,
      // etc.). EdForge ships no hardcoded production URLs.
      //
      // Security note: AllowedOrigins is a CORS-policy gate, NOT an
      // authorization boundary. The IAM-scoped presigned URL is what
      // actually authorizes the upload; CORS just lets the browser
      // SEE the response. So permissive origins here don't grant any
      // capability beyond what the presigner already does.
      //
      // ExposedHeaders: `ETag` lets the client read it after a successful
      // PUT, enabling future "verify by ETag" smoke checks. `x-amz-version-id`
      // (versioning is on) for forward-compat with audit flows that may
      // pin to a specific version.
      cors: [
        {
          allowedMethods: [
            s3.HttpMethods.PUT,
            s3.HttpMethods.GET,
            s3.HttpMethods.HEAD,
          ],
          allowedOrigins: pdfAssetsAllowedOrigins,
          allowedHeaders: ['*'],
          exposedHeaders: ['ETag', 'x-amz-version-id'],
          maxAge: 3000,
          id: 'm3-phase2-branding-asset-upload',
        },
      ],
    });

    // ------------------------------------------------------------
    // report-aggregator Lambda
    // ------------------------------------------------------------
    this.reportAggregatorLambda = new lambdaNodejs.NodejsFunction(
      this,
      'ReportAggregatorLambda',
      {
        functionName: 'edforge-report-aggregator',
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambda/report-aggregator/handler.ts'),
        handler: 'handler',
        memorySize: 1024,
        timeout: cdk.Duration.minutes(5),
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          IDENTITY_TABLE_NAME: 'edforge-identity-basic',
          ACADEMICS_TABLE_NAME: 'edforge-academics-basic',
          REPORTS_STAGING_BUCKET_NAME: this.reportingStagingBucket.bucketName,
          EVENT_BUS_NAME: props.eventBusName,
        },
        description:
          'E.1.3 — CEHRD IEMIS Flash I/II CSV generator. Consumes ' +
          '`reporting.snapshot_requested` from edforge.reporting source.',
        bundling: {
          // csv-stringify ships as plain CJS — esbuild handles it natively;
          // no externalModules override needed.
          minify: false,
          sourceMap: false,
        },
      },
    );

    // IAM — DDB read on identity + academics; DDB update on identity;
    // S3 PutObject on staging; EB PutEvents on SBT bus; CW PutMetricData.
    this.reportAggregatorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query',
          'dynamodb:UpdateItem',
        ],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-basic`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-basic/index/*`,
        ],
      }),
    );
    this.reportAggregatorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-academics-basic`,
          `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-academics-basic/index/*`,
        ],
      }),
    );
    this.reportingStagingBucket.grantPut(this.reportAggregatorLambda);
    this.reportAggregatorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['events:PutEvents'],
        resources: [
          `arn:aws:events:${this.region}:${this.account}:event-bus/${props.eventBusName}`,
        ],
      }),
    );
    this.reportAggregatorLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'Edforge/Reporting',
          },
        },
      }),
    );

    // EventBridge rule — source=edforge.reporting, detail-type=reporting.snapshot_requested
    new events.Rule(this, 'ReportAggregatorEventRule', {
      ruleName: 'edforge-report-aggregator-snapshot-requested',
      description:
        'Routes reporting.snapshot_requested → report-aggregator Lambda',
      eventBus: events.EventBus.fromEventBusName(
        this,
        'SbtEventBusForReporting',
        props.eventBusName,
      ),
      eventPattern: {
        source: ['edforge.reporting'],
        detailType: ['reporting.snapshot_requested'],
      },
      targets: [new eventsTargets.LambdaFunction(this.reportAggregatorLambda)],
    });

    const reportAggregatorErrors = this.reportAggregatorLambda.metricErrors({
      period: cdk.Duration.minutes(15),
      statistic: 'Sum',
    });

    // ------------------------------------------------------------
    // Consolidated analytics-functions alarm (cost-redesign C0.4).
    //
    // One alarm, one page, over every analytics Lambda plus the aggregator
    // DLQ. Each term keeps the semantics of the alarm it replaced:
    //   aggregator errors  > 0   (events retry 2x then land in the DLQ)
    //   aggregator DLQ     > 0   (events being dropped)
    //   rollup errors      > 0
    //   report aggregator  > 0   (CSV generation halted)
    //   janitors           > 2   (a single failed run is caught by the next cron)
    // FILL(…, 0) turns "no invocations this period" into 0 instead of
    // INSUFFICIENT_DATA, so the whole expression evaluates whenever any one
    // function is quiet. All terms are re-read at a 15-minute period, the
    // coarsest of the originals.
    // ------------------------------------------------------------
    const period15 = cdk.Duration.minutes(15);
    const analyticsFunctionsErrorsAlarm = new cloudwatch.Alarm(this, 'AnalyticsFunctionsErrorsAlarm', {
      alarmName: 'edforge-analytics-functions-errors',
      alarmDescription:
        'An analytics Lambda is erroring or the aggregator DLQ holds events (aggregator, rollup, report aggregator: any error; job janitors: more than 2 in 15 min). Check the function logs; redrive the DLQ if needed.',
      metric: new cloudwatch.MathExpression({
        expression:
          'FILL(agg, 0) + FILL(dlq, 0) + FILL(rollup, 0) + FILL(report, 0) + IF(FILL(iemis, 0) > 2, 1, 0) + IF(FILL(fin, 0) > 2, 1, 0)',
        usingMetrics: {
          agg: errorsMetric.with({ period: period15, statistic: 'Sum' }),
          dlq: dlqDepthMetric.with({ period: period15, statistic: 'Maximum' }),
          rollup: this.rollupLambda.metricErrors({ period: period15, statistic: 'Sum' }),
          report: reportAggregatorErrors,
          iemis: janitorErrors,
          fin: financeJanitorErrors,
        },
        period: period15,
        label: 'Analytics function errors',
      }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    analyticsFunctionsErrorsAlarm.addAlarmAction(
      new cwActions.SnsAction(this.operatorAlertTopic),
    );

    // ------------------------------------------------------------
    // reporting-scheduler Lambda (daily heartbeat — V1 metric-only)
    // 02:00 Asia/Kathmandu = 20:15 UTC. EventBridge cron expressions use
    // UTC; the offset is hard-baked here because Kathmandu DST is none.
    // ------------------------------------------------------------
    const scheduler = new ScheduledLambda(this, 'ReportingSchedulerLambda', {
      schedule: 'cron(15 20 * * ? *)',     // 20:15 UTC daily
      timezone: 'UTC',
      lambdaProps: {
        functionName: 'edforge-reporting-scheduler',
        runtime: lambda.Runtime.NODEJS_22_X,
        entry: path.join(__dirname, 'lambda/reporting-scheduler/handler.ts'),
        handler: 'handler',
        memorySize: 256,
        timeout: cdk.Duration.minutes(2),
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          IDENTITY_TABLE_NAME: 'edforge-identity-basic',
        },
        description:
          'E.1.6 — Daily metric heartbeat. Counts ReportingSnapshot rows in ' +
          'status=generated awaiting operator submission per tenant; publishes ' +
          'Edforge/Reporting/SnapshotsPendingSubmission.',
      },
    });
    this.reportingSchedulerLambda = scheduler.lambda;

    this.reportingSchedulerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Scan', 'dynamodb:Query'],
        resources: [
          `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-basic`,
        ],
      }),
    );
    this.reportingSchedulerLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'Edforge/Reporting',
          },
        },
      }),
    );

    // ------------------------------------------------------------
    // CloudFormation outputs for cross-stack reference (Layer 7 API,
    // Layer 6 rollup, Layer 10 email Lambda).
    // ------------------------------------------------------------
    new cdk.CfnOutput(this, 'AnalyticsTableNameOutput', {
      value: this.analyticsTable.tableName,
      exportName: 'EdforgeAnalyticsTableName',
    });
    new cdk.CfnOutput(this, 'LandingTableNameOutput', {
      value: this.landingTable.tableName,
      exportName: 'EdforgeAnalyticsLandingTableName',
    });
    new cdk.CfnOutput(this, 'UserSessionEventsTableNameOutput', {
      value: this.userSessionEventsTable.tableName,
      exportName: 'EdforgeUserSessionEventsTableName',
    });
    new cdk.CfnOutput(this, 'AggregatorDlqUrlOutput', {
      value: this.aggregatorDlq.queueUrl,
      exportName: 'EdforgeAnalyticsAggregatorDlqUrl',
    });
    new cdk.CfnOutput(this, 'OperatorAlertTopicArnOutput', {
      value: this.operatorAlertTopic.topicArn,
      exportName: 'EdforgeOperatorAlertTopicArn',
    });
    new cdk.CfnOutput(this, 'RollupLambdaArnOutput', {
      value: this.rollupLambda.functionArn,
      exportName: 'EdforgeAnalyticsRollupLambdaArn',
    });
    new cdk.CfnOutput(this, 'ReportingStagingBucketNameOutput', {
      value: this.reportingStagingBucket.bucketName,
      exportName: 'EdforgeReportingStagingBucketName',
    });
    new cdk.CfnOutput(this, 'ReportingArchiveBucketNameOutput', {
      value: this.reportingArchiveBucket.bucketName,
      exportName: 'EdforgeReportingArchiveBucketName',
    });
    new cdk.CfnOutput(this, 'ReportAggregatorLambdaArnOutput', {
      value: this.reportAggregatorLambda.functionArn,
      exportName: 'EdforgeReportAggregatorLambdaArn',
    });
    new cdk.CfnOutput(this, 'ReportingSchedulerLambdaArnOutput', {
      value: this.reportingSchedulerLambda.functionArn,
      exportName: 'EdforgeReportingSchedulerLambdaArn',
    });
    new cdk.CfnOutput(this, 'IemisJobJanitorLambdaArnOutput', {
      value: this.iemisJobJanitorLambda.functionArn,
      exportName: 'EdforgeIemisJobJanitorLambdaArn',
    });
    new cdk.CfnOutput(this, 'FinanceJobJanitorLambdaArnOutput', {
      value: this.financeJobJanitorLambda.functionArn,
      exportName: 'EdforgeFinanceJobJanitorLambdaArn',
    });
    new cdk.CfnOutput(this, 'ApiLambdaArnOutput', {
      value: this.apiLambda.functionArn,
      exportName: 'EdforgeAnalyticsApiLambdaArn',
    });
    new cdk.CfnOutput(this, 'ExportBucketNameOutput', {
      value: this.exportBucket.bucketName,
      exportName: 'EdforgeAnalyticsExportBucketName',
    });

    // CDK Nag suppressions (gated by CDK_NAG_ENABLED, same pattern as the
    // other stacks in this repo). See analytics-nag.ts for the rationale
    // behind each suppression.
    if (process.env.CDK_NAG_ENABLED === 'true') {
      new AnalyticsNag(this, 'analytics-nag');
    }
  }
}
