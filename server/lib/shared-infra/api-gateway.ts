
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { type CustomApiKey } from '../interfaces/custom-api-key';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as path from 'path';
import * as fs from 'fs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';

interface ApiGatewayProps {
  lambdaEcsSaaSLayers: lambda.LayerVersion
  stageName: string
  nlb: elbv2.INetworkLoadBalancer
  vpcLink: cdk.aws_apigateway.VpcLink
  corsAllowedOrigins: string
  apiKeyBasicTier: CustomApiKey
  apiKeyAdvancedTier: CustomApiKey
  apiKeyPremiumTier: CustomApiKey
}

export class ApiGateway extends Construct {
  public readonly restApi: apigateway.SpecRestApi;
  public readonly tenantScopedAccessRole: cdk.aws_iam.Role;
  public readonly requestValidator: apigateway.RequestValidator;
  /**
   * Authorizer Lambda function exposed so downstream stacks (e.g.,
   * analytics-stack) can attach the same authorizer to additional methods
   * via `RequestAuthorizer.fromAuthorizerAttributes` or by referencing the
   * function ARN. Do NOT modify the authorizer code from a downstream stack
   * — it is shared by identity/academics/finance.
   */
  public readonly authorizerFunction!: lambda.IFunction;
  
  /**
   * TenantAPI CORS Configuration
   *
   * Current: Uses wildcard '*' in Swagger OPTIONS responses (tenant-api-prod.json).
   * This is INTENTIONAL for the development/MVP phase to allow uninterrupted
   * development across multiple MFE apps, local environments, and preview deployments.
   *
   * Required Origins (for future production lockdown) — substitute
   * your own deployment URLs:
   * - https://<your-tenant-frontend>          (production custom domain)
   * - http://localhost:3000-3008              (local dev — MFE apps)
   *
   * SECURITY NOTE: Before GA production launch, implement dynamic CORS handling
   * in the Lambda Authorizer to restrict origins per-tenant. The authorizer already
   * receives the Origin header and can return tenant-specific allowed origins.
   * See: https://docs.aws.amazon.com/apigateway/latest/developerguide/how-to-cors.html
   */
  constructor(scope: Construct, id: string, props: ApiGatewayProps) {
    super(scope, id);

    const basicAuthorizerExecutionRole = new cdk.aws_iam.PolicyDocument({
      statements: [
        new cdk.aws_iam.PolicyStatement({
          actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams'],
          resources: [
            `arn:aws:logs:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:log-group:/aws/lambda/*:*`
          ]
        }),
        new cdk.aws_iam.PolicyStatement({
          actions: ['apigateway:GET'],
          resources: [
            `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:*`
          ]
        })
      ]
    });

    // R41.A.hotfix2 (2026-05-23) — DO NOT set an explicit `functionName`.
    //
    // Background: an earlier hotfix attempt set `functionName: 'tenant-api-
    // authorizer-prod'` to make the authorizer URI's function-name segment
    // literal at synth. That triggered Lambda REPLACEMENT (CFN rule:
    // setting/changing FunctionName requires replacement). Replacement
    // changes the Lambda ARN, which changes `TenantApiAuthorizerArn`
    // Output value, which CFN refuses to update while `analytics-stack`
    // actively imports it → "Cannot update export ... as it is in use".
    //
    // An attempted workaround (pinning `functionName` to the existing
    // CDK-auto-generated physical name) ALSO triggered replacement,
    // because CFN treats "FunctionName property was unset, now is set"
    // as a property change regardless of whether the new value matches
    // the existing physical name.
    //
    // The fix: leave functionName unset → CDK keeps the same logical-id-
    // derived auto-name → no replacement → no ARN change → no cross-stack
    // export update → no collision.
    //
    // The authorizer URI's function-name segment becomes a Stage variable
    // (`${stageVariables.authorizerFn}`); API Gateway substitutes it at
    // request time from the Stage.Variables map (which CFN populates
    // with the resolved Lambda function name at deploy time). region and
    // account_id stay literal at synth (API GW import-time ARN validator
    // requires literals in those slots; the docs+example confirm stage
    // vars ARE supported in the function-name slot specifically).
    //
    // The Lambda permission grant (`authorizerFunction.addPermission`
    // below) attaches to the Lambda's resource-policy regardless of the
    // function's name, so stage-var resolution does not cause a permission
    // mismatch — API GW resolves to the same physical Lambda the
    // permission was granted on.

    const authorizerFunction = new lambda_python.PythonFunction(this, 'AuthorizerFunction', {
      entry: path.join(__dirname, './Resources'),
      handler: 'lambda_handler',
      index: 'tenant_authorizer.py',
      runtime: lambda.Runtime.PYTHON_3_12,
      tracing: lambda.Tracing.ACTIVE,
      layers: [props.lambdaEcsSaaSLayers],
      logRetention: logs.RetentionDays.ONE_MONTH,
      // role setting
      role: new cdk.aws_iam.Role(this, 'AuthorizerFunctionRole', {
        assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
        inlinePolicies: { BasicAuthorizerExecutionRole: basicAuthorizerExecutionRole }
      }),
      environment: {
        IDP_DETAILS: JSON.stringify({
          name: 'Cognito'
        }),
        CORS_ALLOWED_ORIGINS: props.corsAllowedOrigins,
        ...{
          PREMIUM_TIER_API_KEY: props.apiKeyPremiumTier.value,
          ADVANCED_TIER_API_KEY: props.apiKeyAdvancedTier.value,
          BASIC_TIER_API_KEY: props.apiKeyBasicTier.value
        }
      }
    });
    if (!authorizerFunction.role?.roleArn) {
      throw new Error('AuthorizerFunction roleArn is undefined');
    }
    this.tenantScopedAccessRole = new cdk.aws_iam.Role(this, 'AuthorizerAccessRole', {
      assumedBy: new cdk.aws_iam.ArnPrincipal(authorizerFunction.role?.roleArn)
    });
    authorizerFunction.addEnvironment(
      'AUTHORIZER_ACCESS_ROLE',
      this.tenantScopedAccessRole.roleArn
    );
    // DEVELOPMENT COST OPTIMIZATION: CloudWatch Log Retention
    // API Gateway access logs can accumulate quickly
    // 7 days retention for development saves ~$2-5/month depending on traffic
    // PRODUCTION: Increase to 30+ days based on compliance requirements
    const logGroup = new LogGroup(this, 'PrdLogs', {
      retention: logs.RetentionDays.ONE_WEEK, // Development: 7 days (Production: 30+ days)
    });

    // Swagger/OpenAPI file path
    const swaggerFilePath = path.join(__dirname, '../tenant-api-prod.json');
    const swaggerContent = fs.readFileSync(swaggerFilePath, 'utf-8');

    // {{CORS_ALLOWED_ORIGIN}} uses only the first origin from the comma-separated
    // list for the static OPTIONS mock responses in the OpenAPI spec.
    // Multi-origin dynamic handling is done in the Lambda Authorizer at runtime,
    // which echoes back the matching origin from the full CORS_ALLOWED_ORIGINS list.
    const primaryCorsOrigin = props.corsAllowedOrigins.split(',')[0].trim();

    // R41.A — CFN headroom via Stage variables + fromAsset (2026-05-23).
    // See docs/pilot-greenlight/cfn-headroom-sprint-plan.md.
    //
    // The previous approach passed the substituted JSON (containing CDK
    // token markers like ${Token[NLB.DNS]}) to ApiDefinition.fromInline.
    // CDK's CFN serializer pattern-matched those tokens and inlined them
    // as CFN intrinsics (Fn::GetAtt) inside the AWS::ApiGateway::RestApi
    // Body property — putting the entire ~750KB Swagger into the CFN
    // template and pushing shared-infra-stack to 87.7% of the 1MB CFN
    // template hard limit.
    //
    // The fix: split the dynamic placeholders by where API Gateway
    // resolves them.
    //   - REQUEST-TIME: integration URI + connection ID. API GW substitutes
    //     ${stageVariables.*} from the Stage's variables map per request.
    //     These two placeholders become Stage variable markers.
    //   - IMPORT-TIME: authorizer URI region / account / function-name.
    //     API GW validates the authorizerUri ARN structure at spec import;
    //     stage variables in the region/account portions are rejected
    //     (`Invalid Authorizer URI`). These three values MUST be literal
    //     strings at synth time so the imported spec carries a valid ARN.
    //
    // To make the import-time values literal:
    //   - region    ← cdk.Stack.of(this).region   (literal when env-bound)
    //   - account   ← cdk.Stack.of(this).account  (literal when env-bound)
    //   - fn-name   ← `tenant-api-authorizer-${stageName}` (explicit name
    //                 set on the PythonFunction above)
    //
    // For region/account to resolve literal, the synth env MUST set
    // CDK_DEFAULT_REGION + CDK_DEFAULT_ACCOUNT. The deploy wrapper
    // (`scripts/deploy.sh`) exports them from the AWS profile.
    // Locally run `cdk synth` should `export CDK_DEFAULT_REGION=...` first.
    //
    // Hard-fail guard below detects the unset case (where `Stack.region`
    // would return a CDK token) and refuses to write a broken spec.
    const stack = cdk.Stack.of(this);
    if (cdk.Token.isUnresolved(stack.region) || cdk.Token.isUnresolved(stack.account)) {
      throw new Error(
        'R41.A requires CDK_DEFAULT_REGION and CDK_DEFAULT_ACCOUNT to be set ' +
        'in the synth environment so the authorizer URI in the API GW spec ' +
        'carries literal region/account values at import time. ' +
        'Set them in your shell before running cdk synth/deploy, or use the ' +
        'scripts/deploy.sh wrapper which exports them automatically.',
      );
    }

    const replacements: { [key: string]: string } = {
      '{{version}}': '1.0.0',
      '{{API_TITLE}}': 'EcsTenantAPI',
      '{{stage}}': props.stageName,
      '{{CORS_ALLOWED_ORIGIN}}': primaryCorsOrigin,
      // Request-time stage variables (substituted by API GW per request).
      // - integration URI / connection ID: documented for HTTP+VPCLink
      //   integrations
      // - authorizer function name: documented stage-var slot in the
      //   function-name portion of authorizerUri (region/account portions
      //   must stay literal — API GW validates the ARN at spec import)
      '{{connection_id}}': '${stageVariables.vpcLinkId}',
      '{{integration_uri}}': 'http://${stageVariables.nlbDns}',
      '{{authorizer_function}}': '${stageVariables.authorizerFn}',
      // Import-time literals (required for authorizerUri ARN validation).
      '{{region}}': stack.region,
      '{{account_id}}': stack.account,
    }

    let updateData = swaggerContent;
    for(const [placeholder, replacement] of Object.entries(replacements)) {
      const regex = new RegExp(placeholder, 'g');
      updateData = updateData.replace(regex, replacement);
    }

    // Write the substituted spec to disk so fromAsset can stage + upload
    // it to the CDK bootstrap asset bucket. The file contains zero CDK
    // tokens (the dynamic values are stage-variable text markers that API
    // GW resolves at request time). Place under cdk.out so it travels
    // with the cloud assembly and is gitignored.
    const cdkOutDir = cdk.App.of(this)?.outdir ?? path.join(process.cwd(), 'cdk.out');
    fs.mkdirSync(cdkOutDir, { recursive: true });
    const substitutedSpecPath = path.join(cdkOutDir, 'tenant-api-prod.substituted.json');
    fs.writeFileSync(substitutedSpecPath, updateData, 'utf-8');

    // Expose the authorizer function so downstream stacks can attach it to
    // additional methods (e.g., analytics-stack adding /analytics/* routes).
    (this as { -readonly [K in keyof this]: this[K] }).authorizerFunction =
      authorizerFunction;

    // API Gateway Rest API creation
    this.restApi = new apigateway.SpecRestApi(this, 'TenantApi', {
      restApiName: 'TenantAPI',
      description: 'API imported from a Swagger/OpenAPI definition (loaded from S3 asset; dynamic integration URI / connection ID / authorizer function resolved via Stage variables at request time)',
      apiDefinition: apigateway.ApiDefinition.fromAsset(substitutedSpecPath),
      cloudWatchRole: true,
      deployOptions: {
        accessLogDestination: new apigateway.LogGroupLogDestination(logGroup),
        methodOptions: {
          '/*/*': {
            // Security: dataTraceEnabled=true logs full
            // request/response bodies including auth credentials and student PII.
            // Must remain false in all environments.
            dataTraceEnabled: false,
            loggingLevel: apigateway.MethodLoggingLevel.ERROR,
          },
        },
        stageName: props.stageName,
        // Stage variables that resolve the 3 request-time-dynamic values
        // referenced by `${stageVariables.xxx}` markers in the imported
        // spec. CFN resolves these CDK token refs to concrete values at
        // deploy time; API Gateway substitutes them per request:
        //   - vpcLinkId   → integration connectionId (HTTP_PROXY/VPC_LINK)
        //   - nlbDns      → integration URI host
        //   - authorizerFn → authorizerUri function-name segment only
        //                    (region/account segments are literal in the
        //                    imported spec)
        //
        // region / accountId are NOT stage variables — they're literal
        // at synth time so authorizerUri's ARN passes API GW spec-import
        // validation.
        variables: {
          vpcLinkId: props.vpcLink.vpcLinkId,
          nlbDns: props.nlb.loadBalancerDnsName,
          authorizerFn: authorizerFunction.functionName,
        },
      },
    });

    // Set API Key Source Type using L1 construct
    const cfnRestApi = this.restApi.node.defaultChild as apigateway.CfnRestApi;
    cfnRestApi.apiKeySourceType = 'AUTHORIZER';

    // API Gateway writes ERROR-level *execution* logs to a group it creates
    // itself (`API-Gateway-Execution-Logs_<apiId>/<stage>`), separate from the
    // access log above, with no retention. LogRetention is a custom resource
    // that sets retention on an existing group, so it works whether or not
    // API Gateway has created it yet.
    new logs.LogRetention(this, 'ExecutionLogRetention', {
      logGroupName: `API-Gateway-Execution-Logs_${this.restApi.restApiId}/${props.stageName}`,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    authorizerFunction.addPermission('AuthorizerPermission', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${this.restApi.restApiId}/authorizers/*`
    });
  }
}
