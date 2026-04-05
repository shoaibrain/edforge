
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

    const replacements: { [key: string]: string } = {
      '{{version}}': '1.0.0',
      '{{API_TITLE}}': 'EcsTenantAPI',
      '{{stage}}': props.stageName,
      '{{connection_id}}': props.vpcLink.vpcLinkId,
      '{{integration_uri}}': `http://${props.nlb.loadBalancerDnsName}`,
      '{{region}}': cdk.Stack.of(this).region,
      '{{account_id}}': cdk.Stack.of(this).account,
      '{{authorizer_function}}': authorizerFunction.functionName,
      '{{CORS_ALLOWED_ORIGIN}}': primaryCorsOrigin
    }

    let updateData = swaggerContent;
    for(const [placeholder, replacement] of Object.entries(replacements)) {
      const regex = new RegExp(placeholder, 'g');
      updateData = updateData.replace(regex, replacement);
    }
    // console.log('updateData: ' + updateData);
    
    // API Gateway Rest API creation
    this.restApi = new apigateway.SpecRestApi(this, 'TenantApi', {
      restApiName: 'TenantAPI',
      description: 'API imported from a Swagger/OpenAPI definition with placeholders replaced',
      apiDefinition: apigateway.ApiDefinition.fromInline(JSON.parse(updateData)),
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
