import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface FinanceJobsQueueProps {
  readonly tier: string;
  /** The worker function's timeout; visibility is this plus a minute (the `queued`-only claim already prevents double runs). */
  readonly workerTimeout: cdk.Duration;
}

/** Deterministic queue name, so the ECS task definition can carry the URL as a plain string. */
export function financeJobsQueueName(tier: string): string {
  return `edforge-finance-jobs-${tier.toLowerCase()}`;
}

/**
 * Cost-redesign C3.7 — the finance bulk-jobs queue.
 *
 * Messages carry the operator's JWT, so: SQS-managed encryption, one-day
 * retention, and the dead-letter queue keeps its copies one day too. After
 * three receives a message lands in the DLQ; its depth is the last of the
 * ten alarms C0.4 budgeted.
 */
export class FinanceJobsQueue extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly alarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: FinanceJobsQueueProps) {
    super(scope, id);
    const tier = props.tier.toLowerCase();
    this.deadLetterQueue = new sqs.Queue(this, 'Dlq', {
      queueName: `${financeJobsQueueName(tier)}-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(1),
      enforceSSL: true,
    });
    this.queue = new sqs.Queue(this, 'Queue', {
      queueName: financeJobsQueueName(tier),
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(1),
      visibilityTimeout: props.workerTimeout.plus(cdk.Duration.seconds(60)),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
      enforceSSL: true,
    });
    this.alarm = new cloudwatch.Alarm(this, 'DlqAlarm', {
      alarmName: `${financeJobsQueueName(tier)}-dlq`,
      alarmDescription: 'A finance bulk job message reached the dead-letter queue: the worker could not run it three times (school lock busy for too long, or a worker crash). Inspect the message, re-submit the job, purge the DLQ. Messages carry a JWT and expire in one day.',
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5), statistic: 'Maximum' }),
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
