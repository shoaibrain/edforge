import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as scheduler from 'aws-cdk-lib/aws-scheduler';
import { Construct } from 'constructs';

export interface ScheduleProps {
  /** `cron(...)` / `rate(...)` in EventBridge Scheduler syntax. */
  readonly schedule: string;
  /** IANA time zone for the cron expression; UTC when omitted. */
  readonly timezone?: string;
  /** Static JSON input; Scheduler context attributes such as `<aws.scheduler.scheduled-time>` are substituted per invocation. */
  readonly input?: Record<string, unknown>;
  /** `false` creates the schedule DISABLED (cost-redesign C3.4: schedules ship off and are flipped on after the ECS timers stop). */
  readonly enabled?: boolean;
  readonly description?: string;
}

/**
 * The Scheduler half shared by `ScheduledLambda` (which also bundles its own
 * function) and `ScheduledTarget` (which schedules an existing function).
 * Child ids are `SchedulerInvokeRole` and `Schedule` on the given scope, so
 * `ScheduledLambda`'s existing logical IDs do not move.
 */
export function attachSchedule(scope: Construct, fn: lambda.IFunction, props: ScheduleProps): scheduler.CfnSchedule {
  const invokeRole = new iam.Role(scope, 'SchedulerInvokeRole', {
    assumedBy: new iam.ServicePrincipal('scheduler.amazonaws.com'),
  });
  fn.grantInvoke(invokeRole);
  return new scheduler.CfnSchedule(scope, 'Schedule', {
    flexibleTimeWindow: { mode: 'OFF' },
    scheduleExpression: props.schedule,
    scheduleExpressionTimezone: props.timezone ?? 'UTC',
    ...(props.description ? { description: props.description } : {}),
    target: {
      arn: fn.functionArn,
      roleArn: invokeRole.roleArn,
      ...(props.input ? { input: JSON.stringify(props.input) } : {}),
      retryPolicy: {
        maximumEventAgeInSeconds: 900,
        maximumRetryAttempts: 2,
      },
    },
    state: props.enabled === false ? 'DISABLED' : 'ENABLED',
  });
}

export interface ScheduledTargetProps extends ScheduleProps {
  /** An existing function — e.g. the finance service bundle's `index.scheduledHandler`, which `ScheduledLambda` cannot host (esbuild drops decorator metadata). */
  readonly fn: lambda.IFunction;
}

/** Cost-redesign C3.4 — an EventBridge Scheduler schedule for a function created elsewhere. */
export class ScheduledTarget extends Construct {
  public readonly schedule: scheduler.CfnSchedule;

  constructor(scope: Construct, id: string, props: ScheduledTargetProps) {
    super(scope, id);
    this.schedule = attachSchedule(this, props.fn, props);
  }
}
