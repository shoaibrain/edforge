import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as lambda from 'aws-cdk-lib/aws-lambda';
import { API_B_REST_API_ID_EXPORT } from './function-names';

/**
 * Let API-B invoke a function it reaches through a stage variable
 * (cost-redesign C2.5 / C2.7). A stage-variable-resolved integration gets
 * no automatic permission, so each function grants apigateway.amazonaws.com
 * scoped to API-B's ARN for every stage, method and path. The REST API id
 * is imported from shared-infra, which therefore deploys first.
 */
export function grantApiBInvoke(fn: lambda.IFunction, id = 'ApiBInvoke'): void {
  const stack = cdk.Stack.of(fn);
  fn.addPermission(id, {
    principal: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    sourceArn: `arn:aws:execute-api:${stack.region}:${stack.account}:${cdk.Fn.importValue(API_B_REST_API_ID_EXPORT)}/*/*/*`,
  });
}
