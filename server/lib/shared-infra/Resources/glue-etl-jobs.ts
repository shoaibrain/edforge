import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as s3deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';

/**
 * Glue ETL Jobs for Materialized Views
 * 
 * Creates Glue ETL jobs that aggregate event data into materialized views
 * for faster dashboard queries. Jobs run daily via EventBridge scheduler.
 */
export interface GlueEtlJobsProps {
  dataLakeBucket: s3.IBucket;
  glueDatabase: glue.CfnDatabase;
}

export class GlueEtlJobs extends Construct {
  public readonly jobs: Map<string, glue.CfnJob>;
  public readonly materializedViewTables: Map<string, glue.CfnTable>;

  constructor(scope: Construct, id: string, props: GlueEtlJobsProps) {
    super(scope, id);

    // Create IAM role for Glue ETL jobs
    const glueJobRole = new iam.Role(this, 'GlueJobRole', {
      assumedBy: new iam.ServicePrincipal('glue.amazonaws.com'),
      description: 'Role for Glue ETL jobs to read from data lake and write materialized views',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSGlueServiceRole')
      ]
    });

    // Grant permissions to read from data lake
    props.dataLakeBucket.grantRead(glueJobRole);

    // Grant permissions to write materialized views
    props.dataLakeBucket.grantWrite(glueJobRole);

    // Grant Glue permissions
    const stack = cdk.Stack.of(this);
    glueJobRole.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'glue:GetTable',
          'glue:GetDatabase',
          'glue:GetPartitions'
        ],
        resources: [
          `arn:aws:glue:${stack.region}:${stack.account}:catalog`,
          `arn:aws:glue:${stack.region}:${stack.account}:database/${props.glueDatabase.ref}`,
          `arn:aws:glue:${stack.region}:${stack.account}:table/${props.glueDatabase.ref}/*`
        ]
      })
    );

    // Initialize maps
    this.jobs = new Map();
    this.materializedViewTables = new Map();

    // Upload Glue ETL Python scripts to S3
    const scriptsPath = path.join(__dirname, 'glue-scripts');
    const scriptsDeployment = new s3deployment.BucketDeployment(this, 'GlueScriptsDeployment', {
      sources: [s3deployment.Source.asset(scriptsPath)],
      destinationBucket: props.dataLakeBucket,
      destinationKeyPrefix: 'glue-scripts/',
      prune: false // Keep old versions for rollback
    });

    // Define materialized views to create
    const materializedViews = [
      {
        name: 'student_dashboard_view',
        jobName: 'StudentDashboardETL',
        description: 'Materialized view for student dashboard aggregations',
        outputPrefix: 'materialized-views/student-dashboards',
        scriptName: 'student-dashboard-etl.py'
      },
      {
        name: 'principal_dashboard_view',
        jobName: 'PrincipalDashboardETL',
        description: 'Materialized view for principal dashboard aggregations',
        outputPrefix: 'materialized-views/principal-dashboards',
        scriptName: 'principal-dashboard-etl.py'
      },
      {
        name: 'teacher_dashboard_view',
        jobName: 'TeacherDashboardETL',
        description: 'Materialized view for teacher dashboard aggregations',
        outputPrefix: 'materialized-views/teacher-dashboards',
        scriptName: 'teacher-dashboard-etl.py'
      }
    ];

    // Create ETL job and table for each materialized view
    materializedViews.forEach(({ name, jobName, description, outputPrefix, scriptName }) => {
      const job = this.createEtlJob(
        jobName,
        description,
        props.dataLakeBucket,
        props.glueDatabase,
        glueJobRole,
        outputPrefix,
        scriptName
      );
      this.jobs.set(name, job);
      
      // Ensure job depends on scripts deployment (scripts must be uploaded before job can run)
      const deploymentCustomResource = scriptsDeployment.node.defaultChild as cdk.CfnResource;
      if (deploymentCustomResource && cdk.CfnResource.isCfnResource(deploymentCustomResource)) {
        job.addDependency(deploymentCustomResource);
      }

      const table = this.createMaterializedViewTable(
        name,
        props.dataLakeBucket,
        props.glueDatabase,
        outputPrefix
      );
      this.materializedViewTables.set(name, table);

      // Schedule job to run daily at 2 AM UTC
      this.scheduleEtlJob(jobName, job);
    });
  }

  /**
   * Create a Glue ETL job
   */
  private createEtlJob(
    jobName: string,
    description: string,
    bucket: s3.IBucket,
    database: glue.CfnDatabase,
    role: iam.IRole,
    outputPrefix: string,
    scriptName: string
  ): glue.CfnJob {
    // S3 script location for ETL job
    // Scripts are uploaded via BucketDeployment
    const scriptLocation = `s3://${bucket.bucketName}/glue-scripts/${scriptName}`;

    const job = new glue.CfnJob(this, `${jobName}Job`, {
      name: jobName,
      role: role.roleArn,
      command: {
        name: 'glueetl',
        scriptLocation: scriptLocation,
        pythonVersion: '3'
      },
      defaultArguments: {
        '--job-language': 'python',
        '--job-bookmark-option': 'job-bookmark-enable',
        '--enable-metrics': 'true',
        '--enable-continuous-cloudwatch-log': 'true',
        '--TempDir': `s3://${bucket.bucketName}/glue-temp/`,
        '--database': database.ref,
        '--output-bucket': bucket.bucketName,
        '--output-prefix': outputPrefix
      },
      glueVersion: '4.0',
      maxRetries: 1,
      timeout: 60, // 60 minutes timeout
      allocatedCapacity: 2, // 2 DPUs
      description: description
    });

    return job;
  }

  /**
   * Create Glue table for materialized view
   */
  private createMaterializedViewTable(
    tableName: string,
    bucket: s3.IBucket,
    database: glue.CfnDatabase,
    outputPrefix: string
  ): glue.CfnTable {
    const stack = cdk.Stack.of(this);
    // Schema depends on the materialized view type
    // For now, create a generic schema that can be customized
    const columns: glue.CfnTable.ColumnProperty[] = [
      { name: 'tenantId', type: 'string', comment: 'Tenant ID' },
      { name: 'schoolId', type: 'string', comment: 'School ID' },
      { name: 'academicYearId', type: 'string', comment: 'Academic Year ID' },
      { name: 'lastUpdated', type: 'string', comment: 'Last update timestamp' }
    ];

    // Add view-specific columns
    if (tableName === 'student_dashboard_view') {
      columns.push(
        { name: 'studentId', type: 'string', comment: 'Student ID' },
        { name: 'gpa', type: 'double', comment: 'GPA' },
        { name: 'attendanceRate', type: 'double', comment: 'Attendance rate (%)' },
        { name: 'completionRate', type: 'double', comment: 'Assignment completion rate (%)' }
      );
    } else if (tableName === 'principal_dashboard_view') {
      columns.push(
        { name: 'totalStudents', type: 'bigint', comment: 'Total students' },
        { name: 'avgAttendanceRate', type: 'double', comment: 'Average attendance rate (%)' },
        { name: 'avgGPA', type: 'double', comment: 'Average GPA' },
        { name: 'atRiskCount', type: 'bigint', comment: 'At-risk student count' }
      );
    } else if (tableName === 'teacher_dashboard_view') {
      columns.push(
        { name: 'teacherId', type: 'string', comment: 'Teacher ID' },
        { name: 'classroomId', type: 'string', comment: 'Classroom ID' },
        { name: 'studentCount', type: 'bigint', comment: 'Student count' },
        { name: 'avgScore', type: 'double', comment: 'Average score (%)' },
        { name: 'avgAttendanceRate', type: 'double', comment: 'Average attendance rate (%)' }
      );
    }

    // Partition keys for materialized views
    const partitionKeys: glue.CfnTable.ColumnProperty[] = [
      { name: 'year', type: 'string', comment: 'Year partition (YYYY)' },
      { name: 'month', type: 'string', comment: 'Month partition (MM)' },
      { name: 'day', type: 'string', comment: 'Day partition (DD)' }
    ];

    // Partition projection parameters
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
      'storage.location.template': `s3://${bucket.bucketName}/${outputPrefix}/year=$${'{year}'}/month=$${'{month}'}/day=$${'{day}'}/`,
      'classification': 'parquet'
    };

    const table = new glue.CfnTable(this, `${this.sanitizeId(tableName)}Table`, {
      catalogId: stack.account,
      databaseName: database.ref,
      tableInput: {
        name: tableName,
        description: `Materialized view: ${tableName}`,
        tableType: 'EXTERNAL_TABLE',
        storageDescriptor: {
          columns: columns,
          location: `s3://${bucket.bucketName}/${outputPrefix}/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          serdeInfo: {
            serializationLibrary: 'org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe',
            parameters: {
              'serialization.format': '1'
            }
          },
          compressed: false,
          parameters: projectionParams
        },
        partitionKeys: partitionKeys,
        parameters: projectionParams
      }
    });

    table.addDependency(database);

    return table;
  }

  /**
   * Schedule ETL job to run daily at 2 AM UTC
   * Note: EventBridge doesn't have a built-in GlueJob target in CDK.
   * We'll use a Lambda function as an intermediary to start the Glue job.
   */
  private scheduleEtlJob(jobName: string, job: glue.CfnJob): void {
    const rule = new events.Rule(this, `${jobName}Schedule`, {
      ruleName: `${jobName.toLowerCase()}-schedule`,
      description: `Daily schedule for ${jobName} ETL job`,
      schedule: events.Schedule.cron({
        minute: '0',
        hour: '2',
        day: '*',
        month: '*',
        year: '*'
      })
    });

    // Create a Lambda function to start the Glue job
    // This is a workaround since CDK doesn't have a direct GlueJob target
    const glueJobStarter = new lambda.Function(this, `${jobName}Starter`, {
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'index.handler',
      code: lambda.Code.fromInline(`
import boto3
import json

def handler(event, context):
    glue = boto3.client('glue')
    job_name = '${job.name || jobName}'
    
    try:
        response = glue.start_job_run(
            JobName=job_name,
            Arguments={
                '--job-bookmark-option': 'job-bookmark-enable'
            }
        )
        print(f'Started Glue job {job_name}: {response["JobRunId"]}')
        return {
            'statusCode': 200,
            'body': json.dumps({
                'jobName': job_name,
                'jobRunId': response['JobRunId']
            })
        }
    except Exception as e:
        print(f'Error starting Glue job {job_name}: {str(e)}')
        raise e
      `),
      timeout: cdk.Duration.minutes(1),
      description: `Starts Glue ETL job ${jobName} on schedule`
    });

    // Grant Lambda permission to start Glue job
    const stack = cdk.Stack.of(this);
    glueJobStarter.addToRolePolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'glue:StartJobRun',
          'glue:GetJobRun'
        ],
        resources: [
          `arn:aws:glue:${stack.region}:${stack.account}:job/${job.name || jobName}`
        ]
      })
    );

    // Add Lambda as target for the EventBridge rule
    rule.addTarget(new targets.LambdaFunction(glueJobStarter));
  }

  /**
   * Sanitize ID for CDK construct
   */
  private sanitizeId(id: string): string {
    return id.replace(/[^a-zA-Z0-9]/g, '');
  }
}

