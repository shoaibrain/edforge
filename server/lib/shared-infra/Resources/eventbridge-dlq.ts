import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

export interface EventBridgeDlqProps {
  // No props needed
}

export class EventBridgeDlq extends Construct {
  public readonly parentPortalDlq: sqs.Queue;
  public readonly analyticsDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props?: EventBridgeDlqProps) {
    super(scope, id);

    // DLQ for Parent Portal Lambda
    this.parentPortalDlq = new sqs.Queue(this, 'ParentPortalDlq', {
      queueName: 'parent-portal-dlq',
      retentionPeriod: Duration.days(14),
      visibilityTimeout: Duration.seconds(30),
      encryption: sqs.QueueEncryption.SQS_MANAGED
    });

    // DLQ for Analytics Firehose
    this.analyticsDlq = new sqs.Queue(this, 'AnalyticsDlq', {
      queueName: 'analytics-firehose-dlq',
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.SQS_MANAGED
    });
  }
}

