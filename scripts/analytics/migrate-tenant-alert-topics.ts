/**
 * Layer 3.1 — one-time migration to backfill per-tenant SNS alert topics
 * for existing tenants whose provisioning pre-dated the Layer 3 changes.
 *
 * For every METADATA row in the identity table that lacks `alertTopicArn`:
 *   1. Create (or reuse) `edforge-alerts-tenant-{tenantId}` SNS topic.
 *   2. Subscribe the tenant's `contactEmail` via the Email protocol.
 *   3. UpdateItem to attach `alertTopicArn` to the tenant METADATA row.
 *
 * Idempotent end-to-end:
 *   - SNS `CreateTopic` returns existing ARN when the topic already exists.
 *   - SNS `Subscribe` dedupes on (protocol, endpoint) for the same topic.
 *   - DynamoDB UpdateItem only runs when `alertTopicArn` is absent.
 *
 * Usage:
 *   AWS_PROFILE=prod AWS_REGION=ap-south-1 \
 *     npx ts-node scripts/analytics/migrate-tenant-alert-topics.ts [--dry-run] [--table edforge-identity-basic]
 *
 * Default mode prints the planned actions without mutating anything.
 * Pass `--execute` to actually perform writes.
 */

import {
  DynamoDBClient,
  ScanCommand,
  UpdateItemCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  SNSClient,
  CreateTopicCommand,
  SubscribeCommand,
} from '@aws-sdk/client-sns';

interface Args {
  execute: boolean;
  table: string;
}

function parseArgs(): Args {
  const a = process.argv.slice(2);
  const args: Args = { execute: false, table: 'edforge-identity-basic' };
  for (let i = 0; i < a.length; i++) {
    if (a[i] === '--execute') args.execute = true;
    else if (a[i] === '--dry-run') args.execute = false;
    else if (a[i] === '--table' && a[i + 1]) args.table = a[++i];
  }
  return args;
}

interface TenantRow {
  tenantId: string;
  contactEmail: string | null;
  alertTopicArn: string | null;
  name: string | null;
}

async function scanTenants(ddb: DynamoDBClient, table: string): Promise<TenantRow[]> {
  const rows: TenantRow[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  do {
    const r = await ddb.send(
      new ScanCommand({
        TableName: table,
        FilterExpression: 'entityKey = :k',
        ExpressionAttributeValues: { ':k': { S: 'METADATA' } },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of r.Items || []) {
      rows.push({
        tenantId: item.tenantId?.S || '(missing)',
        contactEmail: item.contactEmail?.S ?? null,
        alertTopicArn: item.alertTopicArn?.S ?? null,
        name: item.name?.S ?? null,
      });
    }
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return rows;
}

async function ensureTopic(sns: SNSClient, tenantId: string): Promise<string> {
  const r = await sns.send(
    new CreateTopicCommand({ Name: `edforge-alerts-tenant-${tenantId}` }),
  );
  if (!r.TopicArn) {
    throw new Error(`CreateTopic returned no ARN for tenant ${tenantId}`);
  }
  return r.TopicArn;
}

async function ensureSubscription(
  sns: SNSClient,
  topicArn: string,
  email: string,
): Promise<void> {
  // SNS subscribe is idempotent per (TopicArn, Protocol, Endpoint).
  await sns.send(
    new SubscribeCommand({
      TopicArn: topicArn,
      Protocol: 'email',
      Endpoint: email,
      ReturnSubscriptionArn: true,
    }),
  );
}

async function attachArn(
  ddb: DynamoDBClient,
  table: string,
  tenantId: string,
  topicArn: string,
): Promise<void> {
  await ddb.send(
    new UpdateItemCommand({
      TableName: table,
      Key: {
        tenantId: { S: tenantId },
        entityKey: { S: 'METADATA' },
      },
      UpdateExpression: 'SET alertTopicArn = :arn, updatedAt = :ts',
      ConditionExpression: 'attribute_exists(tenantId) AND attribute_not_exists(alertTopicArn)',
      ExpressionAttributeValues: {
        ':arn': { S: topicArn },
        ':ts': { S: new Date().toISOString() },
      },
    }),
  );
}

async function main() {
  const args = parseArgs();
  const ddb = new DynamoDBClient({});
  const sns = new SNSClient({});

  console.log(`Scanning table ${args.table} for tenants…`);
  const tenants = await scanTenants(ddb, args.table);
  console.log(`Found ${tenants.length} tenant METADATA row(s).`);

  const needsWork = tenants.filter((t) => !t.alertTopicArn);
  const skipped = tenants.filter((t) => t.alertTopicArn);
  console.log(`  ${needsWork.length} need alertTopicArn provisioned.`);
  console.log(`  ${skipped.length} already provisioned (skipped).`);

  if (needsWork.length === 0) {
    console.log('Nothing to do.');
    return;
  }

  const mode = args.execute ? 'EXECUTE' : 'DRY-RUN';
  console.log(`\nMode: ${mode}`);

  let created = 0;
  let attached = 0;
  let failed = 0;

  for (const t of needsWork) {
    const label = `${t.tenantId} (${t.name ?? 'unnamed'})`;
    if (!t.contactEmail) {
      console.warn(`  SKIP ${label}: no contactEmail on METADATA row`);
      failed++;
      continue;
    }

    if (!args.execute) {
      console.log(
        `  [dry-run] Would create edforge-alerts-tenant-${t.tenantId}, subscribe ${t.contactEmail}, attach ARN to ${args.table}`,
      );
      continue;
    }

    try {
      const arn = await ensureTopic(sns, t.tenantId);
      created++;
      await ensureSubscription(sns, arn, t.contactEmail);
      await attachArn(ddb, args.table, t.tenantId, arn);
      attached++;
      console.log(`  OK   ${label}: ${arn}`);
    } catch (e) {
      const err = e as Error;
      if (err.name === 'ConditionalCheckFailedException') {
        console.log(`  SKIP ${label}: alertTopicArn already attached (raced)`);
      } else {
        console.error(`  FAIL ${label}: ${err.message}`);
        failed++;
      }
    }
  }

  console.log('');
  console.log(`Summary: ${args.execute ? `created/reused=${created}, attached=${attached}, failed=${failed}` : `${needsWork.length} would be provisioned (pass --execute to run)`}`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('migrate-tenant-alert-topics failed:', e);
  process.exit(1);
});
