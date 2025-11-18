import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface EventMonitoringProps {
  parentPortalDlq: sqs.IQueue;
  analyticsDlq: sqs.IQueue;
  alarmTopic?: sns.ITopic;
}

export class EventMonitoring extends Construct {
  constructor(scope: Construct, id: string, props: EventMonitoringProps) {
    super(scope, id);

    // Alarm for Parent Portal DLQ messages
    const parentPortalDlqAlarm = new cloudwatch.Alarm(this, 'ParentPortalDlqAlarm', {
      alarmName: 'edforge-parent-portal-dlq-messages',
      alarmDescription: 'Alert when Parent Portal DLQ has messages',
      metric: props.parentPortalDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });

    // Alarm for Analytics DLQ messages
    const analyticsDlqAlarm = new cloudwatch.Alarm(this, 'AnalyticsDlqAlarm', {
      alarmName: 'edforge-analytics-dlq-messages',
      alarmDescription: 'Alert when Analytics DLQ has messages',
      metric: props.analyticsDlq.metricApproximateNumberOfMessagesVisible(),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });

    // If alarm topic is provided, add SNS actions
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

