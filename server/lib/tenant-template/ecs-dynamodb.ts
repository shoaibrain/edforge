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

    // Add Global Secondary Indexes for School, Academic, and Enrollment Services
    // GSI1-GSI2: School Service (departments, academic years, configs)
    // GSI3-GSI6: Academic Service (grades, attendance, assignments, analytics)
    // GSI7-GSI12: Enrollment Service (students, staff, parents, finance)
    
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

    // GSI3: Assignment Index - Query grades by assignment
    // Use case: Get all grades for assignment-123 in academic-year-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'gsi3pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi3sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // GSI4: Category Index - Query grades by category
    // Use case: Get all homework grades for category-homework in academic-year-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI4',
      partitionKey: { name: 'gsi4pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi4sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // GSI5: Term Index - Query grades by academic term
    // Use case: Get all grades for semester-1 in academic-year-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI5',
      partitionKey: { name: 'gsi5pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi5sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // GSI6: School Index - Query all academic data by school
    // Use case: Get all grades, attendance, assignments for school-789 in academic-year-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI6',
      partitionKey: { name: 'gsi6pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi6sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // GSI7-GSI12: Enrollment Service (students, staff, parents, finance)
    // GSI7: Student-Centric Index - Query all enrollments, invoices, payments for a student
    // Use case: Get all enrollments, invoices, payments for student-123
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI7',
      partitionKey: { name: 'gsi7pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi7sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // GSI8: Staff-Centric Index - Query all assignments, roles for a staff member
    // Use case: Get all assignments, roles for staff-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI8',
      partitionKey: { name: 'gsi8pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi8sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // GSI9: Parent-Centric Index - Query all children, notifications for a parent
    // Use case: Get all children, notifications for parent-789
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI9',
      partitionKey: { name: 'gsi9pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi9sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // GSI10: Invoice Status Index - Efficiently find all overdue invoices
    // Use case: Find all overdue invoices for school-123 in year-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI10',
      partitionKey: { name: 'gsi10pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi10sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // GSI11: Staff by Department Index - List all staff in a department
    // Use case: Get all staff in department-MATH
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI11',
      partitionKey: { name: 'gsi11pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi11sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // GSI12: Parent-Student Relationship Index - Get all parents/guardians for a student
    // Use case: Get all parents/guardians for student-123
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI12',
      partitionKey: { name: 'gsi12pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi12sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
      readCapacity: 5,
      writeCapacity: 5
    });

    // Create ABAC policy for tenant isolation
    // ARCHITECTURE NOTE: GSI queries cannot use LeadingKeys condition because GSIs
    // use different partition keys (gsi1pk-gsi12pk) instead of tenantId.
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
