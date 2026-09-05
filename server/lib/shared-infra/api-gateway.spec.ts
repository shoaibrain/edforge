/**
 * The `ApiGateway` construct holds only the shared tenant authorizer since
 * cost-redesign C6.3 (API-A, its access log, validator and usage plans are
 * gone; API-B in `api-gateway-lambda.ts` references the function). The
 * construct id and the function's construct path are unchanged so the
 * deployed authorizer keeps its logical id and physical name.
 */
import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import * as path from 'path';
import { ApiGateway } from './api-gateway';

function synth() {
  // An empty bundling-stacks list makes CDK stage placeholder assets for the
  // Python function and layer instead of invoking Docker.
  const app = new cdk.App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const stack = new cdk.Stack(app, 'ApiGatewayTestStack', {
    env: { account: '111111111111', region: 'ap-south-1' },
  });
  const lambdaLayers = new PythonLayerVersion(stack, 'TestLayers', {
    entry: path.join(__dirname, './layers'),
    compatibleRuntimes: [lambda.Runtime.PYTHON_3_12],
  });
  const construct = new ApiGateway(stack, 'TenantApiGateway', {
    lambdaEcsSaaSLayers: lambdaLayers,
    corsAllowedOrigins: 'https://test.edforge.app',
    apiKeyBasicTier: { apiKeyId: 'basic-key-id', value: 'basic-key' },
    apiKeyAdvancedTier: { apiKeyId: 'advanced-key-id', value: 'advanced-key' },
    apiKeyPremiumTier: { apiKeyId: 'premium-key-id', value: 'premium-key' },
  });
  return { construct, template: Template.fromStack(stack) };
}

describe('ApiGateway construct — shared tenant authorizer only (C6.3)', () => {
  const { construct, template } = synth();

  it('creates no REST API, stage, deployment or usage plan', () => {
    template.resourceCountIs('AWS::ApiGateway::RestApi', 0);
    template.resourceCountIs('AWS::ApiGateway::Stage', 0);
    template.resourceCountIs('AWS::ApiGateway::Deployment', 0);
    template.resourceCountIs('AWS::ApiGateway::UsagePlan', 0);
  });

  it('runs the authorizer on python3.12 with tracing, the three tier keys and the CORS origins in its environment', () => {
    template.hasResourceProperties('AWS::Lambda::Function', Match.objectLike({
      Runtime: 'python3.12',
      TracingConfig: { Mode: 'Active' },
      Environment: {
        Variables: Match.objectLike({
          CORS_ALLOWED_ORIGINS: 'https://test.edforge.app',
          BASIC_TIER_API_KEY: 'basic-key',
          ADVANCED_TIER_API_KEY: 'advanced-key',
          PREMIUM_TIER_API_KEY: 'premium-key',
          AUTHORIZER_ACCESS_ROLE: Match.anyValue(),
        }),
      },
    }));
    expect(construct.authorizerFunction).toBeDefined();
  });

  it('gives the authorizer a tenant-scoped access role it alone may assume', () => {
    template.hasResourceProperties('AWS::IAM::Role', Match.objectLike({
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Action: 'sts:AssumeRole', Principal: { AWS: Match.anyValue() } }),
        ]),
      }),
    }));
    expect(construct.tenantScopedAccessRole).toBeDefined();
  });

  it('keeps 30-day retention on the authorizer log group and nothing else to retain', () => {
    template.resourceCountIs('Custom::LogRetention', 1);
    template.hasResourceProperties('Custom::LogRetention', { RetentionInDays: 30 });
  });
});
