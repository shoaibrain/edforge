import * as s3 from 'aws-cdk-lib/aws-s3';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

/**
 * Stub Kinesis Firehose stream for Analytics event ingestion
 * 
 * This is a placeholder that will be fully implemented in Phase 3.
 * For now, it creates a basic Firehose stream that can receive events from EventBridge.
 */
export interface KinesisFirehoseStubProps {
  dataLakeBucket: s3.IBucket;
}

export class KinesisFirehoseStub extends Construct {
  public readonly firehoseStream: firehose.CfnDeliveryStream;

  constructor(scope: Construct, id: string, props: KinesisFirehoseStubProps) {
    super(scope, id);

    // Create IAM role for Firehose
    const firehoseRole = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com'),
      description: 'Role for Kinesis Firehose to write to S3 data lake'
    });

    // Grant Firehose permission to write to S3
    props.dataLakeBucket.grantWrite(firehoseRole);

    // Grant Firehose permission to use KMS (if encryption is enabled)
    firehoseRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'kms:Decrypt',
          'kms:GenerateDataKey'
        ],
        resources: ['*']
      })
    );

    // Create Firehose delivery stream (stub - will be enhanced in Phase 3)
    this.firehoseStream = new firehose.CfnDeliveryStream(this, 'EdForgeEventsStream', {
      deliveryStreamName: 'edforge-events-stream',
      deliveryStreamType: 'DirectPut',
      s3DestinationConfiguration: {
        bucketArn: props.dataLakeBucket.bucketArn,
        roleArn: firehoseRole.roleArn,
        bufferingHints: {
          sizeInMBs: 5,
          intervalInSeconds: 60
        },
        compressionFormat: 'GZIP',
        prefix: 'events/year=!{timestamp:yyyy}/month=!{timestamp:MM}/day=!{timestamp:dd}/service=!{partitionKeyFromQuery:service}/',
        errorOutputPrefix: 'errors/',
        cloudWatchLoggingOptions: {
          enabled: true,
          logGroupName: '/aws/kinesisfirehose/edforge-events-stream'
        }
      }
    });
  }
}

