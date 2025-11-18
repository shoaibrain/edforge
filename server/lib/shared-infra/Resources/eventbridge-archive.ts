import * as s3 from 'aws-cdk-lib/aws-s3';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

export interface EventBridgeArchiveProps {
  eventBus: events.IEventBus;
}

export class EventBridgeArchive extends Construct {
  public readonly archiveBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: EventBridgeArchiveProps) {
    super(scope, id);

    // S3 bucket for event archiving
    this.archiveBucket = new s3.Bucket(this, 'EventArchiveBucket', {
      bucketName: `edforge-event-archive-${this.node.addr}`,
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

