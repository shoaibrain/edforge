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
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
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
   * Controls ANALYTICS_ENABLED env var on the aggregator Lambda.
   * Default: 'false'. Flipping to 'true' is the post-deploy activation
   * step (Layer 11 deploy sequence step 8).
   */
  readonly analyticsEnabled?: string;

  /**
   * Phase 4 (Sprint I-2) — ALB full name for CloudWatch dimension
   * (`app/<name>/<suffix>`). From `sharedInfraStack.alb.loadBalancerFullName`.
   * Used by the pilot 5xx alarm + dashboard to watch tenant-facing HTTP
   * errors across every tenant service sharing the ALB.
   */
  readonly albLoadBalancerFullName: string;

  /**
   * Phase 4 (Sprint I-2) — tenant-seeder Lambda reference. Error alarm
   * on this function catches `sbt_aws_provisionSuccess` consumer crashes,
   * which would leave a tenant with an ECS stack deployed but no identity
   * METADATA + SETTINGS#WORKSPACE rows written.
   */
  readonly tenantSeederLambda: lambda.IFunction;
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
        runtime: lambda.Runtime.NODEJS_20_X,
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

    // Alarm: DLQ depth > 0 for 15 minutes (CRITICAL)
    const dlqAlarm = new cloudwatch.Alarm(this, 'AggregatorDlqDepthAlarm', {
      alarmName: 'edforge-analytics-aggregator-dlq-depth',
      alarmDescription:
        'Aggregator DLQ has messages for 15+ min — events being dropped. Investigate.',
      metric: dlqDepthMetric,
      threshold: 0,
      evaluationPeriods: 3,
      datapointsToAlarm: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    dlqAlarm.addAlarmAction(new cwActions.SnsAction(this.operatorAlertTopic));

    // Alarm: Lambda concurrency throttles > 0 (WARNING)
    const throttleAlarm = new cloudwatch.Alarm(this, 'AggregatorThrottleAlarm', {
      alarmName: 'edforge-analytics-aggregator-throttles',
      alarmDescription:
        'Aggregator Lambda concurrency throttling detected. Event backlog likely.',
      metric: throttlesMetric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    throttleAlarm.addAlarmAction(new cwActions.SnsAction(this.operatorAlertTopic));

    // Alarm: landing-table WCU burst (WARNING at 80% of on-demand burst cap).
    // On-demand burst is ~40000 WCU/s; alarm at 80% sustained over 5 min.
    const landingWcuAlarm = new cloudwatch.Alarm(this, 'LandingTableWcuBurstAlarm', {
      alarmName: 'edforge-analytics-landing-wcu-burst',
      alarmDescription: 'Landing table WCU > 80% of on-demand burst capacity',
      metric: this.landingTable.metricConsumedWriteCapacityUnits({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum',
      }),
      threshold: 32000 * 300, // 80% of 40k WCU/s × 300s window
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    landingWcuAlarm.addAlarmAction(new cwActions.SnsAction(this.operatorAlertTopic));

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

    // Alarm: aggregator Lambda error rate > 0 (CRITICAL).
    // Existing AggregatorThrottleAlarm catches concurrency ceilings; this
    // catches code-level failures (exceptions, OOM, timeout) that EventBridge
    // will retry twice before sending to the DLQ. Firing early here gives
    // operators a head start vs waiting for the 15-min DLQ depth alarm.
    const aggregatorErrorAlarm = new cloudwatch.Alarm(this, 'AggregatorErrorAlarm', {
      alarmName: 'edforge-analytics-aggregator-errors',
      alarmDescription:
        'Aggregator Lambda returning errors. Events will retry 2x then go to DLQ. Check CloudWatch Logs.',
      metric: errorsMetric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    aggregatorErrorAlarm.addAlarmAction(new cwActions.SnsAction(this.operatorAlertTopic));

    // Alarm: tenant-seeder Lambda error rate > 0 (CRITICAL).
    // Tenant-seeder writes the identity METADATA + SETTINGS#WORKSPACE rows
    // when SBT emits sbt_aws_provisionSuccess. A failure here means the ECS
    // stack is up but the tenant is un-usable — PABSON gate can't fire,
    // workspace settings are missing. Every failure blocks a new tenant.
    const tenantSeederErrorsMetric = props.tenantSeederLambda.metricErrors({
      period: cdk.Duration.minutes(5),
    });
    const tenantSeederErrorAlarm = new cloudwatch.Alarm(this, 'TenantSeederErrorAlarm', {
      alarmName: 'edforge-tenant-seeder-errors',
      alarmDescription:
        'Tenant-seeder Lambda error. A just-provisioned tenant is likely missing identity METADATA/SETTINGS rows — the tenant cannot log in or create schools until manually repaired.',
      metric: tenantSeederErrorsMetric,
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    tenantSeederErrorAlarm.addAlarmAction(new cwActions.SnsAction(this.operatorAlertTopic));

    // Alarm: ALB tenant-facing 5xx surge (CRITICAL).
    // HTTPCode_Target_5XX_Count counts responses the backend (ECS tasks)
    // returned as 5xx. Pilot traffic is low so any sustained 5xx points to
    // a code regression, DDB throttle, or crashing service. Threshold of
    // >10 over a 5-min window filters out single-request hiccups.
    //
    // Using a raw Metric (not a helper) because the ALB ref lives in
    // shared-infra-stack (an UPSTREAM dependency via controlplane-stack)
    // and we get the LoadBalancer dimension as a string prop to avoid
    // cross-stack coupling beyond what CFN exports already exist for.
    const alb5xxMetric = new cloudwatch.Metric({
      namespace: 'AWS/ApplicationELB',
      metricName: 'HTTPCode_Target_5XX_Count',
      dimensionsMap: { LoadBalancer: props.albLoadBalancerFullName },
      statistic: 'Sum',
      period: cdk.Duration.minutes(5),
    });
    const alb5xxAlarm = new cloudwatch.Alarm(this, 'Alb5xxSurgeAlarm', {
      alarmName: 'edforge-alb-5xx-surge',
      alarmDescription:
        'Tenant-facing ALB returned >10 backend 5xx in 5 min. Check ECS service health + CloudWatch Logs.',
      metric: alb5xxMetric,
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    alb5xxAlarm.addAlarmAction(new cwActions.SnsAction(this.operatorAlertTopic));

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
        title: 'Tenant-facing ALB — backend 5xx (CRITICAL >10 / 5min)',
        left: [alb5xxMetric],
        width: 12,
      }),
      new cloudwatch.GraphWidget({
        title: 'Tenant-facing ALB — 4xx vs 2xx',
        left: [
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_4XX_Count',
            dimensionsMap: { LoadBalancer: props.albLoadBalancerFullName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
          new cloudwatch.Metric({
            namespace: 'AWS/ApplicationELB',
            metricName: 'HTTPCode_Target_2XX_Count',
            dimensionsMap: { LoadBalancer: props.albLoadBalancerFullName },
            statistic: 'Sum',
            period: cdk.Duration.minutes(5),
          }),
        ],
        width: 12,
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
      functionName: 'edforge-analytics-api',
      runtime: lambda.Runtime.NODEJS_20_X,
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

    // ------------------------------------------------------------
    // Sprint 2 — attach 5 analytics routes to the existing tenant API
    //
    // The tenant API lives in shared-infra-stack. We import its REST API id,
    // root resource id, and authorizer ARN via CFN imports. Routes are added
    // here (not via the tenant-api-prod.json OpenAPI spec) to keep the
    // analytics stack self-contained and to avoid a cross-stack ARN cycle
    // (shared-infra would otherwise need this stack's Lambda ARN at synth
    // time, while this stack needs shared-infra's API root at synth time).
    //
    // CARDINAL RULE: we do NOT modify the shared Python authorizer. It is
    // reused by identity/academics/finance. We only reference it by ARN.
    // ------------------------------------------------------------
    const tenantApi = apigateway.RestApi.fromRestApiAttributes(
      this,
      'TenantApiImport',
      {
        restApiId: cdk.Fn.importValue('TenantApiRestApiId'),
        rootResourceId: cdk.Fn.importValue('TenantApiRootResourceId'),
      },
    );
    // sameEnvironment=true lets CDK add the required lambda:InvokeFunction
    // permission for the imported authorizer — without it the authorizer
    // can be referenced but API Gateway can't actually invoke it.
    const authorizerFn = lambda.Function.fromFunctionAttributes(
      this,
      'TenantApiAuthorizerImport',
      {
        functionArn: cdk.Fn.importValue('TenantApiAuthorizerArn'),
        sameEnvironment: true,
      },
    );
    // Use TokenAuthorizer (not RequestAuthorizer) to match the type the
    // existing tenant_authorizer.py Lambda expects: it reads
    // event['authorizationToken'], which is only populated by TOKEN-type
    // authorizers. The shared authorizer in the Swagger spec is also TOKEN.
    // Construct ID 'SharedTenantTokenAuthorizer' (not 'SharedTenantAuthorizer')
    // forces CloudFormation to create a new Authorizer resource rather than
    // attempt an in-place update of the previous REQUEST-type one, which is
    // not supported (Type is immutable on AWS::ApiGateway::Authorizer).
    const sharedAuthorizer = new apigateway.TokenAuthorizer(
      this,
      'SharedTenantTokenAuthorizer',
      {
        handler: authorizerFn,
        identitySource: 'method.request.header.Authorization',
        resultsCacheTtl: cdk.Duration.minutes(5),
      },
    );

    const lambdaIntegration = new apigateway.LambdaIntegration(this.apiLambda, {
      proxy: true,
    });

    // Helper: build a resource path, attach a GET method with shared
    // authorizer, and add a CORS OPTIONS mock integration on the same
    // resource. CORS mirrors the pattern in `tenant-api-prod.json`:
    // OPTIONS returns a static 204 with Access-Control-* headers.
    const addRoute = (pathSegments: string[]): apigateway.Resource => {
      let current: apigateway.IResource = tenantApi.root;
      for (const seg of pathSegments) {
        const existing = current.getResource(seg);
        current = existing ?? current.addResource(seg);
      }
      const resource = current as apigateway.Resource;
      resource.addMethod('GET', lambdaIntegration, {
        authorizer: sharedAuthorizer,
        authorizationType: apigateway.AuthorizationType.CUSTOM,
        // apiKeyRequired is driven by the authorizer's usageIdentifierKey;
        // no explicit flag needed.
      });
      // OPTIONS preflight — mock 204 with wildcard CORS. Production CORS
      // lockdown should go through the authorizer's corsOrigin echo, same
      // as identity/academics/finance methods.
      resource.addCorsPreflight({
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: ['GET', 'OPTIONS'],
        allowHeaders: [
          'Content-Type',
          'Authorization',
          'X-Amz-Date',
          'X-Api-Key',
          'X-Amz-Security-Token',
          'X-Tenant-Id',
          'X-Correlation-Id',
          'X-Request-Id',
        ],
        allowCredentials: true,
      });
      return resource;
    };

    // Routes. Order matters for nested paths — deeper paths added first so
    // their parents are created as Resources (not as bare GET targets).
    addRoute(['analytics', 'tenants', '{tenantId}', 'adoption-report']);
    addRoute(['analytics', 'tenants', '{tenantId}', 'export-csv-url']);
    addRoute(['analytics', 'tenants', '{tenantId}']);
    addRoute(['analytics', 'fleet']);
    // Session history is the calling user's own analytics. Placed under
    // /analytics/me/session-history rather than /users/me/* to avoid a
    // collision with the existing /users resource registered by the OpenAPI
    // spec (tenant-api-prod.json). Conceptually it's analytics data, so
    // the /analytics prefix is the correct home anyway.
    addRoute(['analytics', 'me', 'session-history']);

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
        runtime: lambda.Runtime.NODEJS_20_X,
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
