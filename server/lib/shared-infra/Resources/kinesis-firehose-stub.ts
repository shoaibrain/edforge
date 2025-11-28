import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

/**
 * Kinesis Firehose stream for Analytics event ingestion
 * 
 * Enhanced in Phase 3 with proper S3 partitioning, error handling, and CloudWatch logging.
 * Enhanced in Phase 4 with Lambda transformation to extract service name for partitioning.
 * Events are delivered to S3 data lake in GZIP-compressed JSON format.
 * Parquet conversion can be added in future phases.
 */
export interface KinesisFirehoseStubProps {
  dataLakeBucket: s3.IBucket;
  transformerLambda?: lambda.IFunction;
}

export class KinesisFirehoseStub extends Construct {
  public readonly firehoseStream: firehose.CfnDeliveryStream;
  public readonly firehoseRole: iam.Role;

  constructor(scope: Construct, id: string, props: KinesisFirehoseStubProps) {
    super(scope, id);

    // Create IAM role for Firehose
    this.firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      description: 'Role for Kinesis Firehose to write to S3 data lake'
    });

    // Grant Firehose permission to write to S3
    props.dataLakeBucket.grantWrite(this.firehoseRole);

    // Grant Firehose permission to use KMS (if encryption is enabled)
    this.firehoseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kms:Decrypt',
          'kms:GenerateDataKey'
        ],
        resources: ['*']
      })
    );

    // Grant Firehose permission to write CloudWatch logs
    this.firehoseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'logs:PutLogEvents'
        ],
        resources: ['*']
      })
    );

    // Create CloudWatch log group for Firehose
    const logGroup = new logs.LogGroup(this, 'FirehoseLogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Grant Firehose permission to write to log group
    logGroup.grantWrite(this.firehoseRole);

    // Grant Firehose permission to invoke Lambda transformer (if provided)
    if (props.transformerLambda) {
      props.transformerLambda.grantInvoke(this.firehoseRole);
      this.firehoseRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            'lambda:InvokeFunction'
          ],
          resources: [props.transformerLambda.functionArn]
        })
      );
    }

    // Build Firehose configuration
    // Use extendedS3DestinationConfiguration if Lambda transformer is provided
    // Otherwise use basic s3DestinationConfiguration
    const baseConfig: any = {
      bucketArn: props.dataLakeBucket.bucketArn,
      roleArn: this.firehoseRole.roleArn,
      bufferingHints: {
        sizeInMBs: 5,
        intervalInSeconds: 60
      },
      compressionFormat: 'GZIP',
      cloudWatchLoggingOptions: {
        enabled: false,
        // logGroupName: logGroup.logGroupName,
        // logStreamName: 'firehose-delivery'
      }
    };

    // Configure S3 prefix partitioning
    // If Lambda transformer is used, partition key comes from Lambda metadata
    // Syntax: !{partitionKeyFromLambda:keyName} extracts partition key from Lambda response metadata
    if (props.transformerLambda) {
      baseConfig.prefix = 'events/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/service=!{partitionKeyFromLambda:service}/';
      baseConfig.processingConfiguration = {
        enabled: true,
        processors: [
          {
            type: 'Lambda',
            parameters: [
              {
                parameterName: 'LambdaArn',
                parameterValue: props.transformerLambda.functionArn
              },
              {
                parameterName: 'NumberOfRetries',
                parameterValue: '3'
              },
              {
                parameterName: 'RoleArn',
                parameterValue: this.firehoseRole.roleArn
              },
              {
                parameterName: 'BufferSizeInMBs',
                parameterValue: '3'
              },
              {
                parameterName: 'BufferIntervalInSeconds',
                parameterValue: '60'
              }
            ]
          }
        ]
      };
    } else {
      // Fallback: use partitionKeyFromQuery (requires partition key in PutRecord)
      // This won't work with EventBridge → Firehose, but kept for backward compatibility
      baseConfig.prefix = 'events/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/service=!{partitionKeyFromQuery:service}/';
    }

    // Error output with date partitioning for easier debugging
    // Note: ErrorOutputPrefix must contain !{firehose:error-output-type} placeholder
    baseConfig.errorOutputPrefix = 'errors/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/!{firehose:error-output-type}/';

    // Create Firehose delivery stream
    // Use extendedS3DestinationConfiguration if Lambda transformer is provided
    if (props.transformerLambda) {
      this.firehoseStream = new firehose.CfnDeliveryStream(this, 'EdForgeEventsStream', {
        deliveryStreamType: 'DirectPut',
        extendedS3DestinationConfiguration: baseConfig
      });
    } else {
      this.firehoseStream = new firehose.CfnDeliveryStream(this, 'EdForgeEventsStream', {
        deliveryStreamType: 'DirectPut',
        s3DestinationConfiguration: baseConfig
      });
    }
  }
}

