import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import { Construct } from 'constructs';
import { ScheduledTarget } from '../cdk-patterns/scheduled-target';

/** Job name (the scheduled entry's registry key) → cadence. Times are Asia/Kathmandu, as the ECS timers effectively were. */
export const FINANCE_SCHEDULES = {
  'recurring-billing': { schedule: 'cron(30 1 * * ? *)', description: 'Recurring invoices for the current billing period, daily 01:30 NPT' },
  'overdue-detection': { schedule: 'cron(0 * * * ? *)', description: 'Mark issued invoices past their due date, hourly' },
  'billing-reconciliation': { schedule: 'cron(30 * * * ? *)', description: 'Flag student accounts without invoices, hourly at :30' },
  'payment-sweep': { schedule: 'cron(*/30 * * * ? *)', description: 'Reconcile pending gateway payments, every 30 min (disabled: DISABLE_PAYMENT_SWEEP)' },
} as const;

/**
 * The scheduled function inherits the task-definition environment, where
 * C3.5 turns the ECS timers OFF with DISABLE_<JOB>=true. On the schedule
 * those same jobs must run, so the function's copy of the flags is forced
 * to false here (the payment sweep stays governed by its schedule state).
 */
export const SCHEDULED_TIMER_FLAGS = ['DISABLE_RECURRING_BILLING', 'DISABLE_OVERDUE_DETECTION', 'DISABLE_BILLING_RECONCILIATION'] as const;
export function scheduledFunctionEnvironment(env: Record<string, string>): Record<string, string> {
  const out = { ...env };
  for (const flag of SCHEDULED_TIMER_FLAGS) out[flag] = 'false';
  return out;
}

/** A worker function always takes the queue path and the DynamoDB lock, whatever the task definition says. */
export function workerFunctionEnvironment(env: Record<string, string>): Record<string, string> {
  return { ...env, JOBS_TRANSPORT: 'sqs' };
}

/**
 * An API function follows the task definition's transport unless the canary
 * override is set, in which case a service that dispatches jobs at all sends
 * them to its queue while the container keeps running them in process.
 */
export function apiFunctionEnvironment(env: Record<string, string>, apiJobsTransport?: 'sqs'): Record<string, string> {
  return apiJobsTransport && env.JOBS_TRANSPORT ? { ...env, JOBS_TRANSPORT: apiJobsTransport } : env;
}

export interface FinanceSchedulesProps {
  /** The finance bundle running `index.scheduledHandler`. */
  readonly fn: lambda.IFunction;
  /** Cost-redesign C3.5 order: schedules ship DISABLED and are enabled only after the ECS timers are off. */
  readonly enabled: boolean;
  /** The payment sweep mirrors DISABLE_PAYMENT_SWEEP=true and stays off unless explicitly enabled. */
  readonly paymentSweepEnabled?: boolean;
}

/** Cost-redesign C3.4 — the four finance timers as EventBridge Scheduler schedules. */
export class FinanceSchedules extends Construct {
  public readonly targets: Record<keyof typeof FINANCE_SCHEDULES, ScheduledTarget>;

  constructor(scope: Construct, id: string, props: FinanceSchedulesProps) {
    super(scope, id);
    const targets = {} as Record<keyof typeof FINANCE_SCHEDULES, ScheduledTarget>;
    for (const [job, cfg] of Object.entries(FINANCE_SCHEDULES) as Array<[keyof typeof FINANCE_SCHEDULES, (typeof FINANCE_SCHEDULES)[keyof typeof FINANCE_SCHEDULES]]>) {
      const enabled = job === 'payment-sweep' ? props.enabled && props.paymentSweepEnabled === true : props.enabled;
      targets[job] = new ScheduledTarget(this, job, {
        fn: props.fn,
        schedule: cfg.schedule,
        timezone: 'Asia/Kathmandu',
        description: cfg.description,
        enabled,
        input: { job, scheduledTime: '<aws.scheduler.scheduled-time>' },
      });
    }
    this.targets = targets;
  }
}

export interface FunctionsErrorsAlarmProps {
  readonly alarmName: string;
  readonly functions: Record<string, lambda.IFunction>;
  readonly description: string;
}

/**
 * One metric-math alarm over several functions' Errors (C0.4 style:
 * FILL(…, 0) so a quiet period is 0, not missing). Notifies the operator
 * topic when CDK_PARAM_OPERATOR_TOPIC_ARN is set, as the tenant stack's other
 * alarm does. Uses one of the two alarm slots C0.4 reserved for Sprint 3.
 */
export class FunctionsErrorsAlarm extends Construct {
  public readonly alarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: FunctionsErrorsAlarmProps) {
    super(scope, id);
    const usingMetrics: Record<string, cloudwatch.IMetric> = {};
    const terms: string[] = [];
    for (const [key, fn] of Object.entries(props.functions)) {
      const m = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
      usingMetrics[m] = fn.metricErrors({ period: cdk.Duration.minutes(5), statistic: 'Sum' });
      terms.push(`FILL(${m}, 0)`);
    }
    this.alarm = new cloudwatch.Alarm(this, 'Alarm', {
      alarmName: props.alarmName,
      alarmDescription: props.description,
      metric: new cloudwatch.MathExpression({ expression: terms.join(' + '), usingMetrics, period: cdk.Duration.minutes(5), label: 'errors' }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });
    const opsTopicArn = process.env.CDK_PARAM_OPERATOR_TOPIC_ARN;
    if (opsTopicArn) {
      this.alarm.addAlarmAction(new cwActions.SnsAction(sns.Topic.fromTopicArn(this, 'OperatorAlertTopicRef', opsTopicArn)));
    }
  }
}
