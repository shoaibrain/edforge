import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';
import * as crypto from 'crypto';

export interface EventBridgeArchiveProps {
  eventBus: events.IEventBus;
}

export class EventBridgeArchive extends Construct {
  public readonly archiveBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: EventBridgeArchiveProps) {
    super(scope, id);

    // Generate a short unique identifier from the node address (max 63 chars for bucket name)
    const stack = cdk.Stack.of(this);
    const uniqueId = crypto.createHash('sha256')
      .update(`${stack.stackName}-${this.node.addr}`)
      .digest('hex')
      .substring(0, 8);
    const bucketName = `edforge-event-archive-${uniqueId}`;

    // S3 bucket for event archiving
    this.archiveBucket = new s3.Bucket(this, 'EventArchiveBucket', {
      bucketName: bucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: false,
      lifecycleRules: [
        {
          id: 'ArchiveToGlacier',
          enabled: true,
          transitions: [
            {
              storageClass: s3.StorageClass.GLACIER,
              transitionAfter: Duration.days(90)
            },
            {
              storageClass: s3.StorageClass.DEEP_ARCHIVE,
              transitionAfter: Duration.days(365)
            }
          ]
        }
      ]
    });

    // EventBridge archive rule (optional - can be enabled later)
    // This would archive all events to S3
    // For MVP, we'll rely on Firehose for Analytics events
  }
}

