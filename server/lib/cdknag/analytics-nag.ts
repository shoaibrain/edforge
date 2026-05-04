/**
 * CDK-Nag suppressions for AnalyticsStack (Layers 2 + 6).
 *
 * Same pattern as control-plane-nag.ts / shared-infra-nag.ts: add stack-level
 * suppressions with a per-rule `reason` string so future reviewers see the
 * justification without digging through git history.
 *
 * Every suppression below corresponds to a concrete finding surfaced by
 * `CDK_NAG_ENABLED=true AWS_PROFILE=prod npx cdk diff analytics-stack`.
 * Add new suppressions in response to new findings — never blanket-suppress
 * a rule globally without a reason line.
 */

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { NagSuppressions } from 'cdk-nag';

export class AnalyticsNag extends Construct {
  constructor(scope: Construct, id: string) {
    super(scope, id);

    NagSuppressions.addStackSuppressions(cdk.Stack.of(this), [
      {
        id: 'AwsSolutions-IAM4',
        reason:
          'AWS-managed AWSLambdaBasicExecutionRole is used for the aggregator, rollup, and log-retention helper Lambdas. Basic-execution only grants CloudWatch Logs access — acceptable per the repo-wide policy set in control-plane-nag.ts and shared-infra-nag.ts.',
      },
      {
        id: 'AwsSolutions-IAM5',
        reason:
          'Wildcards on (a) DynamoDB table index ARNs (analytics-table/index/*) are required because GSI1 queries must hit the index path; (b) cloudwatch:PutMetricData which does not support resource-level ARNs (AWS limitation — we DO scope by namespace via a condition key); (c) Lambda ARN :* for log group creation on first invocation. Same justification pattern as control-plane-nag.ts.',
      },
      {
        id: 'AwsSolutions-L1',
        reason:
          'Aggregator and rollup Lambdas use Node.js 20.x runtime. Node 20 is a current LTS and matches the repo-wide standard (see tenant-seeder-lambda.ts on Node 22.x — the analytics stack will move to 22 in the next runtime upgrade pass, batched with the rest of the fleet).',
      },
      {
        id: 'AwsSolutions-SQS3',
        reason:
          'AggregatorDLQ IS itself a dead-letter queue — it collects events the aggregator Lambda cannot process. cdk-nag cannot tell it is a DLQ from the construct graph because we do not currently wire it as a deadLetterQueue on any downstream construct. Adding a DLQ-for-the-DLQ would be nonsensical.',
      },
      {
        id: 'AwsSolutions-SQS4',
        reason:
          'AggregatorDLQ is only written to by the aggregator Lambda running in the same VPC/region; no external publishers. TLS-only policy adds no security for this in-account, same-region path. Consistent with how the existing EventBridgeDLQ in event-dlq-stack.ts is configured.',
      },
      {
        id: 'AwsSolutions-SNS3',
        reason:
          'OperatorAlertTopic receives alarm notifications from CloudWatch (same-account service principal) and delivers to Email subscriptions. No external publishers. TLS-only topic policy adds no security for this path; CloudWatch already uses TLS to SNS.',
      },
      {
        id: 'AwsSolutions-COG4',
        reason:
          'The 5 analytics read-path API GW methods (/analytics/tenants/{tenantId}, /analytics/tenants/{tenantId}/adoption-report, /analytics/tenants/{tenantId}/export-csv-url, /analytics/fleet, /analytics/me/session-history) use a Lambda TokenAuthorizer that validates Cognito-issued JWTs and enforces tenant-scoped claim checks. Sprint 2 intentionally switched from the built-in Cognito authorizer because RequestAuthorizer could not express the tenantPath/role constraints we need. JWT verification still happens against the Cognito user pool — cdk-nag cannot see this through a Lambda authorizer.',
      },
      {
        id: 'AwsSolutions-S1',
        reason:
          'ExportBucket (edforge-analytics-exports-<account>-<region>) holds short-lived CSV exports with a 1-day lifecycle expiration, BlockPublicAccess=BLOCK_ALL, SSE-S3 encryption, and enforceSSL. Exports are only retrievable via presigned URLs issued by the analytics API Lambda. Server access logging is additive IR forensics, not a blocker pre-pilot. Follow-up: enable access logging pointing at shared-infra-stack accessLogsBucket before scaling beyond the pilot school.',
      },
    ]);
  }
}
