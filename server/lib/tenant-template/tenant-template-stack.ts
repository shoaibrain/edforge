import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sqs from "aws-cdk-lib/aws-sqs";
import { type Construct } from "constructs";
import { type Table } from "aws-cdk-lib/aws-dynamodb";
import { IdentityProvider } from "./identity-provider";
import { EcsCluster } from "./ecs-cluster";
import { EcsService } from "./services";
import { TenantTemplateNag } from "../cdknag/tenant-template-nag";
import { addTemplateTag } from "../utilities/helper-functions";
import { ContainerInfo } from "../interfaces/container-info";
import { HttpNamespace } from "aws-cdk-lib/aws-servicediscovery";
import { EcsDynamoDB } from "./ecs-dynamodb";
import { CognitoPostAuthTrigger } from "../auth-events/cognito-post-auth-trigger";
import * as path from "path";
import * as fs from "fs";
import * as crypto from "crypto";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";

interface TenantTemplateStackProps extends cdk.StackProps {
  stageName: string;
  tenantId: string;
  tenantName: string;
  tenantMappingTable: Table;
  commitId: string;
  waveNumber?: string;
  tier: string;
  advancedCluster: string;
  clientAppUrl: string; // EdForge application URL for email templates
  corsAllowedOrigins: string; // Comma-separated CORS origins (also used for Cognito callback URLs)
  eventBusName: string; // SBT Event Bus Name for microservice domain events
  useFederation: string;
  useEc2?: boolean;
  useRProxy?: boolean;
}

/**
 * TenantTemplateStack - EdForge Education Management System

 * ACTIVE SERVICES:
 * - User Service: Manages users, authentication, and authorization
 * - School Service: Manages schools, students, teachers, classes, academic years, etc.
 * 
 * The stack dynamically deploys services based on service-info.json configuration.
 * Only the services defined in that configuration file will be deployed.
 */
export class TenantTemplateStack extends cdk.Stack {
  // Removed: productServiceUri and orderServiceUri - not needed for EdForge
  cluster: ecs.ICluster;
  namespace: HttpNamespace;

  constructor(scope: Construct, id: string, props: TenantTemplateStackProps) {
    super(scope, id, props);
    const waveNumber = props.waveNumber || "1";
    addTemplateTag(this, "TenantTemplateStack");

    const identityProvider = new IdentityProvider(this, "IdentityProvider", {
      tenantId: props.tenantId,
      tier: props.tier,
      clientAppUrl: props.clientAppUrl, // EdForge URL for branded email templates
      corsAllowedOrigins: props.corsAllowedOrigins,
      useFederation: props.useFederation,
    });

    // C0a (2026-04-17, corrective) — Cognito PostAuthentication trigger.
    // Attached to THIS tier's tenant user pool so every successful login by
    // a TenantAdmin/Teacher/Parent/Student emits a `LoginSuccess` analytics
    // event. Previously mis-wired against the control-plane pool, which only
    // sees system-admin logins — so the adoption-report's teacherLoginCadence
    // metric stayed at 0% forever. Function name is suffixed with the tier
    // so BASIC and future Advanced pools each get a distinct Lambda/log-group.
    new CognitoPostAuthTrigger(this, "CognitoLoginEmitter", {
      userPool: identityProvider.tenantUserPool,
      eventBusName: props.eventBusName,
      functionNameSuffix: props.tier.toLowerCase(),
    });

    const vpc = ec2.Vpc.fromVpcAttributes(this, "Vpc", {
      vpcId: cdk.Fn.importValue("EcsVpcId"),
      availabilityZones: cdk.Fn.split(
        ",",
        cdk.Fn.importValue("AvailabilityZones")
      ),
      privateSubnetIds: cdk.Fn.split(
        ",",
        cdk.Fn.importValue("PrivateSubnetIds")
      ),
    });

    // SG for ALB to ECS & ECS services's communication
    const ecsSG = new ec2.SecurityGroup(this, "ecsSG", {
      vpc: vpc,
      allowAllOutbound: true,
    });

    // Configuration values with clear defaults
    const isEc2Tier: boolean = props.useEc2 ?? false;
    const isRProxy: boolean = props.useRProxy ?? true;

    // Clear condition variables for better readability
    const isAdvancedTier = props.tier.toLocaleLowerCase() === "advanced";
    const isAdvancedActive = props.advancedCluster === "ACTIVE";
    // V1_DEFERRED: shouldDeployServices is always true for BASIC tier.
    // For ADVANCED with INACTIVE cluster, services are skipped (cluster-only stack).
    // This pattern supports a two-phase Advanced deployment:
    //   Phase 1: Deploy cluster only (INACTIVE)
    //   Phase 2: Deploy services into existing cluster (ACTIVE)
    const shouldDeployServices = !isAdvancedTier || isAdvancedActive;

    // V1_DEFERRED: Advanced tier cluster sharing
    // When tier=ADVANCED and advancedCluster=ACTIVE, the stack references an existing
    // shared Advanced cluster instead of creating a new one. This enables cost-efficient
    // multi-tenant isolation for the Advanced tier.
    //
    // In V1 MVP, only BASIC tier is deployed (advancedCluster always INACTIVE),
    // so this branch is never executed. The EcsCluster construct (else branch)
    // creates the shared prod-basic cluster.
    //
    // To re-enable: Ensure the Advanced cluster exists before deploying Advanced tenants.
    // The cluster name pattern is: prod-advanced-{accountId}
    // ECS Cluster setup based on tier and status
    if (isAdvancedTier && isAdvancedActive) {
      // Reference existing Advanced cluster
      const clusterName = `${props.stageName}-advanced-${
        cdk.Stack.of(this).account
      }`;
      this.cluster = ecs.Cluster.fromClusterAttributes(this, "advanced", {
        clusterName: clusterName,
        vpc: vpc,
        securityGroups: [],
      });
    } else {
      // Create new cluster for Basic/Premium or inactive Advanced
      const ecsCluster = new EcsCluster(this, "EcsCluster", {
        vpc: vpc,
        stageName: props.stageName,
        tenantId: props.tenantId,
        tier: props.tier,
        isEc2Tier,
      });
      this.cluster = ecsCluster.cluster;
    }

    // Deploy services conditionally
    if (shouldDeployServices) {
      this.namespace = new HttpNamespace(this, "CloudMapNamespace", {
        name: `${props.tenantName}`,
      });

      const data = fs.readFileSync(
        path.resolve(__dirname, "../service-info.json"),
        "utf8"
      );
      // Generate a per-tenant internal API key for service-to-service webhook auth.
      // Deterministic per tenant name so redeploys don't rotate the key unexpectedly.
      const internalApiKey = crypto
        .createHash('sha256')
        .update(`edforge-internal-api-key:${props.tenantName}`)
        .digest('hex');

      const replacements: { [key: string]: string } = {
        "<NAMESPACE>": this.namespace.namespaceName,
        "<EVENT_BUS_NAME>": props.eventBusName, // SBT Event Bus Name for microservice domain events
        "<INTERNAL_API_KEY>": internalApiKey,
      };

      let updateData = data;
      for (const [placeholder, replacement] of Object.entries(replacements)) {
        const regex = new RegExp(placeholder, "g");
        updateData = updateData.replace(regex, replacement);
      }

      const serviceInfo = JSON.parse(updateData);
      const containerInfo: ContainerInfo[] = serviceInfo.Containers;

      // Deploy core services for EdForge (users, school) in parallel
      const coreServices: EcsService[] = [];

      containerInfo.forEach((info) => {
        // Create storage if needed for the service
        const storage = this.createStorageIfNeeded(info, props.tenantName);

        // Create IAM task role for the service
        const taskRole = this.createTaskRole(info, storage, identityProvider, props.tier);

        // Create ECS service
        const ecsService = new EcsService(this, `${info.name}-EcsServices`, {
          tenantId: props.tenantId,
          tenantName: props.tenantName,
          isEc2Tier,
          isRProxy,
          isTarget: !isRProxy,
          vpc: vpc,
          cluster: this.cluster,
          ecsSG: ecsSG,
          taskRole,
          namespace: this.namespace,
          info,
          identityDetails: identityProvider.identityDetails,
        });

        // Set up dependencies
        ecsService.service.node.addDependency(this.cluster);
        ecsService.service.node.addDependency(vpc);

        // Store core services for rproxy dependency
        coreServices.push(ecsService);
      });

      if (isRProxy) {
        this.deployRProxyService(
          serviceInfo,
          props,
          vpc,
          ecsSG,
          identityProvider,
          isEc2Tier,
          isRProxy,
          coreServices
        );
      }
    }

    // ====================================================================
    // Sprint A.4.3 — Result-Batch Lambda + EventBridge + DLQ + Alarm
    //
    // Triggered by `ExamStatusTransitioned` events from academics-service
    // where `detail.toStatus === 'closed'`. Generates ResultCard rows
    // for the closed exam. See:
    //   - server/lib/result-generation/lambda/result-batch/handler.ts
    //   - docs/pilot-greenlight/a4-phase-3-plan.md
    //
    // V1 note: SNS-action on the error alarm is deferred to V1.5 because
    // tenant-template-stack doesn't currently have access to the operator
    // alert topic (lives in analytics-stack). For V1 the alarm is
    // CloudWatch-visible but doesn't page; Phase 4 smoke validates the
    // happy path. Pass `operatorAlertTopic` via props in V1.5 to wire SNS.
    // ====================================================================
    const academicsTableArn = `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-academics-${props.tier.toLowerCase()}`;

    const resultBatchLambda = new lambdaNodejs.NodejsFunction(
      this,
      "ResultBatchLambda",
      {
        functionName: `edforge-result-batch-${props.tier.toLowerCase()}`,
        runtime: lambda.Runtime.NODEJS_20_X,
        entry: path.join(
          __dirname,
          "../result-generation/lambda/result-batch/handler.ts"
        ),
        handler: "handler",
        memorySize: 1024,
        timeout: cdk.Duration.minutes(5),
        logRetention: logs.RetentionDays.ONE_MONTH,
        environment: {
          ACADEMICS_TABLE_NAME: `edforge-academics-${props.tier.toLowerCase()}`,
        },
        description:
          "A.4.3 — Generates ResultCard rows on exam.closed. Consumes " +
          "ExamStatusTransitioned events (toStatus=closed) from " +
          "edforge.academics-service.",
        bundling: {
          minify: false,
          sourceMap: false,
        },
      }
    );

    // IAM — scoped to academics table only. No identity access; ResultCards
    // are pure-academics. Lambda needs:
    //   - GetItem on Exam, GradingPolicy (via Query on GSI1)
    //   - Query on GSI1/GSI2/GSI3 for ExamCourse, ExamScore, Enrollment, Policy
    //   - TransactWriteItems for chunked ResultCard writes (idempotent
    //     via attribute_not_exists)
    //   - UpdateItem on the Exam row for the P1c result-generation status
    //     writeback (resultGenerationStatus → generated/failed). UpdateItem is
    //     a DISTINCT action from TransactWriteItems/PutItem; without it the
    //     best-effort writeback silently AccessDenies and the status sticks at
    //     `pending` forever.
    resultBatchLambda.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          "dynamodb:GetItem",
          "dynamodb:Query",
          "dynamodb:TransactWriteItems",
          "dynamodb:PutItem", // PutItem is implicitly used by TransactWriteItems' Put op
          "dynamodb:UpdateItem", // P1c — exam result-generation status writeback
        ],
        resources: [
          academicsTableArn,
          `${academicsTableArn}/index/*`,
        ],
      })
    );

    // Per-Lambda DLQ — captures events that exhaust retries.
    // V1 design choice (see §8 #4 in a4-phase-3-plan.md): per-Lambda inline
    // DLQ vs shared event-dlq-stack. Inline is simpler and avoids touching
    // shared-infra-stack (R41 stays at 87.7%).
    const resultBatchDlq = new sqs.Queue(this, "ResultBatchDlq", {
      queueName: `edforge-result-batch-dlq-${props.tier.toLowerCase()}`,
      retentionPeriod: cdk.Duration.days(14),
    });

    // EventBridge rule — academics emits `ExamStatusTransitioned` (PascalCase
    // per current convention, not snake-dotted `exam.closed`). We filter on
    // detail.toStatus === 'closed' to scope to the lifecycle transition we care
    // about. B.2.2 migration to snake-dotted is V1.5 scope.
    new events.Rule(this, "ResultBatchExamClosedRule", {
      ruleName: `edforge-result-batch-exam-closed-${props.tier.toLowerCase()}`,
      description:
        "Routes ExamStatusTransitioned events with toStatus=closed → result-batch Lambda",
      eventBus: events.EventBus.fromEventBusName(
        this,
        "SbtEventBusForResultBatch",
        props.eventBusName
      ),
      eventPattern: {
        source: ["edforge.academics-service"],
        detailType: ["ExamStatusTransitioned"],
        detail: {
          toStatus: ["closed"],
        },
      },
      targets: [
        new eventsTargets.LambdaFunction(resultBatchLambda, {
          deadLetterQueue: resultBatchDlq,
          maxEventAge: cdk.Duration.minutes(60),
          retryAttempts: 2,
        }),
      ],
    });

    // CloudWatch alarm on Lambda errors. Catches code-level failures
    // (DDB exceptions, OOM, timeout). V1: visible in CW console; SNS
    // action wiring is V1.5 (see header note above).
    const errorMetric = resultBatchLambda.metricErrors({
      period: cdk.Duration.minutes(5),
      statistic: "Sum",
    });
    new cloudwatch.Alarm(this, "ResultBatchLambdaErrorsAlarm", {
      alarmName: `edforge-result-batch-lambda-errors-${props.tier.toLowerCase()}`,
      alarmDescription:
        "Result-batch Lambda errored. ResultCard generation halted for the affected exam.",
      metric: errorMetric,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // DLQ depth alarm — fires when an event has been DLQ'd (max retries
    // exhausted). Operator must inspect manually + redrive via SQS console.
    const dlqDepth = resultBatchDlq.metricApproximateNumberOfMessagesVisible({
      period: cdk.Duration.minutes(5),
      statistic: "Maximum",
    });
    new cloudwatch.Alarm(this, "ResultBatchDlqDepthAlarm", {
      alarmName: `edforge-result-batch-dlq-depth-${props.tier.toLowerCase()}`,
      alarmDescription:
        "Result-batch Lambda DLQ has unprocessed events. Inspect via SQS console + redrive.",
      metric: dlqDepth,
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator:
        cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
    });

    // CfnOutputs for post-deploy verification
    new cdk.CfnOutput(this, "ResultBatchLambdaArn", {
      value: resultBatchLambda.functionArn,
      description: "ARN of the result-batch Lambda (A.4.3)",
    });
    new cdk.CfnOutput(this, "ResultBatchDlqUrl", {
      value: resultBatchDlq.queueUrl,
      description: "DLQ URL for the result-batch Lambda",
    });

    new AwsCustomResource(this, "CreateTenantMapping", {
      installLatestAwsSdk: true,
      onCreate: {
        service: "DynamoDB",
        action: "putItem",
        physicalResourceId: PhysicalResourceId.of("CreateTenantMapping"),
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Item: {
            tenantId: { S: props.tenantId },
            stackName: { S: cdk.Stack.of(this).stackName },
            codeCommitId: { S: props.commitId },
            waveNumber: { S: waveNumber },
          },
        },
      },
      onUpdate: {
        service: "DynamoDB",
        action: "updateItem",
        physicalResourceId: PhysicalResourceId.of("CreateTenantMapping"),
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Key: {
            tenantId: { S: props.tenantId },
          },
          UpdateExpression: "set codeCommitId = :codeCommitId",
          ExpressionAttributeValues: {
            ":codeCommitId": { S: props.commitId },
          },
        },
      },
      onDelete: {
        service: "DynamoDB",
        action: "deleteItem",
        parameters: {
          TableName: props.tenantMappingTable.tableName,
          Key: {
            tenantId: { S: props.tenantId },
          },
        },
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({
        resources: [props.tenantMappingTable.tableArn],
      }),
    });

    new cdk.CfnOutput(this, "TenantUserpoolId", {
      value: identityProvider.tenantUserPool.userPoolId,
    });

    new cdk.CfnOutput(this, "UserPoolClientId", {
      value: identityProvider.tenantUserPoolClient.userPoolClientId,
    });

    // Construct Cognito OIDC Well-Known Endpoint URL for tenant authentication
    // Format: https://cognito-idp.{region}.amazonaws.com/{userPoolId}/.well-known/openid-configuration
    // This URL is used by OAuth2/OIDC clients (e.g., NextAuth.js) for automatic endpoint discovery
    // Benefits: Eliminates manual URL construction, reduces configuration errors, aligns with Control Plane pattern
    const wellKnownUrl = `https://cognito-idp.${this.region}.amazonaws.com/${identityProvider.tenantUserPool.userPoolId}/.well-known/openid-configuration`;
    
    new cdk.CfnOutput(this, "TenantWellKnownUrl", {
      value: wellKnownUrl,
      description: "Cognito OIDC Well-Known Endpoint URL for tenant authentication",
    });

    new cdk.CfnOutput(this, "S3SourceVersion", {
      value: props.commitId,
    });

    // CDK Nag check (controlled by environment variable)
    if (process.env.CDK_NAG_ENABLED === "true") {
      new TenantTemplateNag(this, "TenantInfraNag", {
        tenantId: props.tenantId,
        isEc2Tier,
        tier: props.tier,
        advancedCluster: props.advancedCluster,
        isRProxy,
      });
    }
  }

  /**
   * Create DynamoDB storage if the service requires it
   * 
   * Table Naming Convention:
   * - Base name from service-info.txt: TABLE_NAME = "school-table"
   * - Tier suffix added automatically: "-${tenantName}" (e.g., "basic", "premium")
   * - Final table name: "school-table-basic" or "school-table-premium"
   * 
   * Example:
   * - Input: TABLE_NAME="school-table", tenantName="basic"
   * - Output: "school-table-basic"
   * 
   * This ensures each tier gets its own table while maintaining clear naming.
   */
  private createStorageIfNeeded(
    info: ContainerInfo,
    tenantName: string
  ): EcsDynamoDB | undefined {
    if (Object.prototype.hasOwnProperty.call(info, "database") && info.database?.kind === "dynamodb") {
      // Build table name: Handle <TIER> placeholder
      let baseTableName = info.environment?.TABLE_NAME || "";
      
      // Check if placeholder exists (case-insensitive)
      if (/<TIER>/i.test(baseTableName)) {
         // Replace <TIER> with tenantName
         baseTableName = baseTableName.replace(/<TIER>/i, tenantName);
      } else {
         // Legacy behavior: Append -tenantName if placeholder missing
         baseTableName = `${baseTableName}-${tenantName}`;
      }

      // Sanitize table name: replace underscores with hyphens and lowercase
      const tableName = baseTableName.replace(/_/g, "-").toLowerCase();
      
      const storage = new EcsDynamoDB(this, `${info.name}Storage`, {
        name: info.name,
        partitionKey: "tenantId",
        sortKey: info.database.sortKey || "",
        tableName: tableName,
        tenantName: tenantName,
      });

      // CRITICAL: Update environment variable with actual table name
      // This ensures the service uses the correct tier-specific table
      // e.g., school service will use "school-table-basic" not "school-table"
      info.environment.TABLE_NAME = storage.table.tableName;
      return storage;
    }
    return undefined;
  }

  /**
   * Create IAM task role for ECS service
   */
  private createTaskRole(
    info: ContainerInfo,
    storage: EcsDynamoDB | undefined,
    identityProvider: IdentityProvider,
    tier: string
  ): iam.Role {
    let policy = JSON.stringify(info.policy);

    if (storage) {
      // Create main ECS task role first
      const taskRole = new iam.Role(this, `${info.name}-ecsTaskRole`, {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        managedPolicies: [
          iam.ManagedPolicy.fromAwsManagedPolicyName(
            "service-role/AmazonEC2ContainerServiceforEC2Role"
          ),
        ],
      });

      // Create ABAC role with proper Trust Policy from the start
      const abacRole = new iam.Role(this, `${info.name}-ABACRole`, {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        inlinePolicies: {
          DynamoDBTenantAccess: storage.policyDocument
        }
      });

      // Add Task Role to ABAC Role Trust Policy with conditions
      abacRole.assumeRolePolicy?.addStatements(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          principals: [new iam.ArnPrincipal(taskRole.roleArn)],
          actions: ["sts:AssumeRole", "sts:TagSession"],
          conditions: {
            StringLike: {
              "aws:RequestTag/tenant": "*"
            }
          }
        })
      );

      // Add ABAC role assume permission to task role
      taskRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["sts:AssumeRole", "sts:TagSession"],
          resources: [abacRole.roleArn],
          conditions: {
            StringLike: {
              "aws:RequestTag/tenant": "*"
            }
          }
        })
      );

      // Add limited DynamoDB permissions for bootstrap operations (login, tenant lookup)
      // These operations occur BEFORE a valid JWT exists, so TVM cannot be used.
      // The task role gets direct access for these specific pre-auth scenarios.
      taskRole.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "dynamodb:GetItem",
            "dynamodb:PutItem",
            "dynamodb:UpdateItem",
            "dynamodb:Query",
          ],
          resources: [
            storage.table.tableArn,
            `${storage.table.tableArn}/index/*`,
          ],
        })
      );

      // Academics reads the tenant METADATA row from the IDENTITY table
      // cross-service (TenantMetadataReaderService → archetype resolution that
      // drives board-exam / curriculum-default / exam-pattern seeding). The
      // storage grant above only covers the academics table, so without this
      // every resolveTenantArchetype gets AccessDenied and silently falls back
      // to the no-archetype shape (the 2026-06-04 GB2 degraded-deploy). Minimal:
      // GetItem on the identity table only (the reader does a single GetItem on
      // the METADATA item — no Query/index/write).
      if (info.name === 'academics') {
        taskRole.addToPolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ["dynamodb:GetItem"],
            resources: [
              `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-${tier.toLowerCase()}`,
            ],
          })
        );
      }

      // Add Cognito permissions for Identity service (Cognito-first pattern)
      // Identity service needs to read user information from Cognito User Pool
      if (info.name === 'identity') {
        taskRole.addToPolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: [
              "cognito-idp:AdminGetUser",
              "cognito-idp:AdminListGroupsForUser",
              "cognito-idp:ListUsersInGroup",
            ],
            resources: [identityProvider.tenantUserPool.userPoolArn],
          })
        );

        // Sprint C.0.7 — Per-school PDF branding upload/read.
        //
        // Identity service mints presigned URLs against the PDF-assets bucket
        // using TVM-issued tenant-scoped credentials. The ABAC role's S3
        // policy interpolates ${aws:PrincipalTag/tenant} into the resource
        // path, so the presigned URL CANNOT escape the caller's tenant
        // partition even if BrandingService constructs a wrong key.
        //
        // Bucket name follows the deterministic
        //   edforge-pdf-assets-{account}-{region}
        // convention from analytics-stack (C.0.6) — no CFN import, no
        // cross-stack export (R46 mitigation). The env var
        // PDF_ASSETS_BUCKET tells the container which bucket to sign for.
        const stack = cdk.Stack.of(this);
        const pdfAssetsBucketName =
          `edforge-pdf-assets-${stack.account}-${stack.region}`;
        abacRole.addToPolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            // PutObject for presigned uploads; GetObject for read-back (PDF
            // render endpoints in C.1+). NO DeleteObject — branding has no
            // delete path today, and the bucket is versioned so a delete
            // without DeleteObjectVersion would only stamp delete-markers
            // anyway. A "reset branding" UI can earn delete back with its
            // own ticket + IAM widening.
            actions: ['s3:PutObject', 's3:GetObject'],
            resources: [
              `arn:aws:s3:::${pdfAssetsBucketName}/tenants/\${aws:PrincipalTag/tenant}/*`,
            ],
          })
        );
        info.environment = info.environment || {};
        info.environment.PDF_ASSETS_BUCKET = pdfAssetsBucketName;

        // Sprint E.1 — IEMIS report CSV download. The report-aggregator Lambda
        // writes the generated CSV to the reports-staging bucket under keys
        // `tenant=<tenantId>/...`; identity mints a presigned GET URL so the
        // operator can download it (the bucket is private). Same ABAC scoping
        // as PDF assets: ${aws:PrincipalTag/tenant} resolves to the caller's
        // tenant, so the URL cannot read another tenant's report. Bucket name
        // follows the deterministic analytics-stack convention (no CFN export).
        const reportsStagingBucketName =
          `edforge-reports-staging-${stack.account}-${stack.region}`;
        abacRole.addToPolicy(
          new iam.PolicyStatement({
            effect: iam.Effect.ALLOW,
            actions: ['s3:GetObject'],
            resources: [
              `arn:aws:s3:::${reportsStagingBucketName}/tenant=\${aws:PrincipalTag/tenant}/*`,
            ],
          })
        );
        info.environment.REPORTS_STAGING_BUCKET = reportsStagingBucketName;
      }

      // Add environment variables for TokenVendingMachine
      info.environment = info.environment || {};
      info.environment.IAM_ROLE_ARN = abacRole.roleArn;
      info.environment.REQUEST_TAG_KEYS_MAPPING_ATTRIBUTES = '{"tenant":"custom:tenantId"}';
      info.environment.IDP_DETAILS = JSON.stringify({
        issuer: identityProvider.identityDetails.details.issuer,
        audience: identityProvider.identityDetails.details.clientId
      });

      // Attach additional policy if exists (e.g., SSM, Cognito)
      if (policy) {
        // Replace USER_POOL_ID placeholder for services with storage (e.g., identity)
        // This was previously only done for stateless services in the else branch
        policy = policy.replace(
          /<USER_POOL_ID>/g,
          identityProvider.identityDetails.details.userPoolId
        );
        
        taskRole.attachInlinePolicy(
          new iam.Policy(this, `${info.name}AdditionalPolicy`, {
            document: iam.PolicyDocument.fromJson(JSON.parse(policy)),
          })
        );
      }

      return taskRole;
    } else {
      // Create role for stateless service
      policy = policy.replace(
        /<USER_POOL_ID>/g,
        identityProvider.identityDetails.details.userPoolId
      );
      return new iam.Role(this, `${info.name}-ecsTaskRole`, {
        assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
        inlinePolicies: {
          EcsContainerInlinePolicy: iam.PolicyDocument.fromJson(
            JSON.parse(policy)
          ),
        },
      });
    }
  }

  /**
   * Deploy rProxy service with dependencies on core services
   */
  private deployRProxyService(
    serviceInfo: any,
    props: TenantTemplateStackProps,
    vpc: ec2.IVpc,
    ecsSG: ec2.SecurityGroup,
    identityProvider: IdentityProvider,
    isEc2Tier: boolean,
    isRProxy: boolean,
    coreServices: EcsService[]
  ): void {
    const rProxyInfo: ContainerInfo = serviceInfo.Rproxy;

    // Create IAM role for rProxy with CloudWatch permissions
    const taskRole = new iam.Role(this, `rProxy-taskRole`, {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
    });

    // CloudWatchAgentServerPolicy is sufficient for log
    // publishing. CloudWatchFullAccess grants unnecessary admin rights.
    taskRole.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName("CloudWatchAgentServerPolicy")
    );

    // Create rProxy ECS service
    const rproxyService = new EcsService(this, `rproxy-EcsServices`, {
      tenantId: props.tenantId,
      tenantName: props.tenantName,
      isEc2Tier,
      isRProxy,
      isTarget: isRProxy,
      vpc: vpc,
      cluster: this.cluster,
      ecsSG: ecsSG,
      taskRole,
      namespace: this.namespace,
      info: rProxyInfo,
      identityDetails: identityProvider.identityDetails,
    });

    // rProxy depends on ALL core services (users, school for EdForge)
    // Previously included orders and products which have been removed
    coreServices.forEach((coreService) => {
      rproxyService.service.node.addDependency(coreService.service);
    });
  }
}
