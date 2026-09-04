import { App, Stack } from 'aws-cdk-lib';
import { defaultServiceEnvironment } from './ecs-utils';

/**
 * C1.6 (review fix) — the ECS container definition and the service Lambda
 * read the region/account/Cognito defaults from one builder. Key order is
 * part of the container definition's CloudFormation output.
 */
describe('defaultServiceEnvironment', () => {
  it('returns the five defaults in the container-definition order', () => {
    const stack = new Stack(new App(), 'T', { env: { account: '111111111111', region: 'ap-south-1' } });
    const env = defaultServiceEnvironment(stack, {
      name: 'idp', details: { userPoolId: 'ap-south-1_POOL', appClientId: 'client123' },
    } as never);
    expect(Object.keys(env)).toEqual(['AWS_REGION', 'AWS_ACCOUNT_ID', 'COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_ID', 'COGNITO_REGION']);
    expect(env.COGNITO_USER_POOL_ID).toBe('ap-south-1_POOL');
    expect(env.COGNITO_CLIENT_ID).toBe('client123');
    expect(env.AWS_REGION).toBe('ap-south-1');
  });
});
