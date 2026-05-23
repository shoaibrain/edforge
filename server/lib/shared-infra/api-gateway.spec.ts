/**
 * CDK Template assertions for the ApiGateway construct (R41.A — CFN headroom
 * via Stage variables + fromAsset, sprint plan
 * `docs/pilot-greenlight/cfn-headroom-sprint-plan.md`).
 *
 * These assertions verify the construct emits the expected resource shape:
 *   1. The AWS::ApiGateway::RestApi uses `BodyS3Location` (asset) — not the
 *      inline `Body` property.
 *   2. The AWS::ApiGateway::Stage carries a `Variables` map with the 3
 *      expected keys (vpcLinkId, nlbDns, authorizerFn) populated with
 *      non-empty values (CDK token refs to the upstream resources).
 *   3. Exactly one RestApi is created.
 *   4. The synthesized template size is under 100KB — proving the CFN
 *      headroom recovery (down from ~877KB pre-R41.A).
 *
 * The construct is exercised inside a minimal harness stack that provides
 * the dependencies (VPC, NLB, VPC Link, Lambda layer).
 */

import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { PythonLayerVersion } from '@aws-cdk/aws-lambda-python-alpha';
import * as path from 'path';
import { ApiGateway } from './api-gateway';

function synth() {
  const app = new cdk.App();
  const stack = new cdk.Stack(app, 'ApiGatewayTestStack', {
    env: { account: '111111111111', region: 'ap-south-1' },
  });

  const vpc = new ec2.Vpc(stack, 'TestVpc', { maxAzs: 2 });
  const nlb = new elbv2.NetworkLoadBalancer(stack, 'TestNlb', {
    vpc,
    internetFacing: false,
  });
  const vpcLink = new cdk.aws_apigateway.VpcLink(stack, 'TestVpcLink', {
    targets: [nlb],
  });
  const lambdaLayers = new PythonLayerVersion(stack, 'TestLayers', {
    entry: path.join(__dirname, './layers'),
    compatibleRuntimes: [lambda.Runtime.PYTHON_3_10],
  });

  new ApiGateway(stack, 'TenantApiGateway', {
    lambdaEcsSaaSLayers: lambdaLayers,
    stageName: 'prod',
    nlb,
    vpcLink,
    corsAllowedOrigins: 'https://test.edforge.app',
    apiKeyBasicTier: { apiKeyId: 'basic-key-id', value: 'basic-key' },
    apiKeyAdvancedTier: { apiKeyId: 'advanced-key-id', value: 'advanced-key' },
    apiKeyPremiumTier: { apiKeyId: 'premium-key-id', value: 'premium-key' },
  });

  return { stack, template: Template.fromStack(stack), app };
}

describe('ApiGateway construct — R41.A CFN headroom assertions', () => {
  const { template, app } = synth();

  describe('AWS::ApiGateway::RestApi', () => {
    it('creates exactly ONE RestApi (no accidental duplication)', () => {
      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    it('uses BodyS3Location (asset-backed) — NOT inline Body', () => {
      // The whole point of R41.A: the 750KB Swagger spec lives in S3,
      // not in the CFN template Body property.
      template.hasResourceProperties(
        'AWS::ApiGateway::RestApi',
        Match.objectLike({
          Name: 'TenantAPI',
          BodyS3Location: Match.objectLike({
            // CDK asset hash is non-deterministic across machines; just
            // assert the structural shape (Bucket + Key are both present).
            Bucket: Match.anyValue(),
            Key: Match.anyValue(),
          }),
        }),
      );
    });

    it('does NOT carry an inline Body property (the CFN bloat fixed by R41.A)', () => {
      // Inline Body would re-introduce the 1MB CFN template ceiling
      // pressure. R41.A's contract is that this property never appears.
      const restApis = template.findResources('AWS::ApiGateway::RestApi');
      const restApiKeys = Object.keys(restApis);
      expect(restApiKeys).toHaveLength(1);
      const restApiProps = restApis[restApiKeys[0]].Properties;
      expect(restApiProps.Body).toBeUndefined();
    });
  });

  describe('AWS::ApiGateway::Stage', () => {
    it('carries Stage.Variables with the 5 expected keys (R41.A stage variables)', () => {
      // The 5 dynamic placeholders (NLB DNS, VPC Link ID, authorizer fn
      // name, region, accountId) are now stage-variable references. API
      // Gateway substitutes them at request time from this Variables map.
      // Region + accountId are stage-var-resolved because `app.region` /
      // `app.account` are CDK tokens when env isn't explicitly bound at
      // App-construct time (the ecs-saas-ref-template.ts case).
      template.hasResourceProperties(
        'AWS::ApiGateway::Stage',
        Match.objectLike({
          StageName: 'prod',
          Variables: Match.objectLike({
            nlbDns: Match.anyValue(),
            vpcLinkId: Match.anyValue(),
            authorizerFn: Match.anyValue(),
            region: Match.anyValue(),
            accountId: Match.anyValue(),
          }),
        }),
      );
    });

    it('Stage.Variables values are non-empty + the 3 resource-bound ones are CFN refs', () => {
      // Goal: prove every value is bound to its intended source.
      // - vpcLinkId / nlbDns / authorizerFn: must be CFN refs/GetAtts to
      //   the upstream resources (Fn::GetAtt, Ref) — objects, not strings.
      //   A plain string here would mean R41.A inadvertently froze the
      //   value at synth time.
      // - region / accountId: depends on env binding. If the App was
      //   instantiated with explicit `env: { account, region }`, the
      //   Stack returns literal strings (test stack case). If env is
      //   unbound (production app case, via `app.region`/`app.account`
      //   which resolve to tokens), the Stack returns CDK tokens that
      //   serialize as Ref(AWS::Region) / Ref(AWS::AccountId). Both
      //   behaviors are correct at deploy time — CFN resolves either
      //   form to a literal string before passing to API GW.
      const stages = template.findResources('AWS::ApiGateway::Stage');
      const stageKeys = Object.keys(stages);
      expect(stageKeys.length).toBeGreaterThanOrEqual(1);
      const variables = stages[stageKeys[0]].Properties.Variables;

      // The 3 resource-bound values must be CFN refs (objects).
      expect(typeof variables.nlbDns).toBe('object');
      expect(typeof variables.vpcLinkId).toBe('object');
      expect(typeof variables.authorizerFn).toBe('object');

      // The 2 environment-bound values must be either string literals
      // (explicit env) OR CFN refs (token env). Either form is correct
      // at deploy time.
      expect(['string', 'object']).toContain(typeof variables.region);
      expect(['string', 'object']).toContain(typeof variables.accountId);
      // If it's an object, it must be the expected pseudo-param ref.
      if (typeof variables.region === 'object') {
        expect(variables.region).toEqual({ Ref: 'AWS::Region' });
      }
      if (typeof variables.accountId === 'object') {
        expect(variables.accountId).toEqual({ Ref: 'AWS::AccountId' });
      }
      // Critically: no value is empty / undefined.
      for (const key of ['nlbDns', 'vpcLinkId', 'authorizerFn', 'region', 'accountId']) {
        expect(variables[key]).toBeDefined();
        expect(variables[key]).not.toBe('');
      }
    });
  });

  describe('CFN template size — R41.A headroom assertion', () => {
    it('synthesized template body is well under 100KB (down from ~877KB pre-R41.A)', () => {
      // The whole goal of R41.A is to recover CFN template headroom.
      // The pre-R41.A inline Body alone was 750KB. With fromAsset, the
      // entire template (including all the test-harness VPC/NLB/Lambda
      // boilerplate) should fit in well under 100KB.
      //
      // Note: this is the TEST stack template (includes VPC + NLB +
      // authorizer Lambda layer + API Gateway). The real shared-infra-
      // stack template is larger because it has more resources; the
      // R41.A win is that the API Gateway portion is now bounded by the
      // BodyS3Location pointer size, not by the spec content size.
      const templateJson = JSON.stringify(template.toJSON());
      expect(templateJson.length).toBeLessThan(100_000);
    });
  });

  describe('CDK asset staging (R41.A artifact)', () => {
    it('writes the substituted Swagger to cdk.out/tenant-api-prod.substituted.json', () => {
      // The construct writes the substituted spec to the CDK output dir
      // so fromAsset can stage it. Verify the file was written + contains
      // the expected stage-variable markers (proving the 3 token-bearing
      // placeholders were rewritten as stage vars, not pre-resolved).
      const fs = require('fs');
      const path = require('path');
      const cdkOutDir = app.outdir;
      const substitutedPath = path.join(
        cdkOutDir,
        'tenant-api-prod.substituted.json',
      );
      expect(fs.existsSync(substitutedPath)).toBe(true);
      const content: string = fs.readFileSync(substitutedPath, 'utf-8');
      // The 3 stage-variable markers must appear; the original tokens
      // must NOT.
      expect(content).toMatch(/\$\{stageVariables\.nlbDns\}/);
      expect(content).toMatch(/\$\{stageVariables\.vpcLinkId\}/);
      expect(content).toMatch(/\$\{stageVariables\.authorizerFn\}/);
      expect(content).toMatch(/\$\{stageVariables\.region\}/);
      expect(content).toMatch(/\$\{stageVariables\.accountId\}/);
      // No remaining {{...}} placeholders.
      expect(content).not.toMatch(/\{\{integration_uri\}\}/);
      expect(content).not.toMatch(/\{\{connection_id\}\}/);
      expect(content).not.toMatch(/\{\{authorizer_function\}\}/);
      expect(content).not.toMatch(/\{\{region\}\}/);
      expect(content).not.toMatch(/\{\{account_id\}\}/);
      // Critically: NO leftover ${Token[...]} markers. These would
      // indicate that a CDK token was string-interpolated into the spec
      // and would be uploaded to S3 literally — breaking API GW import.
      expect(content).not.toMatch(/\$\{Token\[/);
    });
  });
});
