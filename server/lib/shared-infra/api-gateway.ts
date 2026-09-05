
import * as lambda_python from '@aws-cdk/aws-lambda-python-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { type CustomApiKey } from '../interfaces/custom-api-key';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as path from 'path';
import * as logs from 'aws-cdk-lib/aws-logs';

interface ApiGatewayProps {
  lambdaEcsSaaSLayers: lambda.LayerVersion
  corsAllowedOrigins: string
  apiKeyBasicTier: CustomApiKey
  apiKeyAdvancedTier: CustomApiKey
  apiKeyPremiumTier: CustomApiKey
}

export class ApiGateway extends Construct {
  public readonly tenantScopedAccessRole: cdk.aws_iam.Role;
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
    (this as { -readonly [K in keyof this]: this[K] }).authorizerFunction =
      authorizerFunction;

    // API Gateway Rest API creation
  }
}
