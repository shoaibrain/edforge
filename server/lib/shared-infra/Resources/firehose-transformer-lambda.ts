import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

/**
 * Lambda function for Firehose data transformation
 * 
 * Extracts service name from EventBridge event source field and adds it as metadata
 * for S3 partitioning. This enables proper partitioning by service in the data lake.
 * 
 * EventBridge event structure:
 * {
 *   "source": "edforge.assessment-service",
 *   "detail-type": "GradePublished",
 *   "detail": { ... },
 *   ...
 * }
 * 
 * Transforms to:
 * {
 *   "recordId": "...",
 *   "result": "Ok",
 *   "data": "<base64-encoded-event>",
 *   "metadata": {
 *     "partitionKeys": {
 *       "service": "assessment-service"
 *     }
 *   }
 * }
 */
export interface FirehoseTransformerLambdaProps {
  // No props needed
}

export class FirehoseTransformerLambda extends Construct {
  public readonly handler: lambda.Function;

  constructor(scope: Construct, id: string, props?: FirehoseTransformerLambdaProps) {
    super(scope, id);

    // Create CloudWatch log group for Lambda
    const logGroup = new logs.LogGroup(this, 'FirehoseTransformerLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Lambda function code that extracts service name from EventBridge event source
    const handlerCode = lambda.Code.fromInline(`
      const AWS = require('aws-sdk');
      
      /**
       * Extract service name from EventBridge event source
       * Examples:
       *   "edforge.assessment-service" -> "assessment-service"
       *   "edforge.school-service" -> "school-service"
       *   "edforge.parent-portal-service" -> "parent-portal-service"
       */
      function extractServiceName(source) {
        if (!source || typeof source !== 'string') {
          return 'unknown-service';
        }
        
        // EventBridge source format: "edforge.{service-name}"
        const parts = source.split('.');
        if (parts.length >= 2 && parts[0] === 'edforge') {
          return parts.slice(1).join('.'); // Handle multi-part service names
        }
        
        // Fallback: try to extract service name from source
        const match = source.match(/edforge\\.([\\w-]+)/);
        if (match && match[1]) {
          return match[1] + '-service';
        }
        
        return 'unknown-service';
      }
      
      /**
       * Transform EventBridge event for Firehose
       * Adds service name as partition key metadata
       */
      exports.handler = async (event) => {
        const output = event.records.map((record) => {
          try {
            // Decode the incoming event (base64 encoded)
            const payload = Buffer.from(record.data, 'base64').toString('utf-8');
            const eventBridgeEvent = JSON.parse(payload);
            
            // Extract service name from EventBridge event source
            const serviceName = extractServiceName(eventBridgeEvent.source);
            
            // Log for debugging (can be removed in production)
            console.log('Processing event:', {
              eventId: eventBridgeEvent.id,
              source: eventBridgeEvent.source,
              extractedService: serviceName,
              detailType: eventBridgeEvent['detail-type']
            });
            
            // Re-encode the event (keep original event structure)
            const transformedData = Buffer.from(payload).toString('base64');
            
            return {
              recordId: record.recordId,
              result: 'Ok',
              data: transformedData,
              metadata: {
                partitionKeys: {
                  service: serviceName
                }
              }
            };
          } catch (error) {
            console.error('Error processing record:', error);
            console.error('Record data:', record.data);
            
            // Return record with ProcessingFailed status
            return {
              recordId: record.recordId,
              result: 'ProcessingFailed',
              data: record.data
            };
          }
        });
        
        return { records: output };
      };
    `);

    // Create Lambda function
    this.handler = new lambda.Function(this, 'FirehoseTransformer', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: handlerCode,
      timeout: Duration.seconds(60),
      memorySize: 256,
      description: 'Extracts service name from EventBridge events for Firehose partitioning',
      logGroup: logGroup,
      environment: {
        LOG_LEVEL: 'INFO'
      }
    });

    // Grant Lambda permission to write CloudWatch logs
    logGroup.grantWrite(this.handler);

    // Lambda needs permission to be invoked by Firehose
    const stack = cdk.Stack.of(this);
    this.handler.addPermission('AllowFirehoseInvoke', {
      principal: new iam.ServicePrincipal('firehose.amazonaws.com'),
      sourceArn: `arn:aws:firehose:${stack.region}:${stack.account}:*`
    });
  }
}

