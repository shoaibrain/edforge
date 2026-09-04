import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';
import { UsagePlans } from './usage-plans';

export interface ApiGatewayLambdaProps {
  stageName: string;
  /** Still needed: finance stays on the VPC link until Sprint 5. */
  nlb: elbv2.INetworkLoadBalancer;
  vpcLink: apigateway.VpcLink;
  corsAllowedOrigins: string;
  /**
   * The authorizer API-A already runs (`ApiGateway.authorizerFunction`). It is
   * referenced, never re-created: its logical ID and physical name must not
   * move (R41.A.hotfix2, the export-lock incident of 2026-05-23).
   */
  authorizerFunction: lambda.IFunction;
  /** Stage variable → deterministic function name (utilities/function-names.ts). */
  functionNames: Record<'identityFn' | 'academicsFn' | 'financeFn' | 'analyticsFn', string>;
  /** The three tier keys API-A's usage plans already carry; a key may belong to several plans. */
  apiKeyBasicTier: apigateway.ApiKey;
  apiKeyAdvancedTier: apigateway.ApiKey;
  apiKeyPremiumTier: apigateway.ApiKey;
}

/**
 * API-B — the strangler REST API (cost-redesign C2.4, TARGET §2).
 *
 * Imports the generated `tenant-api-lambda.json` (C2.2) with the placeholder
 * mechanism API-A uses: request-time values are stage-variable markers, the
 * authorizer URI's region/account are literal at synth. Seven stage
 * variables: the three API-A has (`vpcLinkId`, `nlbDns`, `authorizerFn`) plus
 * one per service function. Each function grants `apigateway.amazonaws.com`
 * invoke scoped to this API's ARN in its own stack (C2.5, C2.7) — the
 * documented requirement for stage-variable-resolved integrations.
 *
 * API-A is untouched by this construct; the only change it sees is one
 * more statement on the authorizer's resource policy.
 */
export class ApiGatewayLambda extends Construct {
  public readonly restApi: apigateway.SpecRestApi;
  public readonly substitutedSpecPath: string;

  constructor(scope: Construct, id: string, props: ApiGatewayLambdaProps) {
    super(scope, id);

    const stack = cdk.Stack.of(this);
    if (cdk.Token.isUnresolved(stack.region) || cdk.Token.isUnresolved(stack.account)) {
      throw new Error(
        'API-B needs CDK_DEFAULT_REGION and CDK_DEFAULT_ACCOUNT in the synth environment: the ' +
          'authorizer and Lambda integration URIs must carry literal region/account at import time.',
      );
    }

    const specPath = path.join(__dirname, '../tenant-api-lambda.json');
    const primaryCorsOrigin = props.corsAllowedOrigins.split(',')[0].trim();
    const replacements: Record<string, string> = {
      '{{version}}': '1.0.0',
      '{{API_TITLE}}': 'TenantAPILambda',
      '{{stage}}': props.stageName,
      '{{CORS_ALLOWED_ORIGIN}}': primaryCorsOrigin,
      '{{connection_id}}': '${stageVariables.vpcLinkId}',
      '{{integration_uri}}': 'http://${stageVariables.nlbDns}',
      '{{authorizer_function}}': '${stageVariables.authorizerFn}',
      '{{region}}': stack.region,
      '{{account_id}}': stack.account,
    };
    let body = fs.readFileSync(specPath, 'utf-8');
    for (const [placeholder, value] of Object.entries(replacements)) body = body.split(placeholder).join(value);
    const leftover = body.match(/\{\{[A-Za-z_]+\}\}/);
    if (leftover) throw new Error(`API-B spec still carries the placeholder ${leftover[0]} after substitution`);

    const cdkOutDir = cdk.App.of(this)?.outdir ?? path.join(process.cwd(), 'cdk.out');
    fs.mkdirSync(cdkOutDir, { recursive: true });
    this.substitutedSpecPath = path.join(cdkOutDir, 'tenant-api-lambda.substituted.json');
    fs.writeFileSync(this.substitutedSpecPath, body, 'utf-8');

    const accessLogs = new logs.LogGroup(this, 'AccessLogs', { retention: logs.RetentionDays.ONE_WEEK });

    this.restApi = new apigateway.SpecRestApi(this, 'TenantApiLambda', {
      restApiName: 'TenantAPILambda',
      description: 'EdForge tenant API on Lambda (strangler API-B; generated from tenant-api-prod.json + route-map.json)',
      apiDefinition: apigateway.ApiDefinition.fromAsset(this.substitutedSpecPath),
      // The account-level CloudWatch role already exists (API-A creates it);
      // a second AWS::ApiGateway::Account in the stack would fight it.
      cloudWatchRole: false,
      minCompressionSize: cdk.Size.kibibytes(1),
      deployOptions: {
        stageName: props.stageName,
        accessLogDestination: new apigateway.LogGroupLogDestination(accessLogs),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: false, httpMethod: true, ip: false, protocol: false, requestTime: true,
          resourcePath: true, responseLength: true, status: true, user: false,
        }),
        methodOptions: {
          '/*/*': { dataTraceEnabled: false, loggingLevel: apigateway.MethodLoggingLevel.ERROR },
        },
        variables: {
          vpcLinkId: props.vpcLink.vpcLinkId,
          nlbDns: props.nlb.loadBalancerDnsName,
          authorizerFn: props.authorizerFunction.functionName,
          ...props.functionNames,
        },
      },
    });

    (this.restApi.node.defaultChild as apigateway.CfnRestApi).apiKeySourceType = 'AUTHORIZER';

    new logs.LogRetention(this, 'ExecutionLogRetention', {
      logGroupName: `API-Gateway-Execution-Logs_${this.restApi.restApiId}/${props.stageName}`,
      retention: logs.RetentionDays.ONE_MONTH,
    });

    props.authorizerFunction.addPermission('ApiBAuthorizerPermission', {
      principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
      sourceArn: `arn:aws:execute-api:${stack.region}:${stack.account}:${this.restApi.restApiId}/authorizers/*`,
    });

    // Same quotas as API-A, bound to this stage, same keys — the authorizer's
    // usageIdentifierKey therefore identifies the tier on both APIs.
    new UsagePlans(this, 'UsagePlans', {
      apiGateway: this.restApi,
      apiKeyBasicTier: props.apiKeyBasicTier,
      apiKeyAdvancedTier: props.apiKeyAdvancedTier,
      apiKeyPremiumTier: props.apiKeyPremiumTier,
    });
  }
}
