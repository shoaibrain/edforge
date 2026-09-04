import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { grantApiBInvoke } from './api-b-invoke';

describe('grantApiBInvoke (C2.5 / C2.7)', () => {
  it('adds one apigateway.amazonaws.com permission scoped to the imported API-B id, every stage/method/path', () => {
    const stack = new cdk.Stack(new cdk.App(), 'T', { env: { account: '111111111111', region: 'ap-south-1' } });
    const fn = new lambda.Function(stack, 'Fn', { runtime: lambda.Runtime.NODEJS_22_X, handler: 'index.handler', code: lambda.Code.fromInline('exports.handler=async()=>({})') });
    grantApiBInvoke(fn);
    const t = Template.fromStack(stack);
    t.resourceCountIs('AWS::Lambda::Permission', 1);
    t.hasResourceProperties('AWS::Lambda::Permission', {
      Action: 'lambda:InvokeFunction',
      Principal: 'apigateway.amazonaws.com',
      FunctionName: { 'Fn::GetAtt': [Match.stringLikeRegexp('^Fn'), 'Arn'] },
      SourceArn: {
        'Fn::Join': ['', ['arn:aws:execute-api:ap-south-1:111111111111:', { 'Fn::ImportValue': 'TenantApiLambdaRestApiId' }, '/*/*/*']],
      },
    });
  });
});
