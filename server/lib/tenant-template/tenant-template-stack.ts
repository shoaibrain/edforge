import * as cdk from "aws-cdk-lib";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as lambdaNodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as logs from "aws-cdk-lib/aws-logs";
import * as events from "aws-cdk-lib/aws-events";
import * as eventsTargets from "aws-cdk-lib/aws-events-targets";
import * as cloudwatch from "aws-cdk-lib/aws-cloudwatch";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as sns from "aws-cdk-lib/aws-sns";
import * as cwActions from "aws-cdk-lib/aws-cloudwatch-actions";
import { type Construct } from "constructs";
import { type Table } from "aws-cdk-lib/aws-dynamodb";
import { IdentityProvider } from "./identity-provider";
import { LambdaService } from "./lambda-service";
import { TenantTemplateNag } from "../cdknag/tenant-template-nag";
import { addTemplateTag } from "../utilities/helper-functions";
import { defaultServiceEnvironment } from "../utilities/ecs-utils";
import { grantApiBInvoke } from "../utilities/api-b-invoke";
import { FinanceSchedules, FunctionsErrorsAlarm, apiFunctionEnvironment, scheduledFunctionEnvironment, workerFunctionEnvironment } from "./finance-schedules";
import { ServiceJobsQueue, JobsDlqAlarm } from "./service-jobs-queue";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import { withApiBServiceUrls } from "../utilities/service-urls";
import { API_B_URL_EXPORT } from "../utilities/function-names";
import { ContainerInfo } from "../interfaces/container-info";
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
  /**
   * CDK_PARAM_API_JOBS_TRANSPORT=sqs — the API functions (API-B, preview) hand
   * bulk jobs to the queue workers while the containers keep the transport in
   * service-info: a canary for the worker path before the production flip.
   */
  apiJobsTransport?: 'sqs';
  // SES account-email transport (Sprint 2). Threaded as plain strings to the
  // tenant Cognito pool; flag-gated by sesEnabled (default false → COGNITO_DEFAULT).
  sesEnabled?: boolean;
  sesFromEmail?: string;
  sesFromName?: string;
  sesReplyTo?: string;
  sesIdentityName?: string;
  sesConfigurationSetName?: string;
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
  /** ABAC role per service, created with the ECS task role and shared with the Lambda role. */
  private readonly abacRoles = new Map<string, iam.Role>();
  private readonly storages = new Map<string, EcsDynamoDB>();

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
      sesEnabled: props.sesEnabled,
      sesFromEmail: props.sesFromEmail,
      sesFromName: props.sesFromName,
      sesReplyTo: props.sesReplyTo,
      sesIdentityName: props.sesIdentityName,
      sesConfigurationSetName: props.sesConfigurationSetName,
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
      // Login-history seam: real users authenticate Amplify→Cognito and bypass
      // POST /auth/login, so the trigger writes the LOGIN_HISTORY row here.
      // Table name derived from `tier` — IDENTICAL to the academics→identity
      // grant below (~L630). V1 is BASIC-only where tenantName === tier ===
      // "basic", so this resolves to the real `edforge-identity-basic` table.
      // The identity table template is `edforge-identity-<TIER>` with <TIER>
      // filled by tenantName at synth; if a future tenant is ever provisioned
      // with tenantName !== tier, revisit this AND the academics grant together
      // (both share the coupling). Best-effort write, so a miss silently no-ops.
      identityTableName: `edforge-identity-${props.tier.toLowerCase()}`,
    });

    // Configuration values with clear defaults

    // Clear condition variables for better readability
    const isAdvancedTier = props.tier.toLocaleLowerCase() === "advanced";
    const isAdvancedActive = props.advancedCluster === "ACTIVE";
    // V1_DEFERRED: shouldDeployServices is always true for BASIC tier.
    // For ADVANCED with INACTIVE cluster, services are skipped (cluster-only stack).
    // This pattern supports a two-phase Advanced deployment:
    //   Phase 1: Deploy cluster only (INACTIVE)
    //   Phase 2: Deploy services into existing cluster (ACTIVE)
    const shouldDeployServices = !isAdvancedTier || isAdvancedActive;

    // Deploy services conditionally
    if (shouldDeployServices) {
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
        "<NAMESPACE>": props.tenantName,
        "<EVENT_BUS_NAME>": props.eventBusName, // SBT Event Bus Name for microservice domain events
        "<INTERNAL_API_KEY>": internalApiKey,
        // <TIER> is deliberately NOT substituted here: createStorageIfNeeded()
        // derives the table construct id from the placeholder, and resolving it
        // early renames the tables (a replacement of the production data
        // tables). Other environment values get it after the table name is final.
      };

      let updateData = data;
      for (const [placeholder, replacement] of Object.entries(replacements)) {
        const regex = new RegExp(placeholder, "g");
        updateData = updateData.replace(regex, replacement);
      }

      const serviceInfo = JSON.parse(updateData);
      const containerInfo: ContainerInfo[] = serviceInfo.Containers;

      containerInfo.forEach((info) => {
        // Create storage if needed for the service
        const storage = this.createStorageIfNeeded(info, props.tenantName, props.tier);
        if (storage) this.storages.set(info.name, storage);

        this.createAbacRole(info, storage, identityProvider, props.tier);
      });

      {
        const sharpLayer = new lambda.LayerVersion(this, "SharpLayer", {
          code: lambda.Code.fromAsset(this.lambdaAssetPath("layers/sharp")),
          compatibleRuntimes: [lambda.Runtime.NODEJS_22_X],
          compatibleArchitectures: [lambda.Architecture.X86_64],
          description: "sharp (linux-x64) for the finance logo optimiser",
        });
        const jobDeadLetterQueues: Record<string, sqs.IQueue> = {};
        containerInfo.forEach((info) => {
          const abacRole = this.abacRoles.get(info.name);
          const storage = this.storages.get(info.name);
          if (!abacRole || !storage) return; // stateless containers (none today) get no function
          const svc = new LambdaService(this, `${info.name}-Lambda`, {
            serviceName: info.name,
            tier: props.tier,
            assetPath: this.lambdaAssetPath(info.name),
            // C2.6 — outside the VPC the Cloud Map service URLs do not resolve;
            // the function calls its siblings through API-B (shared-infra export).
            environment: withApiBServiceUrls(
              apiFunctionEnvironment(
                {
                  ...defaultServiceEnvironment(this, identityProvider.identityDetails),
                  ...(info.environment as unknown as Record<string, string>),
                  // Nest's enableCors reads CORS_ORIGINS; the containers never needed it
                  // (the frontend reaches API-A same-origin), a function on API-B does.
                  ...(props.corsAllowedOrigins ? { CORS_ORIGINS: props.corsAllowedOrigins } : {}),
                },
                props.apiJobsTransport,
              ),
              cdk.Fn.importValue(API_B_URL_EXPORT),
            ),
            layers: info.name === "finance" ? [sharpLayer] : undefined,
          });
          // C2.5 — API-B reaches the function through a stage variable, which
          // grants nothing by itself. shared-infra (API-B) deploys first.
          grantApiBInvoke(svc.fn);
          if (info.name === "identity") {
            // Sprint 1 S1.12 moved off the container (C6.1): a dropped IEMIS
            // audit row is compliance-critical, so the filter follows the
            // identity function's log group. New alarm name — the container
            // alarm is deleted in the same update and alarm names are unique.
            const emitFailureFilter = new logs.MetricFilter(this, "IemisAuditEmitFailureFilter", {
              logGroup: logs.LogGroup.fromLogGroupName(this, "IdentityFunctionLogGroup", `/aws/lambda/${svc.functionName}`),
              metricNamespace: "EdForge/IEMIS",
              metricName: "AuditEmitFailures",
              filterPattern: logs.FilterPattern.literal('"iemis.audit.emit_failure"'),
              metricValue: "1",
              defaultValue: 0,
            });
            emitFailureFilter.node.addDependency(svc.fn);
            const emitFailureAlarm = new cloudwatch.Alarm(this, "IemisAuditEmitFailuresAlarm", {
              alarmName: `edforge-identity-iemis-audit-emit-failures-${props.tier.toLowerCase()}`,
              alarmDescription:
                "IEMIS audit events are being dropped due to DDB write failures. " +
                "Compliance-critical: an operator action has happened but its " +
                "audit row did not land. Runbook: docs/operations/saraswati-oncall.md " +
                'section "IEMIS audit emit failures".',
              metric: emitFailureFilter.metric({ statistic: "Sum", period: cdk.Duration.minutes(5) }),
              threshold: 0,
              evaluationPeriods: 1,
              comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
              treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
            });
            const opsTopicArn = process.env.CDK_PARAM_OPERATOR_TOPIC_ARN;
            if (opsTopicArn) {
              emitFailureAlarm.addAlarmAction(new cwActions.SnsAction(sns.Topic.fromTopicArn(this, "OperatorAlertTopicRef", opsTopicArn)));
            }
          }

          // C3.4 — finance's timers run as EventBridge Scheduler schedules on a
          // second function from the same bundle (index.scheduledHandler), with
          // the same grants; schedules ship DISABLED and are enabled once the
          // ECS timers are off (C3.5).
          // C3.11 — the IEMIS import's queue and worker (index.workerHandler). Rows
          // are staged in the reports-staging bucket under the tenant's ABAC
          // prefix, so the ABAC role gains put/get/delete on that sub-prefix.
          if (info.name === "academics") {
            const workerTimeout = cdk.Duration.seconds(900);
            const jobs = new ServiceJobsQueue(this, "AcademicsJobsQueue", { serviceName: info.name, tier: props.tier, workerTimeout });
            jobDeadLetterQueues[info.name] = jobs.deadLetterQueue;
            const worker = new LambdaService(this, `${info.name}-Worker`, {
              serviceName: info.name,
              tier: props.tier,
              assetPath: this.lambdaAssetPath(info.name),
              environment: workerFunctionEnvironment(withApiBServiceUrls(
                {
                  ...defaultServiceEnvironment(this, identityProvider.identityDetails),
                  ...(info.environment as unknown as Record<string, string>),
                  ACADEMICS_JOBS_QUEUE_URL: jobs.queue.queueUrl,
                },
                cdk.Fn.importValue(API_B_URL_EXPORT),
              )),
              handler: "index.workerHandler",
              nameSuffix: "worker",
              timeout: workerTimeout,
              description: `academics IEMIS-import worker (SQS), ${props.tier} tier`,
            });
            TenantTemplateStack.applyServicePrincipalGrants(this, {
              info,
              role: worker.role,
              abacRole,
              tableArn: storage.table.tableArn,
              userPoolArn: identityProvider.tenantUserPool.userPoolArn,
              identityTableArn: `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-${props.tier.toLowerCase()}`,
              additionalPolicyJson: TenantTemplateStack.renderAdditionalPolicy(info, identityProvider),
              additionalPolicyId: `${info.name}WorkerAdditionalPolicy`,
            });
            jobs.queue.grantConsumeMessages(worker.role);
            worker.fn.addEventSource(new lambdaEventSources.SqsEventSource(jobs.queue, { batchSize: 1, maxConcurrency: 2, reportBatchItemFailures: true }));
            jobs.queue.grantSendMessages(svc.role);
            svc.fn.addEnvironment("ACADEMICS_JOBS_QUEUE_URL", jobs.queue.queueUrl);
            abacRole.addToPolicy(
              new iam.PolicyStatement({
                effect: iam.Effect.ALLOW,
                actions: ["s3:PutObject", "s3:PutObjectTagging", "s3:GetObject", "s3:DeleteObject"],
                resources: [`arn:aws:s3:::edforge-reports-staging-${this.account}-${this.region}/tenant=\${aws:PrincipalTag/tenant}/iemis-import/*`],
              }),
            );
          }

          if (info.name === "finance") {
            const scheduled = new LambdaService(this, `${info.name}-Scheduled`, {
              serviceName: info.name,
              tier: props.tier,
              assetPath: this.lambdaAssetPath(info.name),
              environment: scheduledFunctionEnvironment(withApiBServiceUrls(
                {
                  ...defaultServiceEnvironment(this, identityProvider.identityDetails),
                  ...(info.environment as unknown as Record<string, string>),
                },
                cdk.Fn.importValue(API_B_URL_EXPORT),
              )),
              handler: "index.scheduledHandler",
              nameSuffix: "scheduled",
              timeout: cdk.Duration.seconds(300),
              description: `finance timers on EventBridge Scheduler (recurring billing, overdue, reconciliation, sweep), ${props.tier} tier`,
            });
            TenantTemplateStack.applyServicePrincipalGrants(this, {
              info,
              role: scheduled.role,
              abacRole,
              tableArn: storage.table.tableArn,
              userPoolArn: identityProvider.tenantUserPool.userPoolArn,
              identityTableArn: `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-${props.tier.toLowerCase()}`,
              additionalPolicyJson: TenantTemplateStack.renderAdditionalPolicy(info, identityProvider),
              additionalPolicyId: `${info.name}ScheduledAdditionalPolicy`,
            });
            new FinanceSchedules(this, "FinanceSchedules", { fn: scheduled.fn, enabled: true });
            // C3.7 — the bulk jobs queue and its worker (index.workerHandler, 3,008 MB,
            // 900 s, sharp for the PDF exports). The API function and the ECS task
            // send; the worker consumes; JOBS_TRANSPORT (task definition) decides
            // whether anyone actually enqueues.
            const workerTimeout = cdk.Duration.seconds(900);
            const jobs = new ServiceJobsQueue(this, "FinanceJobsQueue", { serviceName: info.name, tier: props.tier, workerTimeout });
            jobDeadLetterQueues[info.name] = jobs.deadLetterQueue;
            const worker = new LambdaService(this, `${info.name}-Worker`, {
              serviceName: info.name,
              tier: props.tier,
              assetPath: this.lambdaAssetPath(info.name),
              environment: workerFunctionEnvironment(withApiBServiceUrls(
                {
                  ...defaultServiceEnvironment(this, identityProvider.identityDetails),
                  ...(info.environment as unknown as Record<string, string>),
                  FINANCE_JOBS_QUEUE_URL: jobs.queue.queueUrl,
                },
                cdk.Fn.importValue(API_B_URL_EXPORT),
              )),
              handler: "index.workerHandler",
              nameSuffix: "worker",
              memorySize: 3008,
              timeout: workerTimeout,
              layers: [sharpLayer],
              description: `finance bulk-jobs worker (SQS), ${props.tier} tier`,
            });
            TenantTemplateStack.applyServicePrincipalGrants(this, {
              info,
              role: worker.role,
              abacRole,
              tableArn: storage.table.tableArn,
              userPoolArn: identityProvider.tenantUserPool.userPoolArn,
              identityTableArn: `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-${props.tier.toLowerCase()}`,
              additionalPolicyJson: TenantTemplateStack.renderAdditionalPolicy(info, identityProvider),
              additionalPolicyId: `${info.name}WorkerAdditionalPolicy`,
            });
            jobs.queue.grantConsumeMessages(worker.role);
            worker.fn.addEventSource(new lambdaEventSources.SqsEventSource(jobs.queue, { batchSize: 1, maxConcurrency: 2, reportBatchItemFailures: true }));
            jobs.queue.grantSendMessages(svc.role);
            svc.fn.addEnvironment("FINANCE_JOBS_QUEUE_URL", jobs.queue.queueUrl);

            new FunctionsErrorsAlarm(this, "FinanceFunctionsErrorsAlarm", {
              alarmName: `edforge-finance-functions-errors-${props.tier.toLowerCase()}`,
              description: "A finance function (HTTP, scheduled or worker) errored in the last 5 minutes. Check /aws/lambda/edforge-finance-*; a scheduled job that fails leaves its window un-run; a worker error leaves the job for the janitor.",
              functions: { api: svc.fn, scheduled: scheduled.fn, worker: worker.fn },
            });
          }
          TenantTemplateStack.applyServicePrincipalGrants(this, {
            info,
            role: svc.role,
            abacRole,
            tableArn: storage.table.tableArn,
            userPoolArn: identityProvider.tenantUserPool.userPoolArn,
            identityTableArn: `arn:aws:dynamodb:${this.region}:${this.account}:table/edforge-identity-${props.tier.toLowerCase()}`,
            additionalPolicyJson: TenantTemplateStack.renderAdditionalPolicy(info, identityProvider),
            additionalPolicyId: `${info.name}LambdaAdditionalPolicy`,
          });
        });
        if (Object.keys(jobDeadLetterQueues).length > 0) {
          new JobsDlqAlarm(this, "JobsDlqAlarm", { tier: props.tier, deadLetterQueues: jobDeadLetterQueues });
        }
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
        runtime: lambda.Runtime.NODEJS_22_X,
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

    // One alarm covers Lambda errors (code-level failures: DDB exceptions,
    // OOM, timeout) and DLQ depth (retries exhausted; operator redrives via
    // the SQS console). Cost-redesign C0.4 holds the account to ten alarms,
    // and both conditions mean the same thing to the operator: ResultCard
    // generation halted for an exam. V1: visible in the CW console; SNS
    // action wiring is V1.5 (see header note above).
    new cloudwatch.Alarm(this, "ResultBatchLambdaErrorsAlarm", {
      alarmName: `edforge-result-batch-${props.tier.toLowerCase()}`,
      alarmDescription:
        "Result-batch Lambda errored or its DLQ holds events. ResultCard generation halted for the affected exam; check the function log, then redrive the DLQ.",
      metric: new cloudwatch.MathExpression({
        expression: "FILL(errors, 0) + FILL(dlq, 0)",
        usingMetrics: {
          errors: resultBatchLambda.metricErrors({
            period: cdk.Duration.minutes(5),
            statistic: "Sum",
          }),
          dlq: resultBatchDlq.metricApproximateNumberOfMessagesVisible({
            period: cdk.Duration.minutes(5),
            statistic: "Maximum",
          }),
        },
        period: cdk.Duration.minutes(5),
        label: "Result-batch errors + DLQ depth",
      }),
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
        tier: props.tier,
        advancedCluster: props.advancedCluster,
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
    tenantName: string,
    tier: string = tenantName
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
      // Cost-redesign C3.7 — the jobs queue URLs in service-info.txt name the
      // queue by tier. Substituted here, after the table name is final and
      // never before: the table construct id above is derived from the
      // placeholder, and resolving it early would replace the tables.
      const env = info.environment as unknown as Record<string, string>;
      for (const [key, value] of Object.entries(env)) {
        if (key !== "TABLE_NAME" && typeof value === "string" && value.includes("<TIER>")) {
          env[key] = value.replace(/<TIER>/g, tier.toLowerCase());
        }
      }
      return storage;
    }
    return undefined;
  }

  /**
   * Create IAM task role for ECS service
   */
  private createAbacRole(
    info: ContainerInfo,
    storage: EcsDynamoDB | undefined,
    identityProvider: IdentityProvider,
    tier: string
  ): iam.Role | undefined {
    if (!storage) return undefined;
    const abacRole = new iam.Role(this, `${info.name}-ABACRole`, {
      assumedBy: new iam.ServicePrincipal("ecs-tasks.amazonaws.com"),
      inlinePolicies: {
        DynamoDBTenantAccess: storage.policyDocument
      }
    });
    this.abacRoles.set(info.name, abacRole);
    // Add Cognito permissions for Identity service (Cognito-first pattern)
    // Identity service needs to read user information from Cognito User Pool
    if (info.name === 'identity') {
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
    // Cost-redesign C3.11 — academics stages IEMIS import rows in the same
    // bucket (tenant=<id>/iemis-import/*). The container and the worker
    // function inherit this; the put/get/delete grant on that sub-prefix is
    // added to the ABAC role by the Lambda-services block.
    if (info.name === "academics") {
      info.environment = info.environment || {};
      info.environment.REPORTS_STAGING_BUCKET = `edforge-reports-staging-${this.account}-${this.region}`;
    }

    // Sprint F.1 — Finance bulk-PDF export grant. Extracted to a static
    // helper so `tenant-template-stack.spec.ts` can assert the role +
    // env-var wiring without standing up the full stack (which depends on
    // a build-generated `service-info.json`). The helper itself is a
    // no-op for non-finance containers; the if-guard lives inside it.
    TenantTemplateStack.applyFinancePdfGrant(this, info, abacRole);

    // Add environment variables for TokenVendingMachine
    info.environment = info.environment || {};
    info.environment.IAM_ROLE_ARN = abacRole.roleArn;
    info.environment.REQUEST_TAG_KEYS_MAPPING_ATTRIBUTES = '{"tenant":"custom:tenantId"}';
    info.environment.IDP_DETAILS = JSON.stringify({
      issuer: identityProvider.identityDetails.details.issuer,
      audience: identityProvider.identityDetails.details.clientId
    });

    return abacRole;
  }
  /**
   * Cost-redesign C1.6 — the AdditionalPolicy JSON from service-info with the
   * tenant pool id substituted. Shared by the ECS task role and the Lambda role.
   */
  static renderAdditionalPolicy(info: ContainerInfo, identityProvider: IdentityProvider): string | undefined {
    if (!info.policy) return undefined;
    return JSON.stringify(info.policy).replace(
      /<USER_POOL_ID>/g,
      identityProvider.identityDetails.details.userPoolId
    );
  }

  /**
   * Cost-redesign C1.6 — grants that make a principal a "service identity":
   * the ECS task role today, the Lambda execution role alongside it.
   *
   * In this order (the order is part of the deployed policy documents):
   *   1. the ABAC role trusts the principal for sts:AssumeRole + sts:TagSession
   *      only with a `tenant` session tag (aws:RequestTag/tenant);
   *   2. the principal may assume the ABAC role under the same condition;
   *   3. bootstrap DynamoDB access on the service table + indexes (login /
   *      tenant lookup happen before a JWT exists, so the TVM cannot be used);
   *   4. academics: GetItem on the identity table (archetype resolution —
   *      the 2026-06-04 GB2 degraded deploy);
   *   5. identity: the Cognito read actions on the tenant pool;
   *   6. the service's AdditionalPolicy from service-info (Cognito admin,
   *      SSM messages, …), attached as an inline iam.Policy.
   *
   * Static and expressed in primitives so `tenant-template-stack.spec.ts` can
   * exercise it against a bare stack (the full stack synth needs the generated
   * service-info.json and the SBT graph).
   */
  static applyServicePrincipalGrants(
    scope: Construct,
    opts: {
      info: ContainerInfo;
      role: iam.Role;
      abacRole: iam.Role;
      tableArn: string;
      userPoolArn: string;
      identityTableArn: string;
      additionalPolicyJson?: string;
      additionalPolicyId: string;
    },
  ): void {
    const tenantTag = { StringLike: { "aws:RequestTag/tenant": "*" } };
    opts.abacRole.assumeRolePolicy?.addStatements(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        principals: [new iam.ArnPrincipal(opts.role.roleArn)],
        actions: ["sts:AssumeRole", "sts:TagSession"],
        conditions: tenantTag,
      })
    );
    opts.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ["sts:AssumeRole", "sts:TagSession"],
        resources: [opts.abacRole.roleArn],
        conditions: tenantTag,
      })
    );
    opts.role.addToPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:Query",
        ],
        resources: [opts.tableArn, `${opts.tableArn}/index/*`],
      })
    );
    if (opts.info.name === 'academics') {
      opts.role.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: ["dynamodb:GetItem"],
          resources: [opts.identityTableArn],
        })
      );
    }
    if (opts.info.name === 'identity') {
      opts.role.addToPolicy(
        new iam.PolicyStatement({
          effect: iam.Effect.ALLOW,
          actions: [
            "cognito-idp:AdminGetUser",
            "cognito-idp:AdminListGroupsForUser",
            "cognito-idp:ListUsersInGroup",
          ],
          resources: [opts.userPoolArn],
        })
      );
    }
    if (opts.additionalPolicyJson) {
      opts.role.attachInlinePolicy(
        new iam.Policy(scope, opts.additionalPolicyId, {
          document: iam.PolicyDocument.fromJson(JSON.parse(opts.additionalPolicyJson)),
        })
      );
    }
  }

  /**
   * Cost-redesign C1.6 — where scripts/build-lambda.sh leaves the bundles.
   * Fails loudly when the flag is on and the bundle is missing, instead of
   * synthesizing an empty asset.
   */
  private lambdaAssetPath(name: string): string {
    const dir = path.resolve(__dirname, "../../application/dist-lambda", name);
    if (!fs.existsSync(path.join(dir, name.startsWith("layers/") ? "nodejs" : "index.js"))) {
      throw new Error(
        `Lambda asset ${dir} is missing — run scripts/build-lambda.sh <svc> and build-sharp-layer.sh before synthesizing (scripts/deploy.sh does this)`,
      );
    }
    return dir;
  }

  /**
   * Sprint F.1 — Finance bulk-PDF export grant.
   *
   * The bulk-invoice / bulk-receipt PDF workers (Sprints F.3 / G.2) write
   * ZIP + merged-PDF artifacts to the short-lived pdfsBucket
   *   edforge-pdfs-{account}-{region}
   * provisioned in analytics-stack §1348-1373 with a 7d tag-based lifecycle
   * on objects tagged { lifecycle: 'pdf-jobs' }.
   *
   * The ABAC role's S3 policy interpolates ${aws:PrincipalTag/tenant} into
   * the resource path, so a presigned URL minted from one tenant's TVM
   * credentials cannot read another tenant's pdf-job output even if the
   * worker constructs a wrong key.
   *
   * `s3:PutObjectTagging` is required IN ADDITION to `s3:PutObject` because
   * every writer MUST tag its objects { lifecycle: 'pdf-jobs' } at PutObject
   * time (analytics-stack §1362-1366). Untagged objects survive the
   * lifecycle by design (audit-copy use case); AWS requires both
   * permissions to set tags via the PutObject API.
   *
   * Bucket name reconstructed from the deterministic naming convention
   * (no CFN export — R46 cross-stack collision mitigation). The
   * PDF_OUTPUT_BUCKET env var tells the finance container which bucket to
   * write to.
   *
   * No-op for any non-finance container.
   *
   * Exposed as a `static` method (not a private instance method) so the
   * tenant-template-stack.spec.ts harness can exercise the wiring against
   * a bare `iam.Role` without standing up the full `TenantTemplateStack`
   * (which reads a build-generated `service-info.json` and pulls in the
   * full ECS/VPC graph).
   */
  static applyFinancePdfGrant(
    scope: Construct,
    info: ContainerInfo,
    abacRole: iam.IRole,
  ): void {
    if (info.name !== 'finance') {
      return;
    }
    const stack = cdk.Stack.of(scope);
    const pdfsBucketName = `edforge-pdfs-${stack.account}-${stack.region}`;
    abacRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['s3:PutObject', 's3:GetObject', 's3:PutObjectTagging'],
        resources: [
          `arn:aws:s3:::${pdfsBucketName}/tenants/\${aws:PrincipalTag/tenant}/*`,
        ],
      }),
    );
    info.environment = info.environment || ({} as ContainerInfo['environment']);
    info.environment.PDF_OUTPUT_BUCKET = pdfsBucketName;
  }
}
