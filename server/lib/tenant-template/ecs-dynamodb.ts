import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';
import { isProdAccount } from '../utilities/account-guards';

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
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: props.partitionKey, type: dynamodb.AttributeType.STRING },
      sortKey: { name: props.sortKey, type: dynamodb.AttributeType.STRING },
      // RETAIN: Tenant DynamoDB tables contain school data (students,
      // grades, attendance, finance). Stack deletion must never destroy
      // this data. Tables must be manually decommissioned after data export.
      // Change back to DESTROY only in local dev environments.
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      // deletionProtection is the API-level companion to RemovalPolicy.RETAIN:
      // RETAIN blocks CloudFormation from deleting the table; deletionProtection
      // also blocks `aws dynamodb delete-table` and console deletes. Gated on
      // prod account so UAT teardown (Sprint 3) is not blocked.
      deletionProtection: isProdAccount(),
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
    });

    // GSI2: Academic Year Index - Query all entities for a specific academic year
    // Use case: Get all grading periods, holidays for year-789
    // CRITICAL: Required for academic-year.service.ts getGradingPeriods() and getHolidays()
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI2',
      partitionKey: { name: 'gsi2pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi2sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI3: Assignment Index - Query grades by assignment
    // Use case: Get all grades for assignment-123 in academic-year-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI3',
      partitionKey: { name: 'gsi3pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi3sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI4: Category Index - Query grades by category
    // Use case: Get all homework grades for category-homework in academic-year-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI4',
      partitionKey: { name: 'gsi4pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi4sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI5: Term Index - Query grades by academic term
    // Use case: Get all grades for semester-1 in academic-year-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI5',
      partitionKey: { name: 'gsi5pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi5sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI6: School Index - Query all academic data by school
    // Use case: Get all grades, attendance, assignments for school-789 in academic-year-456
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI6',
      partitionKey: { name: 'gsi6pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi6sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI7-GSI12: Incremental index additions
    // AWS DynamoDB limitation: Only ONE GSI can be created/deleted per table update.
    // GSIs 8-12 below remain commented out; add them one at a time in separate
    // deployments (one GSI per `cdk deploy`, waiting for ACTIVE status between
    // each). See: DYNAMODB_GSI_DEPLOYMENT_ISSUE.md for the rollout strategy.
    //
    // GSI7: Student Index — Query students by EMIS/government ID (Project
    // Midnight Lockin P0.2) and, in future, student-centric rollups such as
    // "all enrollments/invoices/payments for a student". Both access patterns
    // share GSI7 via PK-pattern overloading:
    //   - EMIS lookup:   gsi7pk=TENANT#{tid}#EMIS#{emisStudentId}   gsi7sk=STUDENT#{studentId}
    //   - Student rollup (future): gsi7pk=TENANT#{tid}#STUDENT#{studentId}   gsi7sk=ENROLLMENT#...|INVOICE#...|PAYMENT#...
    // Queries always scope by full gsi7pk so the overload is safe.
    //
    // NOTE: capacity fields intentionally omitted (table is PAY_PER_REQUEST).
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI7',
      partitionKey: { name: 'gsi7pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi7sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI8: IEMIS School Code Index (Sprint 1, S1.3) — cross-tenant
    // uniqueness enforcement on the Nepal CEHRD-issued emisSchoolCode.
    //
    // Sparse: gsi8pk is populated only on the SCHOOL entity rows of
    // PABSON tenants (or any tenant that chose to provide an
    // emisSchoolCode). Every other row leaves gsi8pk unset → the row
    // is invisible to this index, so the index cardinality stays at
    // "number of schools with an emisSchoolCode" (tiny).
    //
    // Key design:
    //   - gsi8pk = <emisSchoolCode>         e.g. "31012345"
    //   - gsi8sk = TENANT#{tid}#SCHOOL#{sid}   (for audit / debug context)
    //
    // Query pattern for uniqueness check at School create:
    //   KeyConditionExpression: 'gsi8pk = :code'
    //   If any item returns → 409 DUPLICATE_IEMIS_CODE
    //
    // NOTE: this index shares the numeric slot with a previously-
    // reserved "Staff-Centric" GSI8 idea that was never implemented.
    // If a staff-centric index is ever needed, it moves to GSI9.
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI8',
      partitionKey: { name: 'gsi8pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi8sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // GSI9: Block → CalendarDate child rows (Sprint C4.2 — Multi-Day Event
    // Blocks). Given a `blockId`, return every CalendarDate row that's a
    // child of that block, sorted by date. Drives `GET /calendar-blocks/:id`
    // and the cascading `DELETE /calendar-blocks/:id` operation.
    //
    // Sparse: gsi9pk is populated only on CalendarDate rows that are part
    // of a multi-day block (i.e., `blockId !== undefined`). Single-day
    // CalendarDate rows leave gsi9pk unset → invisible to this index, so
    // cardinality stays bounded to "rows in active blocks".
    //
    // Key design:
    //   - gsi9pk = BLOCK#{blockId}
    //   - gsi9sk = DATE#{date}        (YYYY-MM-DD)
    //
    // The slot was previously reserved (commented) for a parent-centric
    // index that never shipped. Re-using it for the block→dates pattern
    // per the C4.0 GSI inventory audit. If a parent-centric pattern
    // ships later it moves to GSI13+.
    //
    // NOTE: capacity fields intentionally omitted (table is PAY_PER_REQUEST).
    this.table.addGlobalSecondaryIndex({
      indexName: 'GSI9',
      partitionKey: { name: 'gsi9pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'gsi9sk', type: dynamodb.AttributeType.STRING },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    /*

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
    */

    // Create ABAC policy for tenant isolation
    // ARCHITECTURE NOTE: GSI queries cannot use LeadingKeys condition because GSIs
    // use different partition keys (gsi1pk-gsi12pk) instead of tenantId.
    // Tenant filtering for GSI queries happens at the application level.
    this.policyDocument = new cdk.aws_iam.PolicyDocument({ 
      statements: [
        // Main table access with ABAC tenant isolation
        new cdk.aws_iam.PolicyStatement({
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:BatchGetItem', 'dynamodb:BatchWriteItem',
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
