import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import { applyLogRetentionToFunctions } from './log-retention';

const inline = (scope: Construct, id: string, extra: Partial<lambda.FunctionProps> = {}) =>
  new lambda.Function(scope, id, {
    runtime: lambda.Runtime.NODEJS_22_X,
    handler: 'index.handler',
    code: lambda.Code.fromInline('exports.handler = async () => ({});'),
    ...extra,
  });

describe('applyLogRetentionToFunctions (C0.5)', () => {
  it('adds a LogRetention custom resource for every function under the root', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'T');
    const root = new Construct(stack, 'ThirdParty');
    inline(root, 'A');
    inline(new Construct(root, 'Nested'), 'B');

    const applied = applyLogRetentionToFunctions(stack, root, logs.RetentionDays.ONE_MONTH);

    expect(applied.map((f) => f.node.id).sort()).toEqual(['A', 'B']);
    const t = Template.fromStack(stack);
    t.resourceCountIs('Custom::LogRetention', 2);
    t.hasResourceProperties('Custom::LogRetention', {
      RetentionInDays: 30,
      LogGroupName: Match.objectLike({ 'Fn::Join': Match.anyValue() }),
    });
  });

  it('skips functions that already declare their own retention', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'T');
    const root = new Construct(stack, 'ThirdParty');
    inline(root, 'Managed', { logRetention: logs.RetentionDays.FIVE_DAYS });
    inline(root, 'Unmanaged');

    const applied = applyLogRetentionToFunctions(stack, root, logs.RetentionDays.ONE_MONTH);

    expect(applied.map((f) => f.node.id)).toEqual(['Unmanaged']);
    const t = Template.fromStack(stack);
    t.resourceCountIs('Custom::LogRetention', 2);
    t.hasResourceProperties('Custom::LogRetention', { RetentionInDays: 5 });
    t.hasResourceProperties('Custom::LogRetention', { RetentionInDays: 30 });
  });

  it('is a no-op when the root holds no functions', () => {
    const app = new cdk.App();
    const stack = new cdk.Stack(app, 'T');
    const root = new Construct(stack, 'Empty');
    expect(applyLogRetentionToFunctions(stack, root, logs.RetentionDays.ONE_MONTH)).toEqual([]);
    Template.fromStack(stack).resourceCountIs('Custom::LogRetention', 0);
  });
});
