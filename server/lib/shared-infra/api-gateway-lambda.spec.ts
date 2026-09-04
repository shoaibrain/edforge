import * as fs from 'fs';
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { ApiGatewayLambda } from './api-gateway-lambda';
import { stageVariableFunctionNames } from '../utilities/function-names';

/**
 * C2.4 — API-B is a second SpecRestApi from the generated spec, with seven
 * stage variables, the shared authorizer referenced (not re-created),
 * compression, binary media types, and its own usage plans on the same keys.
 */
function synth() {
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new cdk.Stack(app, 'ApiBTestStack', { env: { account: '111111111111', region: 'ap-south-1' } });
  const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
  const nlb = new elbv2.NetworkLoadBalancer(stack, 'Nlb', { vpc, internetFacing: false });
  const vpcLink = new apigateway.VpcLink(stack, 'VpcLink', { targets: [nlb] });
  const authorizer = new lambda.Function(stack, 'Authorizer', {
    runtime: lambda.Runtime.PYTHON_3_12, handler: 'index.handler', code: lambda.Code.fromInline('def handler(e, c): pass'),
  });
  const key = (id: string) => new apigateway.ApiKey(stack, id);
  const api = new ApiGatewayLambda(stack, 'ApiB', {
    stageName: 'prod', nlb, vpcLink, corsAllowedOrigins: 'https://app.example.test,https://preview.example.test',
    authorizerFunction: authorizer, functionNames: stageVariableFunctionNames('basic'),
    apiKeyBasicTier: key('Basic'), apiKeyAdvancedTier: key('Advanced'), apiKeyPremiumTier: key('Premium'),
  });
  return { template: Template.fromStack(stack), api };
}

describe('ApiGatewayLambda (C2.4)', () => {
  const { template, api } = synth();

  it('is one asset-backed RestApi named TenantAPILambda with compression and the authorizer as API key source', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    template.hasResourceProperties('AWS::ApiGateway::RestApi', Match.objectLike({
      Name: 'TenantAPILambda',
      BodyS3Location: Match.objectLike({ Bucket: Match.anyValue(), Key: Match.anyValue() }),
      MinimumCompressionSize: 1024,
      ApiKeySourceType: 'AUTHORIZER',
    }));
    const [props] = Object.values(template.findResources('AWS::ApiGateway::RestApi')).map((r) => r.Properties);
    expect(props.Body).toBeUndefined();
  });

  it('carries exactly seven stage variables: the three API-A has plus one literal name per function', () => {
    const [stage] = Object.values(template.findResources('AWS::ApiGateway::Stage')).map((r) => r.Properties);
    expect(stage.StageName).toBe('prod');
    expect(Object.keys(stage.Variables).sort()).toEqual(['academicsFn', 'analyticsFn', 'authorizerFn', 'financeFn', 'identityFn', 'nlbDns', 'vpcLinkId']);
    expect(stage.Variables.identityFn).toBe('edforge-identity-basic-api');
    expect(stage.Variables.academicsFn).toBe('edforge-academics-basic-api');
    expect(stage.Variables.financeFn).toBe('edforge-finance-basic-api');
    expect(stage.Variables.analyticsFn).toBe('edforge-analytics-api');
    expect(typeof stage.Variables.authorizerFn).toBe('object');
    expect(typeof stage.Variables.vpcLinkId).toBe('object');
    expect(typeof stage.Variables.nlbDns).toBe('object');
  });

  it('references the existing authorizer function (no new function) and grants it invoke from this API only', () => {
    template.resourceCountIs('AWS::Lambda::Function', 2); // the fake authorizer + the LogRetention provider
    template.hasResourceProperties('AWS::Lambda::Permission', Match.objectLike({
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com',
      SourceArn: Match.objectLike({ 'Fn::Join': Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp('^arn:aws:execute-api:ap-south-1:111111111111:'), '/authorizers/*'])]) }),
    }));
  });

  it('binds three usage plans with API-A\'s quotas to its stage, on the given keys', () => {
    template.resourceCountIs('AWS::ApiGateway::UsagePlan', 3);
    template.resourceCountIs('AWS::ApiGateway::UsagePlanKey', 3);
    template.hasResourceProperties('AWS::ApiGateway::UsagePlan', Match.objectLike({ Quota: { Limit: 25000, Period: 'DAY' }, Throttle: { BurstLimit: 50, RateLimit: 50 } }));
  });

  it('substitutes every placeholder: literal region/account in the URIs, stage-variable markers elsewhere, binary types at the root', () => {
    const body = fs.readFileSync(api.substitutedSpecPath, 'utf8');
    expect(body).not.toMatch(/\{\{[A-Za-z_]+\}\}/);
    const spec = JSON.parse(body);
    expect(spec['x-amazon-apigateway-binary-media-types']).toEqual(['application/pdf', 'application/zip', 'application/octet-stream']);
    expect(spec.info.title).toBe('TenantAPILambda');
    expect(spec.basePath).toBe('/prod');
    expect(spec.securityDefinitions.sharedApigatewayTenantApiAuthorizer['x-amazon-apigateway-authorizer'].authorizerUri)
      .toBe('arn:aws:apigateway:ap-south-1:lambda:path/2015-03-31/functions/arn:aws:lambda:ap-south-1:111111111111:function:${stageVariables.authorizerFn}/invocations');
    let aws = 0, http = 0, mock = 0;
    for (const item of Object.values(spec.paths) as Record<string, { 'x-amazon-apigateway-integration': { type: string; uri?: string; connectionId?: string } }>[]) {
      for (const [m, op] of Object.entries(item)) {
        const i = op['x-amazon-apigateway-integration'];
        if (m === 'options') { mock++; continue; }
        if (i.type === 'aws_proxy') { aws++; expect(i.uri).toMatch(/^arn:aws:apigateway:ap-south-1:lambda:path\/2015-03-31\/functions\/arn:aws:lambda:ap-south-1:111111111111:function:\$\{stageVariables\.(identityFn|academicsFn|financeFn|analyticsFn)\}\/invocations$/); }
        else if (i.type === 'http_proxy') { http++; expect(i.uri).toMatch(/^http:\/\/\$\{stageVariables\.nlbDns\}\/finance\//); expect(i.connectionId).toBe('${stageVariables.vpcLinkId}'); }
      }
    }
    expect({ aws, http, mock }).toEqual({ aws: 346, http: 70, mock: 287 });
    expect(body).toContain("'https://app.example.test'");
  });

  it('exposes a base URL without a trailing slash (callers append /path)', () => {
    const resolved = cdk.Stack.of(api).resolve(api.baseUrl) as { 'Fn::Join': [string, unknown[]] };
    const parts = resolved['Fn::Join'][1];
    expect(parts[0]).toBe('https://');
    expect(parts).toContain('.execute-api.ap-south-1.');
    expect(parts[parts.length - 1]).toBe('/prod'); // stage, no trailing slash
  });

  it('keeps access logs a week and sets a month on the execution log group', () => {
    template.hasResourceProperties('AWS::Logs::LogGroup', { RetentionInDays: 7 });
    template.hasResourceProperties('Custom::LogRetention', { RetentionInDays: 30, LogGroupName: Match.objectLike({ 'Fn::Join': Match.arrayWith([Match.arrayWith([Match.stringLikeRegexp('^API-Gateway-Execution-Logs_')])]) }) });
  });

  it('refuses to synthesize without a bound environment (region/account must be literal)', () => {
    const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
    const stack = new cdk.Stack(app, 'Unbound');
    const vpc = new ec2.Vpc(stack, 'Vpc', { maxAzs: 2 });
    const nlb = new elbv2.NetworkLoadBalancer(stack, 'Nlb', { vpc });
    expect(() => new ApiGatewayLambda(stack, 'ApiB', {
      stageName: 'prod', nlb, vpcLink: new apigateway.VpcLink(stack, 'VpcLink', { targets: [nlb] }), corsAllowedOrigins: 'https://x',
      authorizerFunction: new lambda.Function(stack, 'A', { runtime: lambda.Runtime.PYTHON_3_12, handler: 'i.h', code: lambda.Code.fromInline('x') }),
      functionNames: stageVariableFunctionNames('basic'),
      apiKeyBasicTier: new apigateway.ApiKey(stack, 'B'), apiKeyAdvancedTier: new apigateway.ApiKey(stack, 'Ad'), apiKeyPremiumTier: new apigateway.ApiKey(stack, 'P'),
    })).toThrow(/CDK_DEFAULT_REGION/);
  });
});
