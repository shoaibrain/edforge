import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as crypto from 'crypto';

/**
 * Glue Tables for Analytics Data Lake
 * 
 * Creates Glue database and tables for event data stored in S3.
 * Tables use partition projection for efficient querying without MSCK REPAIR.
 * Events are stored as JSON (GZIP compressed) from Kinesis Firehose.
 * 
 * Note: The detail field is stored as a JSON string. Use JSON functions in Athena
 * queries to parse it: JSON_EXTRACT_SCALAR(detail, '$.tenantId')
 */
export interface GlueTablesProps {
  dataLakeBucket: s3.IBucket;
}

export class GlueTables extends Construct {
  public readonly database: glue.CfnDatabase;
  public readonly workgroup: athena.CfnWorkGroup;
  public readonly resultsBucket: s3.Bucket;
  public readonly tables: Map<string, glue.CfnTable>;

  constructor(scope: Construct, id: string, props: GlueTablesProps) {
    super(scope, id);

    // Create Glue database
    const stack = cdk.Stack.of(this);
    this.database = new glue.CfnDatabase(this, 'AnalyticsDatabase', {
      catalogId: stack.account,
      databaseInput: {
        name: 'edforge_analytics',
        description: 'EdForge Analytics Data Lake - Event tables for all services',
        locationUri: `s3://${props.dataLakeBucket.bucketName}/`
      }
    });

    // Generate a short unique identifier from the node address (max 63 chars for bucket name)
    const uniqueId = crypto.createHash('sha256')
      .update(`${stack.stackName}-${this.node.addr}`)
      .digest('hex')
      .substring(0, 8);
    const bucketName = `edforge-athena-results-${uniqueId}`;

    // Create S3 bucket for Athena query results
    this.resultsBucket = new s3.Bucket(this, 'AthenaResultsBucket', {
      bucketName: bucketName,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      autoDeleteObjects: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Create Athena workgroup for query execution
    this.workgroup = new athena.CfnWorkGroup(this, 'AnalyticsWorkgroup', {
      name: 'edforge-analytics-workgroup',
      description: 'Athena workgroup for EdForge Analytics queries',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${this.resultsBucket.bucketName}/`,
          encryptionConfiguration: {
            encryptionOption: 'SSE_S3'
          }
        },
        enforceWorkGroupConfiguration: true
      },
      recursiveDeleteOption: false
    });

    // Initialize tables map
    this.tables = new Map();

    // Define service-to-table mapping
    // Note: S3 prefix uses service name (e.g., 'assessment-service'), not event source
    const serviceTables = [
      { name: 'school_events', service: 'edforge.school-service', s3Prefix: 'school-service' },
      { name: 'enrollment_events', service: 'edforge.enrollment-service', s3Prefix: 'enrollment-service' },
      { name: 'curriculum_events', service: 'edforge.curriculum-service', s3Prefix: 'curriculum-service' },
      { name: 'assessment_events', service: 'edforge.assessment-service', s3Prefix: 'assessment-service' },
      { name: 'attendance_events', service: 'edforge.attendance-service', s3Prefix: 'attendance-service' },
      { name: 'finance_events', service: 'edforge.finance-service', s3Prefix: 'finance-service' },
      { name: 'staff_events', service: 'edforge.staff-service', s3Prefix: 'staff-service' },
      { name: 'parent_portal_events', service: 'edforge.parent-portal-service', s3Prefix: 'parent-portal-service' }
    ];

    // Create table for each service
    serviceTables.forEach(({ name, service, s3Prefix }) => {
      const table = this.createEventTable(name, service, s3Prefix, props.dataLakeBucket);
      this.tables.set(name, table);
    });
  }

  /**
   * Create a Glue table for a specific service's events
   */
  private createEventTable(
    tableName: string,
    eventSource: string,
    s3ServicePrefix: string,
    bucket: s3.IBucket
  ): glue.CfnTable {
    // Common schema for EventBridge events
    // Events are stored as JSON with EventBridge envelope structure
    // The 'detail' field contains the actual event payload as a JSON string
    // Note: EventBridge uses "detail-type" (hyphen) in JSON at root level
    const columns: glue.CfnTable.ColumnProperty[] = [
      // EventBridge envelope fields
      { name: 'id', type: 'string', comment: 'EventBridge event ID' },
      { name: 'source', type: 'string', comment: 'Event source (e.g., edforge.assessment-service)' },
      { name: 'account', type: 'string', comment: 'AWS account ID' },
      { name: 'time', type: 'string', comment: 'Event timestamp (ISO 8601)' },
      { name: 'region', type: 'string', comment: 'AWS region' },
      { name: 'version', type: 'string', comment: 'EventBridge version' },
      // Detail field contains the actual event payload as JSON string
      // Use JSON_EXTRACT_SCALAR(detail, '$.fieldName') in queries to access nested fields
      { name: 'detail', type: 'string', comment: 'Event detail payload (JSON string)' }
      // Note: "detail-type" field is at root level of EventBridge JSON
      // The JSON SerDe will create a column for it based on the paths parameter
      // Access in queries using: "detail-type" (with double quotes)
    ];

    // Partition columns for partition projection
    const partitionKeys: glue.CfnTable.ColumnProperty[] = [
      { name: 'year', type: 'string', comment: 'Year partition (YYYY)' },
      { name: 'month', type: 'string', comment: 'Month partition (MM)' },
      { name: 'day', type: 'string', comment: 'Day partition (DD)' },
      { name: 'service', type: 'string', comment: 'Service partition' }
    ];

    // Build partition projection parameters
    // S3 location template matches Firehose partitioning: events/year=YYYY/month=MM/day=DD/service={service}/
    const projectionParams: Record<string, string> = {
      'projection.enabled': 'true',
      'projection.year.type': 'integer',
      'projection.year.range': '2020,2030',
      'projection.year.format': 'yyyy',
      'projection.year.interval': '1',
      'projection.month.type': 'integer',
      'projection.month.range': '1,12',
      'projection.month.format': 'MM',
      'projection.month.interval': '1',
      'projection.day.type': 'integer',
      'projection.day.range': '1,31',
      'projection.day.format': 'dd',
      'projection.day.interval': '1',
      'projection.service.type': 'enum',
      'projection.service.values': 'school-service,enrollment-service,curriculum-service,assessment-service,attendance-service,finance-service,staff-service,parent-portal-service',
      'storage.location.template': `s3://${bucket.bucketName}/events/year=$${'{year}'}/month=$${'{month}'}/day=$${'{day}'}/service=$${'{service}'}/`,
      'classification': 'json',
      'compressionType': 'gzip'
    };

    const stack = cdk.Stack.of(this);
    const table = new glue.CfnTable(this, `${this.sanitizeId(tableName)}Table`, {
      catalogId: stack.account,
      databaseName: this.database.ref,
      tableInput: {
        name: tableName,
        description: `EventBridge events from ${eventSource}. Detail field contains JSON string with event payload.`,
        tableType: 'EXTERNAL_TABLE',
        storageDescriptor: {
          columns: columns,
          location: `s3://${bucket.bucketName}/events/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
            parameters: {
              'paths': 'id,source,"detail-type",account,time,region,version,detail',
              'ignore.malformed.json': 'true',
              'case.insensitive': 'false'
            }
          },
          compressed: true, // Events are GZIP compressed
          parameters: projectionParams
        },
        partitionKeys: partitionKeys,
        parameters: projectionParams
      }
    });

    table.addDependency(this.database);

    return table;
  }

  /**
   * Sanitize ID for CDK construct (remove hyphens, underscores)
   */
  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '');
  }
}

