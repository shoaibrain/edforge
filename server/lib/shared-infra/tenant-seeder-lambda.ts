/**
 * Tenant Seeder Lambda - Event-Driven Tenant Synchronization
 * 
 * Listens for TenantProvisioned events from the SBT EventBridge bus
 * and seeds tenant metadata to the identity service DynamoDB table.
 * 
 * This ensures tenant data is available in the identity service
 * immediately after provisioning, enabling proper tenant validation.
 */

import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export interface TenantSeederProps {
  /**
   * The SBT EventBridge bus name (imported from ControlPlaneStack)
   */
  eventBusName: string;
}

export class TenantSeederLambda extends Construct {
  public readonly lambda: lambda.Function;

  constructor(scope: Construct, id: string, props: TenantSeederProps) {
    super(scope, id);

    // Lambda function to seed tenant metadata
    this.lambda = new lambda.Function(this, 'TenantSeederFn', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromInline(this.getLambdaCode()),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      description: 'Seeds tenant metadata to identity service on TenantProvisioned events',
      environment: {
        IDENTITY_TABLE_BASIC: 'edforge-identity-basic',
        IDENTITY_TABLE_PREMIUM: 'edforge-identity-premium',
        IDENTITY_TABLE_ADVANCED: 'edforge-identity-advanced',
      },
      logRetention: logs.RetentionDays.ONE_WEEK,
    });

    // Grant DynamoDB write permissions to identity tables
    this.lambda.addToRolePolicy(new iam.PolicyStatement({
      sid: 'DynamoDBWriteAccess',
      actions: [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:GetItem',
      ],
      resources: [
        `arn:aws:dynamodb:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:table/edforge-identity-basic`,
        `arn:aws:dynamodb:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:table/edforge-identity-premium`,
        `arn:aws:dynamodb:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:table/edforge-identity-advanced`,
      ],
    }));

    // Import the SBT EventBridge bus
    const eventBus = events.EventBus.fromEventBusName(
      this, 
      'SbtEventBus', 
      props.eventBusName
    );

    // EventBridge rule to trigger on TenantProvisioned events
    new events.Rule(this, 'TenantProvisionedRule', {
      ruleName: 'edforge-tenant-provisioned-seeder',
      description: 'Triggers tenant seeder Lambda when a new tenant is provisioned',
      eventBus,
      eventPattern: {
        source: ['edforge.provisioning'],
        detailType: ['TenantProvisioned'],
      },
      targets: [new targets.LambdaFunction(this.lambda, {
        retryAttempts: 2,
      })],
    });

    // Output the Lambda ARN for reference
    new cdk.CfnOutput(this, 'TenantSeederLambdaArn', {
      value: this.lambda.functionArn,
      description: 'Tenant Seeder Lambda ARN',
    });
  }

  /**
   * Inline Lambda code for tenant seeding
   * 
   * Uses conditional writes to ensure idempotency - if tenant
   * metadata already exists, the operation is skipped.
   */
  private getLambdaCode(): string {
    return `
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient({});

/**
 * Default tenant features by tier
 */
const DEFAULT_FEATURES = {
  BASIC: {
    maxSchools: 1,
    maxUsersPerSchool: 50,
    maxStudentsPerSchool: 500,
    enrollment: true,
    attendance: true,
    grades: true,
    curriculum: true,
    scheduling: true,
    finance: false,
    parentPortal: true,
    studentPortal: false,
    reporting: true,
    analytics: false,
  },
  PREMIUM: {
    maxSchools: 5,
    maxUsersPerSchool: 200,
    maxStudentsPerSchool: 2000,
    enrollment: true,
    attendance: true,
    grades: true,
    curriculum: true,
    scheduling: true,
    finance: true,
    parentPortal: true,
    studentPortal: true,
    reporting: true,
    analytics: true,
  },
  ADVANCED: {
    maxSchools: 100,
    maxUsersPerSchool: 1000,
    maxStudentsPerSchool: 10000,
    enrollment: true,
    attendance: true,
    grades: true,
    curriculum: true,
    scheduling: true,
    finance: true,
    parentPortal: true,
    studentPortal: true,
    reporting: true,
    analytics: true,
  },
};

exports.handler = async (event) => {
  console.log('TenantProvisioned event received:', JSON.stringify(event, null, 2));
  
  try {
    const { tenantId, tenantName, tier, email, subdomain, cognitoUserPoolId } = event.detail;
    const now = new Date().toISOString();
    
    // Validate required fields
    if (!tenantId || !tier) {
      throw new Error('Missing required fields: tenantId and tier are required');
    }
    
    // Determine table based on tier
    const tierUpper = tier.toUpperCase();
    const tableName = process.env[\`IDENTITY_TABLE_\${tierUpper}\`] || 'edforge-identity-basic';
    
    // Get features for this tier
    const features = DEFAULT_FEATURES[tierUpper] || DEFAULT_FEATURES.BASIC;
    
    // Build the tenant metadata item
    const item = {
      tenantId: { S: tenantId },
      entityKey: { S: 'METADATA' },
      entityType: { S: 'TENANT' },
      name: { S: tenantName || subdomain || tenantId },
      subdomain: { S: (subdomain || tenantName || tenantId).toLowerCase() },
      tier: { S: tierUpper },
      status: { S: 'active' },
      contactEmail: { S: email || '' },
      features: { S: JSON.stringify(features) },
      gsi1pk: { S: \`SUBDOMAIN#\${(subdomain || tenantName || tenantId).toLowerCase()}\` },
      gsi1sk: { S: 'TENANT' },
      schoolCount: { N: '0' },
      userCount: { N: '0' },
      studentCount: { N: '0' },
      createdAt: { S: now },
      updatedAt: { S: now },
      createdBy: { S: 'SYSTEM' },
      updatedBy: { S: 'SYSTEM' },
      version: { N: '1' },
    };
    
    // Add Cognito User Pool ID if provided
    if (cognitoUserPoolId) {
      item.cognitoUserPoolId = { S: cognitoUserPoolId };
    }

    // Use conditional write to ensure idempotency
    await dynamodb.send(new PutItemCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(tenantId) OR attribute_not_exists(entityKey)',
    }));
    
    console.log(\`✅ Tenant metadata seeded successfully to \${tableName} for tenant: \${tenantId}\`);
    
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Tenant metadata seeded successfully',
        tenantId,
        tableName,
      }),
    };
  } catch (err) {
    // Handle conditional check failure (tenant already exists)
    if (err.name === 'ConditionalCheckFailedException') {
      console.log(\`ℹ️ Tenant metadata already exists, skipping seed for tenant: \${event.detail?.tenantId}\`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Tenant metadata already exists, skipped',
          tenantId: event.detail?.tenantId,
        }),
      };
    }
    
    // Log and rethrow other errors
    console.error('❌ Error seeding tenant metadata:', err);
    throw err;
  }
};
`;
  }
}
