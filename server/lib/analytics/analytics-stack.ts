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
import { ScheduledLambda } from '../cdk-patterns/scheduled-lambda';
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
}

export class AnalyticsStack extends cdk.Stack {
  public readonly analyticsTable: dynamodb.Table;
  public readonly landingTable: dynamodb.Table;
  public readonly userSessionEventsTable: dynamodb.Table;
  public readonly aggregatorLambda: lambda.IFunction;
  public readonly aggregatorDlq: sqs.Queue;
  public readonly operatorAlertTopic: sns.Topic;
  public readonly rollupLambda: lambda.IFunction;

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

    // CDK Nag suppressions (gated by CDK_NAG_ENABLED, same pattern as the
    // other stacks in this repo). See analytics-nag.ts for the rationale
    // behind each suppression.
    if (process.env.CDK_NAG_ENABLED === 'true') {
      new AnalyticsNag(this, 'analytics-nag');
    }
  }
}
