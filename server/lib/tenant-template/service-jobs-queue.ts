import * as cdk from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface ServiceJobsQueueProps {
  /** finance | academics */
  readonly serviceName: string;
  readonly tier: string;
  /** The worker function's timeout; visibility is this plus a minute (the `queued`-only claim already prevents double runs). */
  readonly workerTimeout: cdk.Duration;
}

/** Deterministic queue name, so the ECS task definition can carry the URL as a plain string. */
export function serviceJobsQueueName(serviceName: string, tier: string): string {
  return `edforge-${serviceName}-jobs-${tier.toLowerCase()}`;
}

/**
 * Cost-redesign C3.7 / C3.11 — a service's bulk-jobs queue.
 *
 * Messages carry the operator's JWT, so: SQS-managed encryption, one-day
 * retention, and the dead-letter queue keeps its copies one day too. After
 * three receives a message lands in the DLQ; the DLQ depths of every
 * service share one alarm (JobsDlqAlarm), the last of the ten C0.4
 * budgeted.
 */
export class ServiceJobsQueue extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: ServiceJobsQueueProps) {
    super(scope, id);
    const name = serviceJobsQueueName(props.serviceName, props.tier);
    this.deadLetterQueue = new sqs.Queue(this, 'Dlq', {
      queueName: `${name}-dlq`,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(1),
      enforceSSL: true,
    });
    this.queue = new sqs.Queue(this, 'Queue', {
      queueName: name,
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      retentionPeriod: cdk.Duration.days(1),
      visibilityTimeout: props.workerTimeout.plus(cdk.Duration.seconds(60)),
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
      enforceSSL: true,
    });
  }
}

export interface JobsDlqAlarmProps {
  readonly tier: string;
  /** serviceName → its dead-letter queue */
  readonly deadLetterQueues: Record<string, sqs.IQueue>;
}

/** One alarm over every jobs DLQ: any message visible in any of them. */
export class JobsDlqAlarm extends Construct {
  public readonly alarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: JobsDlqAlarmProps) {
    super(scope, id);
    const usingMetrics: Record<string, cloudwatch.IMetric> = {};
    const terms: string[] = [];
    for (const [svc, dlq] of Object.entries(props.deadLetterQueues)) {
      const m = svc.replace(/[^a-z0-9]/gi, '').toLowerCase();
      usingMetrics[m] = dlq.metricApproximateNumberOfMessagesVisible({ period: cdk.Duration.minutes(5), statistic: 'Maximum' });
      terms.push(`FILL(${m}, 0)`);
    }
    this.alarm = new cloudwatch.Alarm(this, 'Alarm', {
      alarmName: `edforge-jobs-dlq-${props.tier.toLowerCase()}`,
      alarmDescription: 'A bulk-job message reached a dead-letter queue (finance or academics jobs): the worker could not run it three times. Inspect the message, re-submit the job, purge the DLQ. Messages carry a JWT and expire in one day.',
      metric: new cloudwatch.MathExpression({ expression: terms.join(' + '), usingMetrics, period: cdk.Duration.minutes(5), label: 'dlq messages' }),
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
