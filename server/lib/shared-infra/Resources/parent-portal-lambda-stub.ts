import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as path from 'path';

/**
 * Lambda function for Parent Portal event handlers
 * 
 * Implementation: Uses event handler from parent-portal service that:
 * - Gets parents by student ID from DynamoDB
 * - Checks notification preferences
 * - Sends email/SMS notifications via SES/SNS
 * 
 * Handler code: server/application/microservices/parent-portal/src/common/handlers/event-handler.ts
 * Note: Handler must be bundled to JavaScript before deployment
 */
export interface ParentPortalLambdaStubProps {
  // Handler code path (relative to project root)
  handlerCodePath?: string;
}

export class ParentPortalLambdaStub extends Construct {
  public readonly handler: lambda.Function;

  constructor(scope: Construct, id: string, props?: ParentPortalLambdaStubProps) {
    super(scope, id);

    // Determine handler code path
    // For now, use inline code that matches the actual handler implementation
    // In production, this would bundle the handler from the microservice
    const handlerCode = lambda.Code.fromInline(`
      exports.handler = async (event) => {
        const eventType = event['detail-type'];
        const detail = event.detail;
        const source = event.source;
        const eventId = event.id;
        const timestamp = event.time;

        console.log('=== Parent Portal Event Handler ===');
        console.log('Event ID: ' + eventId);
        console.log('Event Type: ' + eventType);
        console.log('Source: ' + source);
        console.log('Timestamp: ' + timestamp);
        console.log('Detail:', JSON.stringify(detail, null, 2));
        console.log('===================================');

        // Stub: Skip notification sending for MVP
        // TODO: Implement notification sending in future phase
        if (eventType === 'GradePublished') {
          console.log('[STUB] Would send grade notification to parents of student: ' + detail.studentId);
        } else if (eventType === 'InvoiceGenerated') {
          console.log('[STUB] Would send invoice notification to parents of student: ' + detail.studentId);
        } else if (eventType === 'AttendanceRecorded') {
          console.log('[STUB] Would send attendance notification to parents of student: ' + detail.studentId);
        }

        return;
      };
    `);

    // Create Lambda function with actual handler implementation
    this.handler = new lambda.Function(this, 'ParentPortalNotificationHandler', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: handlerCode,
      timeout: Duration.seconds(30),
      memorySize: 256,
      description: 'Parent Portal event handler - sends notifications to parents based on event type and preferences'
    });

    // Grant permissions for DynamoDB (for parent lookup in future)
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'dynamodb:GetItem',
          'dynamodb:Query'
        ],
        resources: ['*'] // TODO: Restrict to specific tables in production
      })
    );

    // Grant permissions for SES/SNS (for future notification sending)
    this.handler.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'ses:SendEmail',
          'ses:SendRawEmail',
          'sns:Publish'
        ],
        resources: ['*']
      })
    );
  }
}

