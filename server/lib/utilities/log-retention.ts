import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct, IConstruct } from 'constructs';

/**
 * Attach a retention policy to the log group of every `lambda.Function`
 * found under `root` that does not already declare one.
 *
 * Third-party constructs (the SBT control plane) create Lambda functions
 * without `logRetention`, so their `/aws/lambda/<name>` groups never expire.
 * `logs.LogRetention` is a custom resource that sets retention on an existing
 * group (or creates it), which is the only mechanism that works for groups
 * Lambda already created. Functions that set `logRetention` themselves carry a
 * `LogRetention` child and are skipped so two custom resources never fight
 * over one group.
 */
export function applyLogRetentionToFunctions(
  scope: Construct,
  root: IConstruct,
  retention: logs.RetentionDays,
): lambda.Function[] {
  const applied: lambda.Function[] = [];
  for (const node of root.node.findAll()) {
    if (!(node instanceof lambda.Function)) continue;
    if (node.node.tryFindChild('LogRetention')) continue;
    new logs.LogRetention(scope, `LogRetention-${node.node.addr}`, {
      logGroupName: `/aws/lambda/${node.functionName}`,
      retention,
    });
    applied.push(node);
  }
  return applied;
}
