import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import { Duration } from 'aws-cdk-lib';

/**
 * S3 Data Lake bucket for Analytics Service
 * 
 * Stores events from Kinesis Firehose in Parquet format for querying with Athena.
 */
export interface S3DataLakeProps {
  // No props needed
}

export class S3DataLake extends Construct {
  public readonly dataLakeBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: S3DataLakeProps) {
    super(scope, id);

    // Create S3 bucket for data lake
    this.dataLakeBucket = new s3.Bucket(this, 'DataLakeBucket', {
      bucketName: `edforge-data-lake-${this.node.addr}`,
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
      ],
      // Enable server access logging
      serverAccessLogsBucket: undefined, // Can be configured later
      // Block public access
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL
    });
  }
}

