import * as cdk from 'aws-cdk-lib';
import * as fs from 'fs';
import { type Construct } from 'constructs';
import { Table, AttributeType } from 'aws-cdk-lib/aws-dynamodb';
import { Effect, PolicyDocument, PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatch_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as snsSubs from 'aws-cdk-lib/aws-sns-subscriptions';
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
  /**
   * Email subscribed to the provisioning-failure alert topic. Phase 4
   * (Sprint I-2) wires this up in CDK so the topic isn't left as a
   * dangling no-subscriber target that silently drops alarm notifications.
   */
  operatorAlertEmail: string
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
      environmentStringVariablesFromIncomingEvent: ['tenantId', 'tier', 'tenantName', 'email', 'country', 'archetype', 'tenantTag', 'useFederation', 'useEc2', 'useRProxy'],
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
          'archetype', // required for TenantSeeder to seed archetype-first workspace settings (PABSON/GENERIC)
          'tenantTag', // required for TenantSeeder to write tenantTag to METADATA (production / internal-dev / internal-dev-rehearsal)
        ],
        tenantRegistrationData: ['registrationStatus'],
      },
      scriptEnvironmentVariables: {
        // CDK_PARAM_SYSTEM_ADMIN_EMAIL removed - not used in provision-tenant.sh
        EVENT_BUS_NAME: props.eventBusName, // SBT Event Bus Name for microservices
      },
      eventManager: props.eventManager,
      // SBT's ScriptJob spreads projectProps last into the CodeBuild Project;
      // without an explicit log group CodeBuild writes to /aws/codebuild/<name>
      // with no retention.
      projectProps: {
        logging: {
          cloudWatch: {
            logGroup: new logs.LogGroup(this, 'ProvisioningBuildLogs', {
              retention: logs.RetentionDays.ONE_MONTH,
              removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
          },
        },
      },
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
        EVENT_BUS_NAME: props.eventBusName, // Match provision script's env vars
      },
      eventManager: props.eventManager,
      projectProps: {
        logging: {
          cloudWatch: {
            logGroup: new logs.LogGroup(this, 'DeprovisioningBuildLogs', {
              retention: logs.RetentionDays.ONE_MONTH,
              removalPolicy: cdk.RemovalPolicy.DESTROY,
            }),
          },
        },
      },
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

    // =========================================================
    // CloudWatch Alarm for CodeBuild Provisioning Failures
    // ISSUE-008 safety net: SBT's Step Functions Catch block masks
    // CodeBuild failures as success. This alarm fires on the raw
    // CodeBuild FailedBuilds metric to ensure operators are notified.
    // =========================================================
    const provisioningAlertTopic = new sns.Topic(this, 'ProvisioningAlertTopic', {
      topicName: 'edforge-provisioning-alerts',
      displayName: 'EdForge Provisioning Failure Alerts',
    });

    // Phase 4 (Sprint I-2) — wire email subscription in CDK. Previously the
    // topic was created but had no subscriber, meaning ISSUE-008 alarms
    // fired into the void. Same address as the operator-alerts topic in
    // analytics-stack; filtering by topic name differentiates
    // "tenant onboarding broke" from "live tenant issue" in the inbox.
    provisioningAlertTopic.addSubscription(
      new snsSubs.EmailSubscription(props.operatorAlertEmail),
    );

    // Enforce SSL for SNS publishers (AwsSolutions-SNS3 compliance)
    provisioningAlertTopic.addToResourcePolicy(new PolicyStatement({
      sid: 'EnforceSSL',
      effect: Effect.DENY,
      principals: [new cdk.aws_iam.AnyPrincipal()],
      actions: ['sns:Publish'],
      resources: [provisioningAlertTopic.topicArn],
      conditions: {
        Bool: {
          'aws:SecureTransport': 'false',
        },
      },
    }));

    const provisioningFailedAlarm = new cloudwatch.Alarm(this, 'ProvisioningFailedAlarm', {
      alarmName: 'edforge-provisioning-codebuild-failures',
      alarmDescription: 'Fires when a provisioning CodeBuild job fails (ISSUE-008: SBT masks these as success)',
      metric: provisioningScriptJob.codebuildProject.metricFailedBuilds({
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    provisioningFailedAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(provisioningAlertTopic));

    const deprovisioningFailedAlarm = new cloudwatch.Alarm(this, 'DeprovisioningFailedAlarm', {
      alarmName: 'edforge-deprovisioning-codebuild-failures',
      alarmDescription: 'Fires when a deprovisioning CodeBuild job fails',
      metric: deprovisioningScriptJob.codebuildProject.metricFailedBuilds({
        period: cdk.Duration.minutes(1),
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    deprovisioningFailedAlarm.addAlarmAction(new cloudwatch_actions.SnsAction(provisioningAlertTopic));

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
