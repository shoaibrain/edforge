import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import { Construct } from 'constructs';

import * as iam from 'aws-cdk-lib/aws-iam';

export interface EventBridgeRulesProps {
  eventBus: events.IEventBus;
  parentPortalHandler: lambda.IFunction;
  firehoseStream?: firehose.CfnDeliveryStream;
  firehoseRole?: iam.IRole;
  parentPortalDlq: sqs.IQueue;
  analyticsDlq: sqs.IQueue;
}

export class EventBridgeRules extends Construct {
  constructor(scope: Construct, id: string, props: EventBridgeRulesProps) {
    super(scope, id);

    // Rule 1: Parent Portal - Grade Published
    new events.Rule(this, 'ParentPortalGradePublishedRule', {
      eventBus: props.eventBus,
      ruleName: 'parent-portal-grade-published',
      eventPattern: {
        source: ['edforge.assessment-service'],
        detailType: ['GradePublished']
      },
      targets: [
        new targets.LambdaFunction(props.parentPortalHandler, {
          deadLetterQueue: props.parentPortalDlq,
          retryAttempts: 3
        })
      ]
    });

    // Rule 2: Parent Portal - Invoice Generated
    new events.Rule(this, 'ParentPortalInvoiceGeneratedRule', {
      eventBus: props.eventBus,
      ruleName: 'parent-portal-invoice-generated',
      eventPattern: {
        source: ['edforge.finance-service'],
        detailType: ['InvoiceGenerated']
      },
      targets: [
        new targets.LambdaFunction(props.parentPortalHandler, {
          deadLetterQueue: props.parentPortalDlq,
          retryAttempts: 3
        })
      ]
    });

    // Rule 3: Parent Portal - Attendance Recorded
    new events.Rule(this, 'ParentPortalAttendanceRecordedRule', {
      eventBus: props.eventBus,
      ruleName: 'parent-portal-attendance-recorded',
      eventPattern: {
        source: ['edforge.attendance-service'],
        detailType: ['AttendanceRecorded']
      },
      targets: [
        new targets.LambdaFunction(props.parentPortalHandler, {
          deadLetterQueue: props.parentPortalDlq,
          retryAttempts: 3
        })
      ]
    });

    /*
    // Rule 4: Analytics - All Events
    // Using low-level CfnRule to bypass L2 validation checks
    const analyticsRule = new events.CfnRule(this, 'AnalyticsAllEventsRule', {
      eventBusName: props.eventBus.eventBusName,
      name: 'analytics-all-events',
      eventPattern: {
        source: [
          'edforge.school-service',
          'edforge.enrollment-service',
          'edforge.curriculum-service',
          'edforge.assessment-service',
          'edforge.attendance-service',
          'edforge.finance-service',
          'edforge.staff-service',
          'edforge.parent-portal-service'
        ]
      },
      targets: [{
        id: 'FirehoseTarget',
        arn: props.firehoseStream.attrArn,
        roleArn: props.firehoseRole.roleArn
      }]
    });
    
    // Ensure Firehose stream is created before the rule
    analyticsRule.node.addDependency(props.firehoseStream);
    */
  }
}

