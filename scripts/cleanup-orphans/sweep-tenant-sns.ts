/**
 * Sprint 0.5 T0.9b — Per-tenant SNS topic deletion (idempotent).
 *
 * THROWAWAY ops script. Will be productized as Sprint 5 T5.6.
 *
 * Deletes the per-tenant SNS topic created during provisioning:
 *   `edforge-alerts-tenant-<tenantId>`
 *
 * Idempotent: silently no-ops if the topic doesn't exist (some tenants like
 * prodtestadmin were provisioned before the SNS-topic feature was added).
 *
 * Refuses to touch operator-level topics:
 *   - edforge-alerts-operator
 *   - edforge-provisioning-alerts
 *
 * Safety:
 *   - Hardcoded refuse-list (Saraswati's tenantId)
 *   - Hardcoded whitelist (3 test tenant UUIDs)
 *   - Dry-run default; --apply required
 *   - Topic ARN must literally contain `edforge-alerts-tenant-<tenantId>` to be considered for deletion
 *
 * Usage:
 *   npx ts-node scripts/cleanup-orphans/sweep-tenant-sns.ts <tenantId>
 *   npx ts-node scripts/cleanup-orphans/sweep-tenant-sns.ts <tenantId> --apply
 */

import {
  SNSClient,
  ListTopicsCommand,
  DeleteTopicCommand,
  ListSubscriptionsByTopicCommand,
} from '@aws-sdk/client-sns';

const SARASWATI_TENANT_ID = '34f49822-ae1d-4188-95f0-04e14bc6c662';

const ALLOWED_TENANTS: readonly string[] = [
  '34392ed6-2e51-4fc8-ae2c-242eb5710e40',
  'fc9ea1c1-1cc2-45b3-b8c4-7e953e8e30d7',
  '04ce4a00-c39a-4185-afd4-6e764ef44647',
];

const REGION = process.env.AWS_REGION || 'ap-south-1';

const args = process.argv.slice(2);
const tenantId = args[0];
const apply = args.includes('--apply');

if (!tenantId) {
  console.error('Usage: sweep-tenant-sns.ts <tenantId> [--apply]');
  process.exit(2);
}

if (tenantId === SARASWATI_TENANT_ID) {
  console.error(`REFUSED: tenantId ${tenantId} is Saraswati. Aborting.`);
  process.exit(3);
}

if (!ALLOWED_TENANTS.includes(tenantId)) {
  console.error(`REFUSED: tenantId ${tenantId} is not in the test tenant whitelist. Aborting.`);
  process.exit(4);
}

const client = new SNSClient({ region: REGION });

async function findTopicArn(): Promise<string | null> {
  const targetFragment = `edforge-alerts-tenant-${tenantId}`;
  let nextToken: string | undefined;
  do {
    const r = await client.send(new ListTopicsCommand({ NextToken: nextToken }));
    for (const t of r.Topics || []) {
      if (t.TopicArn && t.TopicArn.includes(targetFragment)) {
        return t.TopicArn;
      }
    }
    nextToken = r.NextToken;
  } while (nextToken);
  return null;
}

async function main() {
  console.log(`\n=== Sweep tenant SNS topic: ${tenantId} ===`);
  console.log(`  Mode: ${apply ? 'APPLY (destructive)' : 'DRY-RUN'}`);

  const arn = await findTopicArn();
  if (!arn) {
    console.log('  Topic not found — nothing to do (idempotent no-op).');
    return;
  }

  console.log(`  Found topic: ${arn}`);

  // Defense in depth: re-confirm ARN matches the expected pattern before delete
  const expectedFragment = `edforge-alerts-tenant-${tenantId}`;
  if (!arn.includes(expectedFragment)) {
    console.error(`REFUSED: topic ARN ${arn} does not contain the expected fragment '${expectedFragment}'. Aborting.`);
    process.exit(5);
  }

  // Refuse operator-level topic patterns explicitly
  const FORBIDDEN_PATTERNS = ['edforge-alerts-operator', 'edforge-provisioning-alerts'];
  for (const f of FORBIDDEN_PATTERNS) {
    if (arn.includes(f)) {
      console.error(`REFUSED: topic ARN ${arn} matches operator-level forbidden pattern '${f}'. Aborting.`);
      process.exit(6);
    }
  }

  // Show subscriptions (operator visibility)
  const subs = await client.send(new ListSubscriptionsByTopicCommand({ TopicArn: arn }));
  console.log(`  Subscriptions: ${(subs.Subscriptions || []).length}`);
  for (const s of subs.Subscriptions || []) {
    console.log(`    ${s.Protocol}: ${s.Endpoint}`);
  }

  if (!apply) {
    console.log('  Dry-run — would delete topic + subscriptions on --apply.');
    return;
  }

  await client.send(new DeleteTopicCommand({ TopicArn: arn }));
  console.log(`  Deleted topic ${arn}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
