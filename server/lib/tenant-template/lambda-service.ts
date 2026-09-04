import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { serviceFunctionName } from '../utilities/function-names';

export interface LambdaServiceProps {
  /** identity | academics | finance */
  readonly serviceName: string;
  /** Tier / tenantName the pooled stack is deployed for (basic). */
  readonly tier: string;
  /** Directory holding the bundle (index.js) built by scripts/build-lambda.sh. */
  readonly assetPath: string;
  /** Task-definition environment for this service; EDFORGE_RUNTIME=lambda is added, Lambda-reserved keys are dropped. */
  readonly environment: Record<string, string>;
  /** Extra layers (finance: the linux-x64 sharp layer). */
  readonly layers?: lambda.ILayerVersion[];
  /** Bundle export to run; `index.handler` (HTTP) by default, `index.scheduledHandler` / `index.workerHandler` for the C3 entries. */
  readonly handler?: string;
  /** Function-name suffix: `api` (default), `scheduled`, `worker`. Set once at creation. */
  readonly nameSuffix?: string;
  /** 1,769 MB by default (one vCPU for the Nest bootstrap); workers use 3,008 MB. */
  readonly memorySize?: number;
  /** 29 s by default (the REST integration ceiling); scheduled 300 s, workers 900 s. */
  readonly timeout?: cdk.Duration;
  readonly description?: string;
}

/**
 * One Lambda function per NestJS service (cost-redesign C1.6 / TARGET §1).
 *
 * The function runs the service's `lambda.ts` entry — the whole Nest app,
 * cached per execution environment — outside the VPC: DynamoDB, STS, Cognito
 * and EventBridge are reached over their public endpoints, so no NAT is needed.
 *
 * Sizing (TARGET §1.3): 1,769 MB allocates a full vCPU, which is what a
 * CPU-bound Nest bootstrap wants (measured 0.55–0.68 s locally → ≈1.1–1.4 s on
 * Lambda); 29 s matches the API Gateway REST integration ceiling.
 *
 * The role is created here with AWSLambdaBasicExecutionRole — the logs grant
 * the ECS *execution* role used to carry — and the stack applies the same
 * tenant-scoped grants the ECS task role gets (assume the ABAC role with the
 * tenant session tag, bootstrap DynamoDB access, per-service extras).
 *
 * The function name is deterministic and set at creation; it is what the
 * REST API's stage variables (`identityFn` …) resolve, so it must never be
 * renamed (a rename is a replacement).
 */
/**
 * Keys Lambda sets itself and rejects in a function's environment
 * (CreateFunction fails with "reserved keys"). The ECS default environment
 * carries AWS_REGION, so the filter is exercised on every deploy.
 */
export const LAMBDA_RESERVED_ENV_KEYS: ReadonlySet<string> = new Set([
  'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_ACCESS_KEY', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY',
  'AWS_SECRET_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN', 'AWS_EXECUTION_ENV',
  'AWS_LAMBDA_FUNCTION_NAME', 'AWS_LAMBDA_FUNCTION_MEMORY_SIZE', 'AWS_LAMBDA_FUNCTION_VERSION',
  'AWS_LAMBDA_INITIALIZATION_TYPE', 'AWS_LAMBDA_LOG_GROUP_NAME', 'AWS_LAMBDA_LOG_STREAM_NAME',
  'AWS_LAMBDA_RUNTIME_API', 'AWS_XRAY_CONTEXT_MISSING', 'AWS_XRAY_DAEMON_ADDRESS',
  'LAMBDA_TASK_ROOT', 'LAMBDA_RUNTIME_DIR', '_HANDLER', '_X_AMZN_TRACE_ID', 'TZ',
]);

export function withoutReservedLambdaEnv(env: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k]) => !LAMBDA_RESERVED_ENV_KEYS.has(k)));
}

export class LambdaService extends Construct {
  public readonly role: iam.Role;
  public readonly fn: lambda.Function;
  public readonly functionName: string;

  constructor(scope: Construct, id: string, props: LambdaServiceProps) {
    super(scope, id);

    this.functionName = serviceFunctionName(props.serviceName, props.tier, props.nameSuffix ?? 'api');

    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
      ],
      description: `Execution role for the ${props.serviceName} service Lambda (${props.tier})`,
    });

    this.fn = new lambda.Function(this, 'Function', {
      functionName: this.functionName,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.X86_64,
      handler: props.handler ?? 'index.handler',
      code: lambda.Code.fromAsset(props.assetPath),
      memorySize: props.memorySize ?? 1769,
      timeout: props.timeout ?? cdk.Duration.seconds(29),
      role: this.role,
      environment: {
        ...withoutReservedLambdaEnv(props.environment),
        EDFORGE_RUNTIME: 'lambda',
        // The SDK v3 reuses connections by default; keep TCP keep-alive on
        // for the DynamoDB/STS calls every request makes.
        AWS_NODEJS_CONNECTION_REUSE_ENABLED: '1',
        // The single-file bundle cannot resolve the PDF renderer's fonts
        // relative to its own file; build-lambda.sh ships them beside index.js.
        PDF_FONT_DIR: '/var/task/fonts',
      },
      layers: props.layers,
      logRetention: logs.RetentionDays.ONE_MONTH,
      description: props.description ?? `${props.serviceName} NestJS service (serverless-express), ${props.tier} tier`,
    });
  }
}
