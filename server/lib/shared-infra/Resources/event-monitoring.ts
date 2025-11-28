import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

export interface EventMonitoringProps {
  parentPortalDlq: sqs.IQueue;
  analyticsDlq: sqs.IQueue;
  parentPortalHandler?: lambda.IFunction;
  firehoseStream?: firehose.CfnDeliveryStream;
  alarmTopic?: sns.ITopic;
}

export class EventMonitoring extends Construct {
  constructor(scope: Construct, id: string, props: EventMonitoringProps) {
    super(scope, id);

    // ============================================
    // DLQ Alarms (Enhanced)
    // ============================================

    // Alarm for Parent Portal DLQ messages
    const parentPortalDlqAlarm = new cloudwatch.Alarm(this, 'ParentPortalDlqAlarm', {
      alarmName: 'edforge-parent-portal-dlq-messages',
      alarmDescription: 'Alert when Parent Portal DLQ has messages (indicates event processing failures)',
      metric: props.parentPortalDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });

    // Alarm for Analytics DLQ messages
    const analyticsDlqAlarm = new cloudwatch.Alarm(this, 'AnalyticsDlqAlarm', {
      alarmName: 'edforge-analytics-dlq-messages',
      alarmDescription: 'Alert when Analytics DLQ has messages (indicates Firehose delivery failures)',
      metric: props.analyticsDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });

    // ============================================
    // Lambda Function Metrics (if handler provided)
    // ============================================

    if (props.parentPortalHandler) {
      // Alarm: Lambda errors
      const lambdaErrorAlarm = new cloudwatch.Alarm(this, 'ParentPortalLambdaErrorAlarm', {
        alarmName: 'edforge-parent-portal-lambda-errors',
        alarmDescription: 'Alert when Parent Portal Lambda has high error rate',
        metric: props.parentPortalHandler.metricErrors({
          statistic: 'Sum',
          period: Duration.minutes(5)
        }),
        threshold: 5,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
      });

      // Alarm: Lambda duration (processing latency)
      const lambdaDurationAlarm = new cloudwatch.Alarm(this, 'ParentPortalLambdaDurationAlarm', {
        alarmName: 'edforge-parent-portal-lambda-duration',
        alarmDescription: 'Alert when Parent Portal Lambda processing takes too long',
        metric: props.parentPortalHandler.metricDuration({
          statistic: 'Average',
          period: Duration.minutes(5)
        }),
        threshold: 5000, // 5 seconds in milliseconds
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
      });

      // Alarm: Lambda invocations (events not being consumed)
      const lambdaInvocationsAlarm = new cloudwatch.Alarm(this, 'ParentPortalLambdaInvocationsAlarm', {
        alarmName: 'edforge-parent-portal-lambda-no-invocations',
        alarmDescription: 'Alert when Parent Portal Lambda has no invocations (events not being consumed)',
        metric: props.parentPortalHandler.metricInvocations({
          statistic: 'Sum',
          period: Duration.hours(1)
        }),
        threshold: 1,
        evaluationPeriods: 1,
        comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.BREACHING
      });

      if (props.alarmTopic) {
        lambdaErrorAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(props.alarmTopic));
        lambdaDurationAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(props.alarmTopic));
        lambdaInvocationsAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(props.alarmTopic));
      }
    }

    // ============================================
    // Kinesis Firehose Metrics (if stream provided)
    // ============================================

    if (props.firehoseStream) {
      // Note: Firehose metrics are automatically created by AWS
      // We can create alarms based on CloudWatch namespace: AWS/Firehose
      // For now, we'll document the metrics that are available:
      // - DeliveryToS3.DataFreshness: Time since last delivery
      // - DeliveryToS3.Success: Successful deliveries
      // - DeliveryToS3.Records: Number of records delivered
      // - DeliveryToS3.Bytes: Bytes delivered
      
      // Alarm: Firehose delivery failures (via error output prefix in S3)
      // This would require custom metric from S3, so we'll rely on DLQ alarm for now
    }

    // ============================================
    // SNS Actions for All Alarms
    // ============================================

    if (props.alarmTopic) {
      parentPortalDlqAlarm.addAlarmAction(
        new cloudwatch_actions.SnsAction(props.alarmTopic)
      );
      analyticsDlqAlarm.addAlarmAction(
        new cloudwatch_actions.SnsAction(props.alarmTopic)
      );
    }
  }
}

