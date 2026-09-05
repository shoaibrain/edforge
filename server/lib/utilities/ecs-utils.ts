import * as cdk from 'aws-cdk-lib';
import { IdentityDetails } from '../interfaces/identity-details';

/**
 * Environment every service function gets regardless of service-info.json:
 * region, account and the pooled Cognito pool/client. Key order is part of
 * the CloudFormation output; do not reorder.
 */
export function defaultServiceEnvironment(
  stack: cdk.Stack,
  idpDetails: IdentityDetails,
): Record<string, string> {
  return {
    AWS_REGION: cdk.Stack.of(stack).region,
    AWS_ACCOUNT_ID: cdk.Stack.of(stack).account,
    COGNITO_USER_POOL_ID: idpDetails.details.userPoolId,
    COGNITO_CLIENT_ID: idpDetails.details.appClientId,
    COGNITO_REGION: cdk.Stack.of(stack).region,
  };
}
