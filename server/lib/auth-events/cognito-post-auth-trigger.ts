/**
 * C0a — Cognito PostAuthentication trigger CDK construct.
 *
 * Bundles the trigger Lambda, wires it to a Cognito UserPool, and grants
 * the minimal IAM needed to publish to the analytics EventBridge bus.
 *
 * PLACEMENT NOTE (2026-04-17):
 *   Attach this to the TENANT user pool (one per tier), NOT the control-plane
 *   pool. EdForge has three pools:
 *     - control-plane pool (`CognitoAuthUserPool`)   — system admins only
 *     - BASIC tenant pool  (`basicUserPool`)          — all BASIC-tier users
 *     - Advanced tenant pool (`advancedUserPool`)     — post-V1
 *   A first attempt wired this to the control-plane pool and emitted zero
 *   LoginSuccess events because no real users log in there. Correct site is
 *   `identityProvider.tenantUserPool` inside tenant-template-stack.
 *
 * Usage (tenant-template-stack.ts):
 *   new CognitoPostAuthTrigger(this, 'CognitoLoginEmitter', {
 *     userPool: identityProvider.tenantUserPool,
 *     eventBusName: props.eventBusName,
 *     functionNameSuffix: props.tier.toLowerCase(), // basic / advanced
 *   });
 *
 * Why this lives in `auth-events/` instead of `analytics/`:
 *   The Lambda is part of the IDENTITY domain (it fires on user
 *   authentication), even though its only side-effect is an analytics
 *   event today. Future auth-related triggers (PreTokenGeneration for
 *   custom claims, PostConfirmation for welcome emails) belong here too.
 */

import * as cdk from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambdaNodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface CognitoPostAuthTriggerProps {
  /** The Cognito UserPool to attach the trigger to. */
  userPool: cognito.UserPool;
  /** Name of the EventBridge bus the Lambda emits to. */
  eventBusName: string;
  /**
   * Suffix appended to the Lambda function name (e.g. `basic`, `advanced`).
   * Each tier attaches its own instance; suffixing keeps names unique within
   * the account + makes per-tier log groups trivial to find.
   */
  functionNameSuffix?: string;
}

export class CognitoPostAuthTrigger extends Construct {
  public readonly lambda: lambdaNodejs.NodejsFunction;

  constructor (scope: Construct, id: string, props: CognitoPostAuthTriggerProps) {
    super(scope, id);

    const region = cdk.Stack.of(this).region;
    const account = cdk.Stack.of(this).account;
    const eventBusArn = `arn:aws:events:${region}:${account}:event-bus/${props.eventBusName}`;

    const nameSuffix = props.functionNameSuffix
      ? `-${props.functionNameSuffix}`
      : '';
    this.lambda = new lambdaNodejs.NodejsFunction(this, 'Function', {
      functionName: `edforge-cognito-post-auth-emitter${nameSuffix}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      entry: path.join(__dirname, 'lambda/post-auth/handler.ts'),
      handler: 'handler',
      memorySize: 256,
      // PostAuthentication triggers run synchronously on the login path —
      // Cognito waits for our return. Keep timeout tight so a hung
      // EventBridge call can't make logins feel slow. The handler swallows
      // errors anyway, so on actual failure the user just sees a normal
      // login latency.
      timeout: cdk.Duration.seconds(5),
      // Sprint 5 (T5.2): reduced ONE_MONTH → TWO_WEEKS. Login analytics
      // beyond two weeks rarely needs CloudWatch Logs lookback (the
      // analytics table provides the long-term store).
      logRetention: logs.RetentionDays.TWO_WEEKS,
      environment: {
        EVENT_BUS_NAME: props.eventBusName,
      },
      description:
        'C0a (2026-04-16): emits LoginSuccess to the analytics bus on every ' +
        'successful Cognito authentication. Parity replacement for the orphaned ' +
        'identity-service auth.service.login() emit path that was bypassed by ' +
        'the saas-frontend Amplify direct sign-in flow.',
    });

    // IAM — minimal: events:PutEvents on the analytics bus only. No Cognito
    // permissions needed; Cognito invokes us, not the other way around.
    this.lambda.addToRolePolicy(
      new iam.PolicyStatement({
        sid: 'AnalyticsBusPutEvents',
        effect: iam.Effect.ALLOW,
        actions: ['events:PutEvents'],
        resources: [eventBusArn],
      }),
    );

    // Wire as the PostAuthentication trigger on the user pool. CDK
    // automatically grants Cognito the lambda:InvokeFunction permission.
    props.userPool.addTrigger(
      cognito.UserPoolOperation.POST_AUTHENTICATION,
      this.lambda,
    );
  }
}
