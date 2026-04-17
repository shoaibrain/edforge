/**
 * Layer 6.1 — reusable scheduled-Lambda construct.
 *
 * Wraps EventBridge Scheduler + NodejsFunction. Used by:
 *   - Layer 6.3 AnalyticsRollupLambda (daily rollup)
 *   - Layer 10.1 AnalyticsEmailLambda (weekly emails)
 *
 * Why EventBridge Scheduler instead of EventBridge Rules with schedule
 * expressions: Scheduler is the current AWS recommendation for new workloads,
 * supports IANA time zones natively, and has higher per-account limits.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';

export interface ScheduledLambdaProps {
  /**
   * Cron expression in the `cron(...)` syntax accepted by EventBridge
   * Scheduler. Example: `cron(0 1 * * ? *)` = daily at 01:00.
   */
  readonly schedule: string;

  /**
   * IANA time zone name for the cron expression. e.g. 'Asia/Kathmandu'.
   * Defaults to UTC if not specified.
   */
  readonly timezone?: string;

  /**
   * Passed through to the inner `NodejsFunction`. Use this to override
   * entry, handler, memorySize, timeout, environment, etc.
   */
  readonly lambdaProps: lambdaNodejs.NodejsFunctionProps;

  /**
   * Optional input JSON passed to every scheduled invocation. Useful for
   * passing fixed parameters (e.g. { mode: 'daily' }).
   */
  readonly input?: Record<string, unknown>;

  /**
   * Optional CloudFormation export name for the Lambda ARN.
   */
  readonly exportName?: string;
}

export class ScheduledLambda extends Construct {
  public readonly lambda: lambda.IFunction;
  public readonly schedule: scheduler.CfnSchedule;

  constructor(scope: Construct, id: string, props: ScheduledLambdaProps) {
    super(scope, id);

    this.lambda = new lambdaNodejs.NodejsFunction(this, 'Function', {
      runtime: lambda.Runtime.NODEJS_20_X,
      logRetention: logs.RetentionDays.ONE_MONTH,
      ...props.lambdaProps,
    });

    // Role the Scheduler assumes to invoke the Lambda.
    const invokeRole = new iam.Role(this, 'SchedulerInvokeRole', {
      assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
    });
    this.lambda.grantInvoke(invokeRole);

    this.schedule = new scheduler.CfnSchedule(this, 'Schedule', {
      flexibleTimeWindow: { mode: 'OFF' },
      scheduleExpression: props.schedule,
      scheduleExpressionTimezone: props.timezone ?? 'UTC',
      target: {
        arn: this.lambda.functionArn,
        roleArn: invokeRole.roleArn,
        ...(props.input ? { input: JSON.stringify(props.input) } : {}),
        retryPolicy: {
          maximumEventAgeInSeconds: 900,
          maximumRetryAttempts: 2,
        },
      },
      state: 'ENABLED',
    });

    if (props.exportName) {
      new cdk.CfnOutput(this, 'LambdaArnOutput', {
        value: this.lambda.functionArn,
        exportName: props.exportName,
      });
    }
  }
}
