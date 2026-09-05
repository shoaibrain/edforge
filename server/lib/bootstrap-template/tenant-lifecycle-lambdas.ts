/**
 * Cost-redesign C7.1/C7.2 — the tenant lifecycle on two functions instead of
 * SBT's CodeBuild script jobs (sprint-7-analysis.md, D7.1–D7.6).
 *
 * The functions listen on the SBT bus for the request events and answer with
 * the script job's exact success/failure envelopes, so SBT's registration
 * service and the tenant seeder keep working unchanged. Source and detail
 * types come from the `IEventManager` instance, never from literals.
 */
import * as cdk from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as path from 'path';
import { Construct } from 'constructs';
import type * as sbt from '@cdklabs/sbt-aws';

/** SNS topic the CodeBuild alarm used and the functions now publish refusals and failures to (core-appplane owns it). */
export const PROVISIONING_ALERT_TOPIC_NAME = 'edforge-provisioning-alerts';
/** Per-tenant alert topics: `${prefix}${tenantId}` (provision-tenant.sh, migrate-tenant-alert-topics.ts). */
export const TENANT_ALERT_TOPIC_PREFIX = 'edforge-alerts-tenant-';
export const TENANT_PROVISIONER_FUNCTION_NAME = 'edforge-tenant-provisioner';
export const TENANT_DEPROVISIONER_FUNCTION_NAME = 'edforge-tenant-deprovisioner';

export interface TenantLifecycleLambdasProps {
  readonly eventManager: sbt.IEventManager;
  /** The stack whose TenantUserpoolId / UserPoolClientId outputs the functions read at runtime (it depends on this stack, so it cannot be imported). */
  readonly tenantStackName: string;
  /** API-B base URL, carried in `tenantConfig.apiGatewayUrl` as the script carried API-A's. */
  readonly tenantApiUrl: string;
  readonly tableNames: { readonly identity: string; readonly academics: string; readonly finance: string };
}

export class TenantLifecycleLambdas extends Construct {
  public readonly provisioner: lambda.Function;
  public readonly deprovisioner: lambda.Function;

  constructor(scope: Construct, id: string, props: TenantLifecycleLambdasProps) {
    super(scope, id);
    const stack = cdk.Stack.of(this);
    const em = props.eventManager;
    const bus = events.EventBus.fromEventBusName(this, 'SbtBus', em.busName);
    const provisioningAlertTopicArn = stack.formatArn({ service: 'sns', resource: PROVISIONING_ALERT_TOPIC_NAME });
    const tenantAlertTopicArns = stack.formatArn({ service: 'sns', resource: `${TENANT_ALERT_TOPIC_PREFIX}*` });
    const userPools = stack.formatArn({ service: 'cognito-idp', resource: 'userpool', resourceName: '*', arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME });
    const tenantStack = stack.formatArn({ service: 'cloudformation', resource: 'stack', resourceName: `${props.tenantStackName}/*`, arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME });
    const tableArn = (name: string) => stack.formatArn({ service: 'dynamodb', resource: 'table', resourceName: name, arnFormat: cdk.ArnFormat.SLASH_RESOURCE_NAME });

    const commonEnvironment = {
      EVENT_BUS_NAME: em.busName,
      EVENT_SOURCE: em.applicationPlaneEventSource,
      TENANT_STACK_NAME: props.tenantStackName,
      PROVISIONING_ALERT_TOPIC_ARN: provisioningAlertTopicArn,
      TENANT_ALERT_TOPIC_PREFIX,
    };

    this.provisioner = new lambdaNodejs.NodejsFunction(this, 'Provisioner', {
      functionName: TENANT_PROVISIONER_FUNCTION_NAME,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambda/tenant-lifecycle/provisioner.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(60),
      memorySize: 256,
      logRetention: logs.RetentionDays.ONE_MONTH,
      description: 'Cost-redesign C7.1 — provisions a BASIC tenant on sbt_aws_onboardingRequest (Cognito user, group, alert topic) and emits sbt_aws_provisionSuccess.',
      environment: {
        ...commonEnvironment,
        SUCCESS_DETAIL_TYPE: em.events.provisionSuccess.detailType,
        FAILURE_DETAIL_TYPE: em.events.provisionFailure.detailType,
        TENANT_API_URL: props.tenantApiUrl,
      },
    });

    this.deprovisioner = new lambdaNodejs.NodejsFunction(this, 'Deprovisioner', {
      functionName: TENANT_DEPROVISIONER_FUNCTION_NAME,
      runtime: lambda.Runtime.NODEJS_22_X,
      entry: path.join(__dirname, 'lambda/tenant-lifecycle/deprovisioner.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 512,
      logRetention: logs.RetentionDays.ONE_MONTH,
      description: 'Cost-redesign C7.2 — deprovisions a BASIC tenant on sbt_aws_offboardingRequest (default-deny for production) and emits sbt_aws_deprovisionSuccess.',
      environment: {
        ...commonEnvironment,
        SUCCESS_DETAIL_TYPE: em.events.deprovisionSuccess.detailType,
        FAILURE_DETAIL_TYPE: em.events.deprovisionFailure.detailType,
        IDENTITY_TABLE_NAME: props.tableNames.identity,
        ACADEMICS_TABLE_NAME: props.tableNames.academics,
        FINANCE_TABLE_NAME: props.tableNames.finance,
      },
    });

    for (const [fn, request, ruleName] of [
      [this.provisioner, em.events.onboardingRequest, TENANT_PROVISIONER_FUNCTION_NAME],
      [this.deprovisioner, em.events.offboardingRequest, TENANT_DEPROVISIONER_FUNCTION_NAME],
    ] as const) {
      new events.Rule(this, `${fn.node.id}Rule`, {
        ruleName,
        description: `${request.detailType} → ${fn.node.id}`,
        eventBus: bus,
        eventPattern: { source: [request.source], detailType: [request.detailType] },
        targets: [new targets.LambdaFunction(fn, { retryAttempts: 2, maxEventAge: cdk.Duration.minutes(15) })],
      });
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['events:PutEvents'], resources: [bus.eventBusArn] }));
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['cloudformation:DescribeStacks'], resources: [tenantStack] }));
      fn.addToRolePolicy(new iam.PolicyStatement({ actions: ['sns:Publish'], resources: [provisioningAlertTopicArn] }));
    }

    this.provisioner.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminCreateUser', 'cognito-idp:CreateGroup', 'cognito-idp:AdminAddUserToGroup'],
        resources: [userPools],
      }),
    );
    this.provisioner.addToRolePolicy(new iam.PolicyStatement({ actions: ['sns:CreateTopic', 'sns:Subscribe'], resources: [tenantAlertTopicArns] }));

    this.deprovisioner.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:ListUsersInGroup', 'cognito-idp:AdminDeleteUser', 'cognito-idp:DeleteGroup'],
        resources: [userPools],
      }),
    );
    this.deprovisioner.addToRolePolicy(new iam.PolicyStatement({ actions: ['dynamodb:GetItem'], resources: [tableArn(props.tableNames.identity)] }));
    this.deprovisioner.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:Query', 'dynamodb:BatchWriteItem'],
        resources: [props.tableNames.identity, props.tableNames.academics, props.tableNames.finance].map(tableArn),
      }),
    );
    this.deprovisioner.addToRolePolicy(new iam.PolicyStatement({ actions: ['sns:DeleteTopic'], resources: [tenantAlertTopicArns] }));
  }
}
