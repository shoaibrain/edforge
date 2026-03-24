/**
 * Tenant Seeder Lambda - Event-Driven Tenant Synchronization
 *
 * Listens for SBT's sbt_aws_provisionSuccess events from the SBT EventBridge bus
 * and seeds tenant metadata to the identity service DynamoDB table.
 *
 * This ensures tenant data is available in the identity service
 * immediately after provisioning, enabling proper tenant validation.
 *
 * Event Flow:
 * 1. ControlPlane API triggers provisioning
 * 2. SBT's ProvisioningScriptJob runs provision-tenant.sh
 * 3. On success, ScriptJob emits sbt_aws_provisionSuccess event
 * 4. This Lambda is triggered by that event
 * 5. Tenant metadata is seeded to DynamoDB
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
      description: 'Seeds tenant metadata to identity service on SBT provisionSuccess events',
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

    // EventBridge rule to trigger on SBT provisioning success events
    // SBT's ProvisioningScriptJob emits this event automatically when provision-tenant.sh succeeds
    new events.Rule(this, 'ProvisioningSuccessRule', {
      ruleName: 'edforge-provisioning-success-seeder',
      description: 'Triggers tenant seeder Lambda when SBT provisioning succeeds',
      eventBus,
      eventPattern: {
        source: ['sbt.application.plane'],
        detailType: ['sbt_aws_provisionSuccess'],
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
/**
 * Country-specific regional defaults for workspace settings.
 * Mirrors COUNTRY_DEFAULTS in workspace-settings.entity.ts.
 */
const COUNTRY_DEFAULTS = {
  NPL: {
    defaultCurrency: 'NPR',
    defaultTimezone: 'Asia/Kathmandu',
    defaultCalendarSystem: 'bikram_sambat',
    enableDualDateDisplay: true,
    defaultNumberFormat: 'south_asian',
    defaultLocale: 'ne-NP',
    defaultDateFormat: 'DD/MM/YYYY',
    defaultTimeFormat: '24h',
    defaultWeekStartsOn: 'sunday',
  },
  USA: {
    defaultCurrency: 'USD',
    defaultTimezone: 'America/New_York',
    defaultCalendarSystem: 'gregorian',
    enableDualDateDisplay: false,
    defaultNumberFormat: 'international',
    defaultLocale: 'en-US',
    defaultDateFormat: 'MM/DD/YYYY',
    defaultTimeFormat: '12h',
    defaultWeekStartsOn: 'sunday',
  },
  IND: {
    defaultCurrency: 'INR',
    defaultTimezone: 'Asia/Kolkata',
    defaultCalendarSystem: 'gregorian',
    enableDualDateDisplay: false,
    defaultNumberFormat: 'south_asian',
    defaultLocale: 'en-IN',
    defaultDateFormat: 'DD/MM/YYYY',
    defaultTimeFormat: '12h',
    defaultWeekStartsOn: 'monday',
  },
};

const US_DEFAULTS = COUNTRY_DEFAULTS.USA;

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
  console.log('Provisioning success event received:', JSON.stringify(event, null, 2));

  try {
    // Parse tenant data from SBT event format
    // SBT's sbt_aws_provisionSuccess event has data in jobOutput.tenantData
    let tenantId, tenantName, tier, email, subdomain, cognitoUserPoolId, country;

    if (event.detail?.jobOutput?.tenantData) {
      // SBT native format - parse from jobOutput
      console.log('Parsing SBT native event format');
      const tenantData = event.detail.jobOutput.tenantData;

      // Priority: tenantData.tenantId > detail.tenantId > detail.tenantRegistrationId
      // tenantData.tenantId is the correct tenant ID exported from provision-tenant.sh
      // detail.tenantRegistrationId is SBT's internal job ID (different UUID)
      tenantId = tenantData.tenantId || event.detail.tenantId || event.detail.tenantRegistrationId;
      tenantName = tenantData.tenantName;
      tier = tenantData.tier || event.detail.tier || 'BASIC';
      email = tenantData.email;
      subdomain = tenantName;
      country = tenantData.country || '';

      // Parse tenantConfig JSON to get Cognito User Pool ID
      if (tenantData.tenantConfig) {
        try {
          const config = JSON.parse(tenantData.tenantConfig);
          cognitoUserPoolId = config.userPoolId;
        } catch (parseErr) {
          console.log('Could not parse tenantConfig:', parseErr.message);
        }
      }
    } else if (event.detail?.tenantId) {
      // Legacy EdForge format (backward compatibility)
      console.log('Parsing legacy EdForge event format');
      tenantId = event.detail.tenantId;
      tenantName = event.detail.tenantName;
      tier = event.detail.tier;
      email = event.detail.email;
      subdomain = event.detail.subdomain;
      cognitoUserPoolId = event.detail.cognitoUserPoolId;
      country = event.detail.country || '';
    } else {
      throw new Error('Unknown event format - missing tenant data in event.detail');
    }

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

    // Persist country on metadata for lazy-creation fallback in identity service
    if (country) {
      item.country = { S: country.toUpperCase() };
    }

    // Use conditional write to ensure idempotency
    await dynamodb.send(new PutItemCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(tenantId) OR attribute_not_exists(entityKey)',
    }));
    
    console.log(\`✅ Tenant metadata seeded successfully to \${tableName} for tenant: \${tenantId}\`);

    // Seed workspace settings with country-specific defaults
    const countryUpper = (country || '').toUpperCase();
    const countryOverrides = COUNTRY_DEFAULTS[countryUpper] || {};
    const regional = { ...US_DEFAULTS, ...countryOverrides };
    const orgName = tenantName || subdomain || tenantId;

    const settingsItem = {
      tenantId: { S: tenantId },
      entityKey: { S: 'SETTINGS#WORKSPACE' },
      entityType: { S: 'WORKSPACE_SETTINGS' },
      regional: { S: JSON.stringify(regional) },
      branding: { S: JSON.stringify({ organizationName: orgName }) },
      policies: { S: JSON.stringify({ defaultAttendancePolicy: 'daily' }) },
      isLocked: { BOOL: false },
      createdAt: { S: now },
      updatedAt: { S: now },
      createdBy: { S: 'SYSTEM' },
      updatedBy: { S: 'SYSTEM' },
      version: { N: '1' },
    };

    try {
      await dynamodb.send(new PutItemCommand({
        TableName: tableName,
        Item: settingsItem,
        ConditionExpression: 'attribute_not_exists(tenantId) OR attribute_not_exists(entityKey)',
      }));
      console.log(\`✅ Workspace settings seeded for tenant: \${tenantId} (country: \${countryUpper || 'none'})\`);
    } catch (settingsErr) {
      if (settingsErr.name === 'ConditionalCheckFailedException') {
        console.log(\`ℹ️ Workspace settings already exist for tenant: \${tenantId}, skipping\`);
      } else {
        console.error('⚠️ Non-critical: failed to seed workspace settings:', settingsErr.message);
      }
    }

    return {
      statusCode: 200,
      body: JSON.stringify({
        message: 'Tenant metadata and workspace settings seeded successfully',
        tenantId,
        tableName,
        country: countryUpper || 'none',
      }),
    };
  } catch (err) {
    // Handle conditional check failure (tenant already exists)
    if (err.name === 'ConditionalCheckFailedException') {
      const existingTenantId = event.detail?.tenantRegistrationId || event.detail?.tenantId;
      console.log(\`ℹ️ Tenant metadata already exists, skipping seed for tenant: \${existingTenantId}\`);
      return {
        statusCode: 200,
        body: JSON.stringify({
          message: 'Tenant metadata already exists, skipped',
          tenantId: existingTenantId,
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
