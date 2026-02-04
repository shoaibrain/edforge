/**
 * EventBridge Dead Letter Queue (DLQ) Stack
 * 
 * Provides:
 * - SQS DLQ for failed EventBridge events
 * - CloudWatch alarm on DLQ message count
 * - Lambda function for DLQ processing/retry
 * 
 * ARCHITECTURE:
 * EventBridge → Rules → Targets (with DLQ) → Lambda (retry/alert)
 */

import * as cdk from 'aws-cdk-lib';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import { Construct } from 'constructs';

export interface EventDlqStackProps extends cdk.StackProps {
  /**
   * SNS topic ARN for alarm notifications (optional)
   */
  alarmTopicArn?: string;
  
  /**
   * EventBridge bus name to monitor
   */
  eventBusName: string;
  
  /**
   * Environment (dev, staging, prod)
   */
  environment: string;
}

export class EventDlqStack extends Construct {
  /**
   * The SQS DLQ for failed events
   */
  public readonly deadLetterQueue: sqs.Queue;
  
  /**
   * CloudWatch alarm for DLQ messages
   */
  public readonly dlqAlarm: cloudwatch.Alarm;
  
  /**
   * Lambda function for processing DLQ messages
   */
  public readonly dlqProcessor: lambda.Function;

  constructor(scope: Construct, id: string, props: EventDlqStackProps) {
    super(scope, id);

    // =========================================================
    // 1. Create SQS Dead Letter Queue
    // =========================================================
    
    // Create final DLQ first (second-level DLQ for truly unprocessable messages)
    const finalDlq = new sqs.Queue(this, 'EventBridgeFinalDLQ', {
      queueName: `edforge-event-final-dlq-${props.environment}`,
      retentionPeriod: cdk.Duration.days(14), // AWS SQS max is 14 days (1,209,600 seconds)
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // Create main DLQ with reference to final DLQ
    this.deadLetterQueue = new sqs.Queue(this, 'EventBridgeDLQ', {
      queueName: `edforge-event-dlq-${props.environment}`,
      retentionPeriod: cdk.Duration.days(14), // Keep failed events for 14 days
      encryption: sqs.QueueEncryption.SQS_MANAGED,
      visibilityTimeout: cdk.Duration.seconds(300), // 5 minutes for processing
      deadLetterQueue: {
        queue: finalDlq,
        maxReceiveCount: 3, // After 3 failed processing attempts
      },
    });

    // Add queue policies to require SSL (AwsSolutions-SQS4 compliance)
    this.deadLetterQueue.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'EnforceSSL',
      effect: iam.Effect.DENY,
      principals: [new iam.AnyPrincipal()],
      actions: ['sqs:*'],
      resources: [this.deadLetterQueue.queueArn],
      conditions: {
        Bool: {
          'aws:SecureTransport': 'false',
        },
      },
    }));

    // Add SSL policy to final DLQ
    finalDlq.addToResourcePolicy(new iam.PolicyStatement({
      sid: 'EnforceSSL',
      effect: iam.Effect.DENY,
      principals: [new iam.AnyPrincipal()],
      actions: ['sqs:*'],
      resources: [finalDlq.queueArn],
      conditions: {
        Bool: {
          'aws:SecureTransport': 'false',
        },
      },
    }));

    // =========================================================
    // 2. Create DLQ Processing Lambda
    // =========================================================
    this.dlqProcessor = new lambda.Function(this, 'DLQProcessor', {
      functionName: `edforge-event-dlq-processor-${props.environment}`,
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(this.getDlqProcessorCode()),
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      environment: {
        EVENT_BUS_NAME: props.eventBusName,
        ENVIRONMENT: props.environment,
        DLQ_URL: this.deadLetterQueue.queueUrl,
      },
      tracing: lambda.Tracing.ACTIVE,
    });

    // Grant Lambda permissions
    this.deadLetterQueue.grantConsumeMessages(this.dlqProcessor);
    
    // Grant EventBridge put events permission for retries
    this.dlqProcessor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['events:PutEvents'],
      resources: [`arn:aws:events:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:event-bus/${props.eventBusName}`],
    }));

    // Add SQS trigger to Lambda
    this.dlqProcessor.addEventSource(new lambdaEventSources.SqsEventSource(this.deadLetterQueue, {
      batchSize: 5,
      maxBatchingWindow: cdk.Duration.seconds(10),
    }));

    // =========================================================
    // 3. Create CloudWatch Alarm for DLQ
    // =========================================================
    this.dlqAlarm = new cloudwatch.Alarm(this, 'DLQMessagesAlarm', {
      alarmName: `edforge-event-dlq-messages-${props.environment}`,
      alarmDescription: 'Alert when events fail to process and land in DLQ',
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        statistic: 'Sum',
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // Add SNS notification if topic provided
    if (props.alarmTopicArn) {
      const alarmTopic = sns.Topic.fromTopicArn(this, 'AlarmTopic', props.alarmTopicArn);
      this.dlqAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(alarmTopic));
    }

    // =========================================================
    // 4. Create CloudWatch Dashboard Widget (optional)
    // =========================================================
    new cloudwatch.Dashboard(this, 'EventDLQDashboard', {
      dashboardName: `edforge-event-dlq-${props.environment}`,
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'DLQ Messages',
            left: [
              this.deadLetterQueue.metricApproximateNumberOfMessagesVisible(),
              this.deadLetterQueue.metricNumberOfMessagesReceived(),
              this.deadLetterQueue.metricNumberOfMessagesDeleted(),
            ],
            width: 12,
          }),
          new cloudwatch.GraphWidget({
            title: 'DLQ Processor Metrics',
            left: [
              this.dlqProcessor.metricInvocations(),
              this.dlqProcessor.metricErrors(),
              this.dlqProcessor.metricDuration(),
            ],
            width: 12,
          }),
        ],
      ],
    });

    // =========================================================
    // 5. Outputs
    // =========================================================
    new cdk.CfnOutput(this, 'DLQUrl', {
      value: this.deadLetterQueue.queueUrl,
      description: 'EventBridge Dead Letter Queue URL',
    });

    new cdk.CfnOutput(this, 'DLQArn', {
      value: this.deadLetterQueue.queueArn,
      description: 'EventBridge Dead Letter Queue ARN',
      exportName: `EventBridgeDLQArn-${props.environment}`,
    });
  }

  /**
   * Inline Lambda code for DLQ processing
   */
  private getDlqProcessorCode(): string {
    return `
const { EventBridgeClient, PutEventsCommand } = require('@aws-sdk/client-eventbridge');
const { SQSClient, DeleteMessageCommand } = require('@aws-sdk/client-sqs');

const eventBridge = new EventBridgeClient({});
const sqs = new SQSClient({});

const MAX_RETRIES = 3;

exports.handler = async (event) => {
  console.log('Processing DLQ messages:', JSON.stringify(event, null, 2));
  
  const results = [];
  
  for (const record of event.Records) {
    const messageBody = JSON.parse(record.body);
    const retryCount = parseInt(messageBody.retryCount || '0', 10);
    
    console.log('Processing message:', {
      messageId: record.messageId,
      retryCount,
      eventType: messageBody.detail?.eventType || messageBody['detail-type'],
    });
    
    // Check if we should retry
    if (retryCount < MAX_RETRIES) {
      try {
        // Retry publishing to EventBridge
        const retryEvent = {
          Source: messageBody.source || 'edforge.dlq-processor',
          DetailType: messageBody['detail-type'] || 'RetryEvent',
          Detail: JSON.stringify({
            ...messageBody.detail,
            retryCount: retryCount + 1,
            originalMessageId: record.messageId,
            retryTimestamp: new Date().toISOString(),
          }),
          EventBusName: process.env.EVENT_BUS_NAME,
        };
        
        await eventBridge.send(new PutEventsCommand({
          Entries: [retryEvent],
        }));
        
        console.log('Successfully retried event:', messageBody['detail-type']);
        results.push({ messageId: record.messageId, status: 'retried' });
      } catch (error) {
        console.error('Failed to retry event:', error);
        results.push({ messageId: record.messageId, status: 'retry_failed', error: error.message });
      }
    } else {
      // Max retries exceeded - log for manual intervention
      console.error('Max retries exceeded for event:', {
        messageId: record.messageId,
        eventType: messageBody['detail-type'],
        detail: messageBody.detail,
      });
      results.push({ messageId: record.messageId, status: 'max_retries_exceeded' });
    }
  }
  
  console.log('DLQ processing results:', JSON.stringify(results, null, 2));
  
  return {
    statusCode: 200,
    body: JSON.stringify({ processed: results.length, results }),
  };
};
`;
  }
}

