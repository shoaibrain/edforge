import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { App, Stack } from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { LambdaService } from './lambda-service';

/**
 * C1.6 — one Lambda function per service, sized for a CPU-bound Nest
 * bootstrap, outside the VPC, with the logs grant the ECS execution role
 * used to carry.
 */
function synth(serviceName = 'identity') {
  const asset = fs.mkdtempSync(path.join(os.tmpdir(), 'edforge-lambda-asset-'));
  fs.writeFileSync(path.join(asset, 'index.js'), 'exports.handler = async () => ({ statusCode: 200 });');
  const app = new App();
  const stack = new Stack(app, 'T', { env: { account: '111111111111', region: 'ap-south-1' } });
  const svc = new LambdaService(stack, `${serviceName}-Lambda`, {
    serviceName,
    tier: 'basic',
    assetPath: asset,
    environment: { TABLE_NAME: 'edforge-identity-basic', IAM_ROLE_ARN: 'arn:aws:iam::111111111111:role/abac' },
  });
  return { t: Template.fromStack(stack), svc };
}

describe('LambdaService (C1.6)', () => {
  it('creates a nodejs22 function at 1,769 MB / 29 s, outside any VPC, with the runtime flag set', () => {
    const { t, svc } = synth();
    expect(svc.functionName).toBe('edforge-identity-basic-api');
    // (the LogRetention custom-resource provider is a second function in the template)
    t.hasResourceProperties('AWS::Lambda::Function', {
      FunctionName: 'edforge-identity-basic-api',
      Runtime: 'nodejs22.x',
      Handler: 'index.handler',
      MemorySize: 1769,
      Timeout: 29,
      Architectures: ['x86_64'],
      Environment: {
        Variables: Match.objectLike({
          EDFORGE_RUNTIME: 'lambda',
          TABLE_NAME: 'edforge-identity-basic',
          IAM_ROLE_ARN: 'arn:aws:iam::111111111111:role/abac',
        }),
      },
    });
    const fn = Object.values(t.findResources('AWS::Lambda::Function', { Properties: { FunctionName: 'edforge-identity-basic-api' } }))[0] as { Properties: Record<string, unknown> };
    expect(fn).toBeDefined();
    expect(fn.Properties.VpcConfig).toBeUndefined();
  });

  it('gives the role the Lambda basic execution policy (CloudWatch Logs) — the grant a custom role does not get by default', () => {
    const { t } = synth();
    t.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({ Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' }),
        ]),
      }),
      ManagedPolicyArns: Match.arrayWith([
        Match.objectLike({
          'Fn::Join': Match.arrayWith([
            Match.arrayWith([Match.stringLikeRegexp('service-role/AWSLambdaBasicExecutionRole')]),
          ]),
        }),
      ]),
    });
  });

  it('sets 30-day log retention on the function log group', () => {
    const { t } = synth();
    t.hasResourceProperties('Custom::LogRetention', { RetentionInDays: 30 });
  });
});
