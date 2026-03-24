import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import { type Construct } from 'constructs';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { addTemplateTag } from '../utilities/helper-functions';
import { CoreAppPlaneNag } from '../cdknag/core-app-plane-nag';
import * as sbt from '@cdklabs/sbt-aws';

interface CoreAppPlaneStackProps extends cdk.StackProps {
  eventManager: sbt.IEventManager
  eventBusName: string // SBT Event Bus Name for microservices
  regApiGatewayUrl: string
  auth: sbt.CognitoAuth // Add auth information
  clientAppUrl: string // cient application URL for email templates
  accessLogsBucket: cdk.aws_s3.Bucket
  tenantMappingTable: Table
}

export class CoreAppPlaneStack extends cdk.Stack {

  constructor (scope: Construct, id: string, props: CoreAppPlaneStackProps) {
    super(scope, id, props);
    addTemplateTag(this, 'CoreAppPlaneStack');



    const provisioningScriptJobProps : sbt.TenantLifecycleScriptJobProps = {
      permissions: new PolicyDocument({
        statements: [
          new PolicyStatement({
            actions: [
              '*'
            ],
            resources: ['*'],
            effect: Effect.ALLOW,
          }),
        ],
      }),
      script: fs.readFileSync('./lib/provision-scripts/provision-tenant.sh', 'utf8'),
      environmentStringVariablesFromIncomingEvent: ['tenantId', 'tier', 'tenantName', 'email', 'country', 'useFederation', 'useEc2', 'useRProxy'],
      environmentJSONVariablesFromIncomingEvent: ['prices'],
      environmentVariablesToOutgoingEvent: {
        tenantData:[
          'tenantId', 
          'tenantS3Bucket',
          'tenantConfig',
          'prices', // added so we don't lose it for targets beyond provisioning (ex. billing)
          'tenantName', // added so we don't lose it for targets beyond provisioning (ex. billing)
          'email', // added so we don't lose it for targets beyond provisioning (ex. billing)
          'tier', // required for TenantSeeder to determine DynamoDB table
          'country', // required for TenantSeeder to seed country-specific workspace settings
        ],
        tenantRegistrationData: ['registrationStatus'],
      },
      scriptEnvironmentVariables: {
        // CDK_PARAM_SYSTEM_ADMIN_EMAIL removed - not used in provision-tenant.sh
        EVENT_BUS_NAME: props.eventBusName, // SBT Event Bus Name for microservices
      },
      eventManager: props.eventManager
    };

    const deprovisioningScriptJobProps: sbt.TenantLifecycleScriptJobProps = {
      permissions: new PolicyDocument({
        statements: [
          new PolicyStatement({
            actions: [
              '*'
            ],
            resources: ['*'],
            effect: Effect.ALLOW,
          }),
        ],
      }),
      script: fs.readFileSync('./lib/provision-scripts/deprovision-tenant.sh', 'utf8'),
      environmentStringVariablesFromIncomingEvent: ['tenantId', 'tier'],
      environmentVariablesToOutgoingEvent: {
        tenantRegistrationData:['registrationStatus']
      },

      scriptEnvironmentVariables: {
        TENANT_STACK_MAPPING_TABLE: props.tenantMappingTable.tableName,
        // CDK_PARAM_SYSTEM_ADMIN_EMAIL removed - not used in deprovision-tenant.sh
      },
      eventManager: props.eventManager
    };

    const provisioningScriptJob: sbt.ProvisioningScriptJob = new sbt.ProvisioningScriptJob(
      this,
      'provisioningScriptJob', 
      provisioningScriptJobProps
    );

    const deprovisioningScriptJob: sbt.DeprovisioningScriptJob = new sbt.DeprovisioningScriptJob(
      this,
      'deprovisioningScriptJob', 
      deprovisioningScriptJobProps
    );

    new sbt.CoreApplicationPlane(this, 'coreappplane-sbt', {
      eventManager: props.eventManager,
      scriptJobs: [provisioningScriptJob, deprovisioningScriptJob]
    });

    // REMOVED: Legacy Application client infrastructure
    // The legacy Application client (client/Application/) has been fully replaced by
    // the EdForge MFE application which will be deployed to AWS S3 + CloudFront.
    // 
    // Previous code created:
    // - StaticSiteDistro (S3 bucket + CloudFront distribution)
    // - CodePipeline that built and deployed the React Application client
    // 
    // Current deployment model:
    // 1. MFE app deployed to S3 + CloudFront (edforge.app)
    // 2. Email templates use clientAppUrl URL for tenant onboarding
    // 3. All tenant onboarding flows use the EdForge MFE application

    // Note: clientAppUrl is exported by shared-infra-stack (source of truth)
    // We don't export it here to avoid export name conflicts
    // This output is for local reference only
    new cdk.CfnOutput(this, 'clientAppUrl', {
      value: props.clientAppUrl,
      description: 'clientAppUrl application URL for tenant onboarding emails (local reference only, exported by shared-infra-stack)'
      // No exportName - shared-infra-stack is the source of truth
    });

    // CDK Nag check (controlled by environment variable)
    if (process.env.CDK_NAG_ENABLED === 'true') {
      new CoreAppPlaneNag(this, 'CoreAppPlaneNag');
    }
  }
}
