import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

export interface EcsDynamoDBProps  {
  name: string
  partitionKey: string
  sortKey: string
  tableName: string
  tenantName: string
}

export class EcsDynamoDB extends Construct {
  public readonly table: dynamodb.Table;
  public readonly policyDocument: cdk.aws_iam.PolicyDocument;

  constructor (scope: Construct, id: string, props: EcsDynamoDBProps) {
    super(scope, id);

    this.table = new dynamodb.Table(this, `${props.tableName}`, {
      tableName: `${props.tableName}`,
      billingMode: dynamodb.BillingMode.PROVISIONED,
      // readCapacity: 5, writeCapacity: 5,
      partitionKey: { name: props.partitionKey, type: dynamodb.AttributeType.STRING },
      sortKey: { name: props.sortKey, type: dynamodb.AttributeType.STRING },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // pointInTimeRecovery: true
      pointInTimeRecoverySpecification: { 
        pointInTimeRecoveryEnabled: true 
      },
      // TTL for audit logs (FERPA compliance - 2 year retention)
      timeToLiveAttribute: 'ttl'
    });
    cdk.Tags.of(this.table).add('TenantName', props.tenantName);

    // Add Global Secondary Indexes for School Service
    // PHASE 1: Start with only GSI1 to avoid CloudFormation limitations
    // DynamoDB allows only 1 GSI creation/deletion per update
    // We'll add the remaining GSIs in subsequent deployments
    
    // GSI1: School Index - Query all entities for a specific school
    // Use case: Get all departments, years, configs for school-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'gsi1pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi1sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // GSI2: Academic Year Index - Query all entities for a specific academic year
    // Use case: Get all grading periods, holidays for year-789
    // CRITICAL: Required for academic-year.service.ts getGradingPeriods() and getHolidays()
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // TODO: Add remaining GSIs in subsequent deployments:
    // - GSI3: Status Index (gsi3pk + gsi3sk) 
    // - GSI4: Activity Log Index (gsi4pk + gsi4sk)

    // Create ABAC policy for tenant isolation
    // ARCHITECTURE NOTE: GSI queries cannot use LeadingKeys condition because GSIs
    // use different partition keys (gsi1pk, gsi2pk) instead of tenantId.
    // Tenant filtering for GSI queries happens at the application level.
    this.policyDocument = new cdk.aws_iam.PolicyDocument({ 
      statements: [
        // Main table access with ABAC tenant isolation
        new cdk.aws_iam.PolicyStatement({
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 
            'dynamodb:UpdateItem', 'dynamodb:DeleteItem', 'dynamodb:Query'],
          resources: [this.table.tableArn],
          effect: cdk.aws_iam.Effect.ALLOW,
          conditions: {
            'ForAllValues:StringEquals': {
              'dynamodb:LeadingKeys': ['${aws:PrincipalTag/tenant}']
            }
          }
        }),
        // GSI access - tenant filtering at application level
        // Cannot use LeadingKeys condition for GSIs as they use different partition keys
        new cdk.aws_iam.PolicyStatement({
          actions: ['dynamodb:Query'],
          resources: [`${this.table.tableArn}/index/*`],
          effect: cdk.aws_iam.Effect.ALLOW
        })
      ]
    });

    new cdk.CfnOutput(this, `${props.name}TableName`, {
      value: this.table.tableName
    });

  }
}
