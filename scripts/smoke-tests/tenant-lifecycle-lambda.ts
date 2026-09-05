/**
 * Cost-redesign C7.4 — verify a tenant's lifecycle state after the
 * provisioner or deprovisioner ran.
 *
 *   TENANT_ID=<uuid> EXPECT=provisioned   npx tsx scripts/smoke-tests/tenant-lifecycle-lambda.ts
 *   TENANT_ID=<uuid> EXPECT=deprovisioned npx tsx scripts/smoke-tests/tenant-lifecycle-lambda.ts
 *
 * provisioned: the Cognito group exists with at least one user, the tenant
 * alert topic exists, the identity METADATA row carries tenantTag and
 * alertTopicArn, and SETTINGS#WORKSPACE exists.
 * deprovisioned: the group and the topic are gone and the tenant partition is
 * empty in the identity, academics and finance tables.
 *
 * Read-only: ReadOnlyAccess is enough. Exit 0 when every check holds.
 */
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { CognitoIdentityProviderClient, GetGroupCommand, ListUsersInGroupCommand } from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, GetItemCommand, QueryCommand } from '@aws-sdk/client-dynamodb';
import { SNSClient, GetTopicAttributesCommand } from '@aws-sdk/client-sns';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';

const region = process.env.AWS_REGION ?? 'ap-south-1';
const tenantId = process.env.TENANT_ID ?? '';
const expect = (process.env.EXPECT ?? 'provisioned') as 'provisioned' | 'deprovisioned';
const stackName = process.env.TENANT_STACK_NAME ?? 'tenant-template-stack-basic';
const tables = ['edforge-identity-basic', 'edforge-academics-basic', 'edforge-finance-basic'];

const cfn = new CloudFormationClient({ region });
const cognito = new CognitoIdentityProviderClient({ region });
const ddb = new DynamoDBClient({ region });
const sns = new SNSClient({ region });
const sts = new STSClient({ region });

type Check = { name: string; ok: boolean; detail: string };
const checks: Check[] = [];
const record = (name: string, ok: boolean, detail: string) => checks.push({ name, ok, detail });

async function exists<T>(call: () => Promise<T>, notFound: string[]): Promise<boolean> {
  try {
    await call();
    return true;
  } catch (err) {
    if (notFound.includes((err as { name?: string }).name ?? '')) return false;
    throw err;
  }
}

async function main(): Promise<void> {
  if (!tenantId) throw new Error('TENANT_ID is required');
  const outputs = Object.fromEntries(
    ((await cfn.send(new DescribeStacksCommand({ StackName: stackName }))).Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]),
  );
  const userPoolId = outputs.TenantUserpoolId;
  if (!userPoolId) throw new Error(`${stackName} has no TenantUserpoolId output`);
  const account = (await sts.send(new GetCallerIdentityCommand({}))).Account;
  const topicArn = `arn:aws:sns:${region}:${account}:edforge-alerts-tenant-${tenantId}`;

  const groupExists = await exists(() => cognito.send(new GetGroupCommand({ UserPoolId: userPoolId, GroupName: tenantId })), ['ResourceNotFoundException']);
  const topicExists = await exists(() => sns.send(new GetTopicAttributesCommand({ TopicArn: topicArn })), ['NotFoundException']);
  const metadata = (await ddb.send(new GetItemCommand({ TableName: tables[0], Key: { tenantId: { S: tenantId }, entityKey: { S: 'METADATA' } } }))).Item;

  if (expect === 'provisioned') {
    record('cognito group exists', groupExists, tenantId);
    const users = groupExists ? (await cognito.send(new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: tenantId }))).Users ?? [] : [];
    record('tenant admin in the group', users.length >= 1, `${users.length} user(s)`);
    record('tenant alert topic exists', topicExists, topicArn);
    record('identity METADATA row', !!metadata, metadata ? `tenantTag=${metadata.tenantTag?.S ?? '(none)'} archetype=${metadata.archetype?.S ?? '(none)'}` : 'missing');
    record('METADATA carries alertTopicArn', metadata?.alertTopicArn?.S === topicArn, metadata?.alertTopicArn?.S ?? '(none)');
    record('METADATA carries a tenantTag', !!metadata?.tenantTag?.S, metadata?.tenantTag?.S ?? '(none)');
    const settings = (await ddb.send(new GetItemCommand({ TableName: tables[0], Key: { tenantId: { S: tenantId }, entityKey: { S: 'SETTINGS#WORKSPACE' } } }))).Item;
    record('SETTINGS#WORKSPACE row', !!settings, settings ? 'present' : 'missing');
  } else {
    record('cognito group gone', !groupExists, tenantId);
    record('tenant alert topic gone', !topicExists, topicArn);
    for (const table of tables) {
      const count = (await ddb.send(new QueryCommand({ TableName: table, KeyConditionExpression: 'tenantId = :t', ExpressionAttributeValues: { ':t': { S: tenantId } }, Select: 'COUNT' }))).Count ?? 0;
      record(`${table} partition empty`, count === 0, `${count} item(s)`);
    }
  }

  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name} — ${c.detail}`);
  const failed = checks.filter((c) => !c.ok).length;
  console.log(`${checks.length - failed}/${checks.length} checks passed (EXPECT=${expect})`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
