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
import { ARCHETYPE_DEFAULTS, COUNTRY_DEFAULTS } from '@aibrains/shared-types';

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
      runtime: lambda.Runtime.NODEJS_22_X,
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
   *
   * COUNTRY_DEFAULTS + ARCHETYPE_DEFAULTS are injected at CDK synth time
   * from the @aibrains/shared-types package — single source of
   * truth shared with the AdminWeb tenant-create form and the identity
   * service workspace-settings entity. To add a country/archetype, edit
   * the package.
   */
  private getLambdaCode(): string {
    // Stringified at synth time so the Lambda's inline code carries the
    // exact same maps the rest of the platform uses. JSON.stringify with
    // a 2-space indent for readability in CloudWatch logs and `aws lambda
    // get-function` output.
    const countryDefaultsLiteral = JSON.stringify(COUNTRY_DEFAULTS, null, 2);
    const archetypeDefaultsLiteral = JSON.stringify(ARCHETYPE_DEFAULTS, null, 2);

    return `
const { DynamoDBClient, PutItemCommand } = require('@aws-sdk/client-dynamodb');

const dynamodb = new DynamoDBClient({});

/**
 * Country-specific regional defaults — generated at CDK synth time from
 * @aibrains/shared-types. DO NOT EDIT inline here; edit the
 * package source so AdminWeb + identity entity stay in sync.
 */
const COUNTRY_DEFAULTS = ${countryDefaultsLiteral};

/**
 * Archetype-specific regional defaults — generated at CDK synth time from
 * @aibrains/shared-types. Archetype takes precedence over country.
 */
const ARCHETYPE_DEFAULTS = ${archetypeDefaultsLiteral};

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
    let tenantId, tenantName, tier, email, subdomain, cognitoUserPoolId, country, archetype;

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
      archetype = (tenantData.archetype || '').toUpperCase();

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
      archetype = (event.detail.archetype || '').toUpperCase();
    } else {
      throw new Error('Unknown event format - missing tenant data in event.detail');
    }

    // V1 accepts only PABSON and GENERIC archetypes. Unknown → default GENERIC.
    if (archetype && archetype !== 'PABSON' && archetype !== 'GENERIC') {
      console.warn(\`Unknown archetype '\${archetype}' — falling back to GENERIC. V1 only supports PABSON|GENERIC.\`);
      archetype = 'GENERIC';
    }
    if (!archetype) archetype = 'GENERIC';

    const now = new Date().toISOString();

    // Validate required fields
    if (!tenantId || !tier) {
      throw new Error('Missing required fields: tenantId and tier are required');
    }
    
    // Determine table based on tier
    const tierUpper = tier.toUpperCase();

    // V1_DEFERRED: Only BASIC tier is supported in V1 MVP.
    // Advanced/Premium table routing is preserved below but has a known bug:
    // The IDENTITY_TABLE_ADVANCED env var points to 'edforge-identity-advanced'
    // but CDK creates per-tenant tables like 'edforge-identity-{tenantName}'.
    // To re-enable: Fix table name resolution to be dynamic per tenant, not hardcoded per tier.
    if (tierUpper !== 'BASIC') {
      console.warn(\`V1_DEFERRED: Only BASIC tier supported. Received: \${tierUpper}. Skipping seed.\`);
      console.warn('To enable Advanced/Premium, fix table name resolution in this Lambda and CDK.');
      return { statusCode: 200, body: JSON.stringify({ message: 'V1: non-BASIC tier skipped', tier: tierUpper }) };
    }

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

    // Persist archetype on metadata. Immutable after write (enforced by
    // field-governance classification in the identity service layer).
    item.archetype = { S: archetype };

    // Use conditional write to ensure idempotency
    await dynamodb.send(new PutItemCommand({
      TableName: tableName,
      Item: item,
      ConditionExpression: 'attribute_not_exists(tenantId) OR attribute_not_exists(entityKey)',
    }));
    
    console.log(\`✅ Tenant metadata seeded successfully to \${tableName} for tenant: \${tenantId}\`);

    // Seed workspace settings with archetype-first, country-fallback defaults.
    // Precedence: US_DEFAULTS ← country overrides ← archetype overrides.
    const countryUpper = (country || '').toUpperCase();
    const countryOverrides = COUNTRY_DEFAULTS[countryUpper] || {};
    const archetypeOverrides = ARCHETYPE_DEFAULTS[archetype] || {};
    const regional = { ...US_DEFAULTS, ...countryOverrides, ...archetypeOverrides };
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
      console.log(\`✅ Workspace settings seeded for tenant: \${tenantId} (archetype: \${archetype}, country: \${countryUpper || 'none'})\`);
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
        archetype,
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
