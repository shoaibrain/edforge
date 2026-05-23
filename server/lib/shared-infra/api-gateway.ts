
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
   * Required Origins (for future production lockdown):
   * - https://edforge.app (production - S3 + CloudFront)
   * - https://www.edforge.app (production)
   * - http://localhost:3000-3008 (local dev - MFE apps)
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

    const authorizerFunction = new lambda_python.PythonFunction(this, 'AuthorizerFunction', {
      entry: path.join(__dirname, './Resources'),
      handler: 'lambda_handler',
      index: 'tenant_authorizer.py',
      runtime: lambda.Runtime.PYTHON_3_10,
      tracing: lambda.Tracing.ACTIVE,
      layers: [props.lambdaEcsSaaSLayers],
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
    let swaggerContent = fs.readFileSync(swaggerFilePath, 'utf-8');

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
    // The fix: every placeholder whose value is a CDK token at synth
    // time becomes an API Gateway Stage variable marker
    // (`${stageVariables.xxx}`). API GW substitutes them at request time
    // from the Stage variables map set in deployOptions below. CFN
    // resolves the Stage.Variables CDK tokens to literal strings at
    // deploy time. Everything else (static strings, CORS origin) gets
    // substituted at synth time.
    //
    // The 5 token-bearing placeholders are:
    //   - {{connection_id}}      → ${stageVariables.vpcLinkId}
    //   - {{integration_uri}}    → http://${stageVariables.nlbDns}
    //   - {{authorizer_function}} → ${stageVariables.authorizerFn}
    //   - {{region}}             → ${stageVariables.region}    (app.region is a CDK token when env unset)
    //   - {{account_id}}         → ${stageVariables.accountId} (app.account is a CDK token when env unset)
    //
    // Token-binding check (verified empirically 2026-05-23): writing
    // CDK tokens via JS string interpolation captures their literal
    // ${Token[...]} marker text, which would be uploaded to S3 verbatim
    // — API GW would reject the malformed authorizerUri. Stage variables
    // are the only path that preserves CFN-side token resolution.
    const replacements: { [key: string]: string } = {
      '{{version}}': '1.0.0',
      '{{API_TITLE}}': 'EcsTenantAPI',
      '{{stage}}': props.stageName,
      '{{CORS_ALLOWED_ORIGIN}}': primaryCorsOrigin,
      // The 5 token-bearing placeholders become Stage variable markers.
      '{{connection_id}}': '${stageVariables.vpcLinkId}',
      '{{integration_uri}}': 'http://${stageVariables.nlbDns}',
      '{{authorizer_function}}': '${stageVariables.authorizerFn}',
      '{{region}}': '${stageVariables.region}',
      '{{account_id}}': '${stageVariables.accountId}',
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
        // Stage variables that resolve the 5 deploy-time-dynamic values
        // referenced by `${stageVariables.xxx}` markers in the imported
        // spec. CFN resolves these CDK token refs to concrete values at
        // deploy time; API Gateway substitutes them into integration
        // URIs / connectionId / authorizerUri at request time.
        variables: {
          vpcLinkId: props.vpcLink.vpcLinkId,
          nlbDns: props.nlb.loadBalancerDnsName,
          authorizerFn: authorizerFunction.functionName,
          region: cdk.Stack.of(this).region,
          accountId: cdk.Stack.of(this).account,
        },
      },
    });

    // Set API Key Source Type using L1 construct
    const cfnRestApi = this.restApi.node.defaultChild as apigateway.CfnRestApi;
    cfnRestApi.apiKeySourceType = 'AUTHORIZER';

    authorizerFunction.addPermission('AuthorizerPermission', {
      principal: new cdk.aws_iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:${this.restApi.restApiId}/authorizers/*`
    });
  }
}
