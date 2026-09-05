/**
 * Cost-redesign C7.2 — deprovisions a BASIC tenant when SBT emits
 * `sbt_aws_offboardingRequest`: every Cognito user in the tenant group, the
 * group, every item of the tenant partition in the three service tables and
 * the tenant alert topic, then `sbt_aws_deprovisionSuccess`.
 *
 * Default-deny (D7.4): a tenant with no identity METADATA row, no tenantTag
 * or the `production` tag is refused unless the request carries
 * `confirmProduction: true`, which only scripts/tenant/offboard.ts sets. A
 * refusal emits `sbt_aws_deprovisionFailure`, alerts the operator and
 * returns; unexpected errors are emitted as failures and thrown.
 */
import type { Context, EventBridgeEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminDeleteUserCommand,
  DeleteGroupCommand,
  ListUsersInGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { DynamoDBClient, GetItemCommand, QueryCommand, BatchWriteItemCommand, type AttributeValue, type WriteRequest } from '@aws-sdk/client-dynamodb';
import { SNSClient, DeleteTopicCommand, PublishCommand } from '@aws-sdk/client-sns';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  PermanentFailure,
  DEPROVISION_FAILURE_STATUS,
  chunk,
  deprovisionRefusal,
  deprovisionSuccessDetail,
  lifecycleFailureDetail,
  tenantAlertTopicName,
  type OffboardingDetail,
} from './sbt-lifecycle';

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? '';
const EVENT_SOURCE = process.env.EVENT_SOURCE ?? 'sbt.application.plane';
const SUCCESS_DETAIL_TYPE = process.env.SUCCESS_DETAIL_TYPE ?? 'sbt_aws_deprovisionSuccess';
const FAILURE_DETAIL_TYPE = process.env.FAILURE_DETAIL_TYPE ?? 'sbt_aws_deprovisionFailure';
const TENANT_STACK_NAME = process.env.TENANT_STACK_NAME ?? 'tenant-template-stack-basic';
const IDENTITY_TABLE = process.env.IDENTITY_TABLE_NAME ?? 'edforge-identity-basic';
const TABLES = [IDENTITY_TABLE, process.env.ACADEMICS_TABLE_NAME ?? 'edforge-academics-basic', process.env.FINANCE_TABLE_NAME ?? 'edforge-finance-basic'];
const PROVISIONING_ALERT_TOPIC_ARN = process.env.PROVISIONING_ALERT_TOPIC_ARN ?? '';
const TENANT_ALERT_TOPIC_PREFIX = process.env.TENANT_ALERT_TOPIC_PREFIX ?? 'edforge-alerts-tenant-';

const cognito = new CognitoIdentityProviderClient({});
const ddb = new DynamoDBClient({});
const sns = new SNSClient({});
const eventBridge = new EventBridgeClient({});
const cloudFormation = new CloudFormationClient({});

let userPoolIdPromise: Promise<string> | undefined;

export function tenantUserPoolId(): Promise<string> {
  if (!userPoolIdPromise) {
    userPoolIdPromise = (async () => {
      const res = await cloudFormation.send(new DescribeStacksCommand({ StackName: TENANT_STACK_NAME }));
      const id = res.Stacks?.[0]?.Outputs?.find((o) => o.OutputKey === 'TenantUserpoolId')?.OutputValue;
      if (!id) throw new Error(`${TENANT_STACK_NAME} has no TenantUserpoolId output`);
      return id;
    })().catch((err) => {
      userPoolIdPromise = undefined;
      throw err;
    });
  }
  return userPoolIdPromise;
}

function log(level: 'info' | 'warn' | 'error', msg: string, ctx: Record<string, unknown>): void {
  const line = JSON.stringify({ level, msg, ...ctx });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

function errorName(err: unknown): string {
  return (err as { name?: string })?.name ?? '';
}

async function readMetadata(tenantId: string): Promise<{ tenantTag?: string } | undefined> {
  const res = await ddb.send(
    new GetItemCommand({
      TableName: IDENTITY_TABLE,
      Key: { tenantId: { S: tenantId }, entityKey: { S: 'METADATA' } },
      ProjectionExpression: 'tenantTag',
    }),
  );
  if (!res.Item) return undefined;
  return { tenantTag: res.Item.tenantTag?.S };
}

async function deleteUsersAndGroup(userPoolId: string, tenantId: string): Promise<number> {
  let deleted = 0;
  let nextToken: string | undefined;
  do {
    let page;
    try {
      page = await cognito.send(new ListUsersInGroupCommand({ UserPoolId: userPoolId, GroupName: tenantId, NextToken: nextToken }));
    } catch (err) {
      if (errorName(err) === 'ResourceNotFoundException') return deleted;
      throw err;
    }
    for (const user of page.Users ?? []) {
      if (!user.Username) continue;
      try {
        await cognito.send(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: user.Username }));
        deleted += 1;
      } catch (err) {
        if (errorName(err) !== 'UserNotFoundException') throw err;
      }
    }
    nextToken = page.NextToken;
  } while (nextToken);
  try {
    await cognito.send(new DeleteGroupCommand({ UserPoolId: userPoolId, GroupName: tenantId }));
  } catch (err) {
    if (errorName(err) !== 'ResourceNotFoundException') throw err;
  }
  return deleted;
}

/** Deletes every item whose partition key is the tenant, 25 at a time, retrying unprocessed keys. */
async function deleteTenantPartition(tableName: string, tenantId: string): Promise<number> {
  let deleted = 0;
  let lastKey: Record<string, AttributeValue> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: 'tenantId = :t',
        ExpressionAttributeValues: { ':t': { S: tenantId } },
        ProjectionExpression: 'tenantId, entityKey',
        ExclusiveStartKey: lastKey,
      }),
    );
    const keys = (page.Items ?? []).map((item) => ({ tenantId: item.tenantId, entityKey: item.entityKey }));
    for (const batch of chunk(keys, 25)) {
      let requests: WriteRequest[] = batch.map((Key) => ({ DeleteRequest: { Key } }));
      for (let attempt = 0; requests.length > 0; attempt++) {
        if (attempt > 5) throw new Error(`BatchWriteItem left ${requests.length} unprocessed deletes on ${tableName}`);
        if (attempt > 0) await new Promise((r) => setTimeout(r, 100 * 2 ** attempt));
        const res = await ddb.send(new BatchWriteItemCommand({ RequestItems: { [tableName]: requests } }));
        requests = res.UnprocessedItems?.[tableName] ?? [];
      }
      deleted += batch.length;
    }
    lastKey = page.LastEvaluatedKey;
  } while (lastKey);
  return deleted;
}

async function deleteAlertTopic(context: Context, tenantId: string): Promise<void> {
  const [, , , region, account] = context.invokedFunctionArn.split(':');
  const arn = `arn:aws:sns:${region}:${account}:${tenantAlertTopicName(TENANT_ALERT_TOPIC_PREFIX, tenantId)}`;
  try {
    await sns.send(new DeleteTopicCommand({ TopicArn: arn }));
  } catch (err) {
    if (errorName(err) !== 'NotFoundException') throw err;
  }
}

async function putLifecycleEvent(detailType: string, detail: Record<string, unknown>): Promise<void> {
  const res = await eventBridge.send(
    new PutEventsCommand({
      Entries: [{ EventBusName: EVENT_BUS_NAME, Source: EVENT_SOURCE, DetailType: detailType, Detail: JSON.stringify(detail) }],
    }),
  );
  if ((res.FailedEntryCount ?? 0) > 0) {
    throw new Error(`PutEvents failed for ${detailType}: ${JSON.stringify(res.Entries?.[0])}`);
  }
}

async function alertOperator(subject: string, body: Record<string, unknown>): Promise<void> {
  if (!PROVISIONING_ALERT_TOPIC_ARN) return;
  await sns.send(
    new PublishCommand({ TopicArn: PROVISIONING_ALERT_TOPIC_ARN, Subject: subject.slice(0, 100), Message: JSON.stringify(body, null, 2) }),
  );
}

export async function handler(event: EventBridgeEvent<string, OffboardingDetail>, context: Context): Promise<void> {
  const detail = event.detail ?? {};
  const tenantRegistrationId = String(detail.tenantRegistrationId ?? '');
  const tenantId = String(detail.tenantId ?? '');
  if (!tenantRegistrationId || !tenantId) {
    throw new Error('offboarding event without tenantRegistrationId and tenantId');
  }
  const ctx = { tenantId, tenantRegistrationId };

  try {
    const tier = String(detail.tier ?? 'BASIC').trim().toUpperCase();
    if (tier !== 'BASIC') {
      throw new PermanentFailure(`V1 deprovisions BASIC tenants only; received tier '${detail.tier ?? ''}'`);
    }
    const metadata = await readMetadata(tenantId);
    const refusal = deprovisionRefusal(metadata, detail.confirmProduction);
    if (refusal) throw new PermanentFailure(refusal);

    const userPoolId = await tenantUserPoolId();
    const usersDeleted = await deleteUsersAndGroup(userPoolId, tenantId);
    const itemsDeleted: Record<string, number> = {};
    for (const table of TABLES) {
      itemsDeleted[table] = await deleteTenantPartition(table, tenantId);
    }
    await deleteAlertTopic(context, tenantId);
    await putLifecycleEvent(SUCCESS_DETAIL_TYPE, deprovisionSuccessDetail(tenantRegistrationId, tenantId));
    log('info', 'tenant deprovisioned', { ...ctx, tenantTag: metadata?.tenantTag, usersDeleted, itemsDeleted });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentFailure;
    await putLifecycleEvent(FAILURE_DETAIL_TYPE, lifecycleFailureDetail(tenantRegistrationId, DEPROVISION_FAILURE_STATUS, message)).catch((e) =>
      log('error', `could not emit ${FAILURE_DETAIL_TYPE}: ${(e as Error).message}`, ctx),
    );
    await alertOperator(`[EdForge] Tenant deprovisioning ${permanent ? 'refused' : 'failed'}: ${tenantId}`, {
      ...ctx,
      reason: message,
      retried: !permanent,
    }).catch((e) => log('error', `could not publish the operator alert: ${(e as Error).message}`, ctx));
    if (permanent) {
      log('error', `tenant deprovisioning refused: ${message}`, ctx);
      return;
    }
    log('error', `tenant deprovisioning failed: ${message}`, ctx);
    throw err;
  }
}
