/**
 * S1.T13 — Lambda concurrency quota pre-flight check.
 *
 * During Layer 2 deploy, we discovered the UAT account's
 * ConcurrentExecutions quota is 10 (reduced from AWS default 1000).
 * The analytics-api Lambda needs reservedConcurrentExecutions: 5.
 * Plus the aggregator + rollup. If the account is tight, deploys
 * fail with "UnreservedConcurrentExecutions below its minimum value".
 *
 * This script refuses to proceed if quota < MIN_REQUIRED.
 *
 * Usage:
 *   AWS_PROFILE=uat AWS_REGION=us-east-2 \
 *     npx ts-node scripts/analytics/check-lambda-quota.ts
 *
 *   # Override threshold:
 *   MIN_REQUIRED=50 AWS_PROFILE=uat ... ts-node ...
 */

import {
  ServiceQuotasClient,
  GetServiceQuotaCommand,
} from '@aws-sdk/client-service-quotas';
import {
  LambdaClient,
  GetAccountSettingsCommand,
} from '@aws-sdk/client-lambda';

const MIN_REQUIRED = Number(process.env.MIN_REQUIRED || '30');
const QUOTA_CODE_CONCURRENT_EXECUTIONS = 'L-B99A9384';

async function main() {
  const sqc = new ServiceQuotasClient({});
  const lambda = new LambdaClient({});

  const quota = await sqc.send(
    new GetServiceQuotaCommand({
      ServiceCode: 'lambda',
      QuotaCode: QUOTA_CODE_CONCURRENT_EXECUTIONS,
    }),
  );
  const quotaValue = quota.Quota?.Value ?? 0;
  console.log(`Account quota (ConcurrentExecutions): ${quotaValue}`);

  const settings = await lambda.send(new GetAccountSettingsCommand({}));
  const unreserved = settings.AccountLimit?.UnreservedConcurrentExecutions ?? 0;
  const total = settings.AccountLimit?.ConcurrentExecutions ?? 0;
  console.log(
    `Current state: total=${total} unreserved=${unreserved} reserved-used=${total - unreserved}`,
  );
  console.log(`Threshold: MIN_REQUIRED=${MIN_REQUIRED}`);

  if (quotaValue < MIN_REQUIRED) {
    console.error(
      `\n❌ Lambda quota too low. Request a raise via ` +
        `aws service-quotas request-service-quota-increase ` +
        `--service-code lambda --quota-code ${QUOTA_CODE_CONCURRENT_EXECUTIONS} ` +
        `--desired-value 1000`,
    );
    process.exit(1);
  }

  if (unreserved < 15) {
    console.warn(
      `\n⚠️  Only ${unreserved} unreserved concurrency slots left. ` +
        `Deploying a new reserved Lambda may fail. Investigate existing reservations:`,
    );
    console.warn(
      `  aws lambda list-functions --query 'Functions[?ReservedConcurrentExecutions!=\`null\`].[FunctionName,ReservedConcurrentExecutions]'`,
    );
    process.exit(2);
  }

  console.log('\n✅ Lambda concurrency is adequate for analytics-api deploy.');
}

main().catch((e) => {
  console.error('check-lambda-quota failed:', e);
  process.exit(1);
});
