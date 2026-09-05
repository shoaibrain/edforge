/**
 * Cost-redesign C7.1 — provisions a BASIC tenant when SBT emits
 * `sbt_aws_onboardingRequest`, doing what provision-tenant.sh did in a
 * CodeBuild job: the tenant-admin Cognito user, the tenant group, the
 * membership, the tenant alert topic with the admin's email subscribed, and
 * the `sbt_aws_provisionSuccess` envelope the seeder and SBT consume.
 *
 * Idempotent by construction (D7.2): every step is create-if-missing, so the
 * EventBridge and Lambda retries converge on the same tenant. A permanent
 * failure (non-BASIC tier, no email) emits `sbt_aws_provisionFailure`, tells
 * the operator through the provisioning-alerts topic and returns; anything
 * else is emitted as a failure too and then thrown so the retries and the
 * control-plane errors alarm see it.
 */
import type { EventBridgeEvent } from 'aws-lambda';
import {
  CognitoIdentityProviderClient,
  AdminCreateUserCommand,
  AdminAddUserToGroupCommand,
  CreateGroupCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { SNSClient, CreateTopicCommand, SubscribeCommand, PublishCommand } from '@aws-sdk/client-sns';
import { EventBridgeClient, PutEventsCommand } from '@aws-sdk/client-eventbridge';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import {
  PermanentFailure,
  PROVISION_FAILURE_STATUS,
  lifecycleFailureDetail,
  normalizeArchetype,
  normalizeTenantTag,
  provisionSuccessDetail,
  tenantAlertTopicName,
  usernameFor,
  type OnboardingDetail,
} from './sbt-lifecycle';

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME ?? '';
const EVENT_SOURCE = process.env.EVENT_SOURCE ?? 'sbt.application.plane';
const SUCCESS_DETAIL_TYPE = process.env.SUCCESS_DETAIL_TYPE ?? 'sbt_aws_provisionSuccess';
const FAILURE_DETAIL_TYPE = process.env.FAILURE_DETAIL_TYPE ?? 'sbt_aws_provisionFailure';
const TENANT_STACK_NAME = process.env.TENANT_STACK_NAME ?? 'tenant-template-stack-basic';
const TENANT_API_URL = process.env.TENANT_API_URL ?? '';
const PROVISIONING_ALERT_TOPIC_ARN = process.env.PROVISIONING_ALERT_TOPIC_ARN ?? '';
const TENANT_ALERT_TOPIC_PREFIX = process.env.TENANT_ALERT_TOPIC_PREFIX ?? 'edforge-alerts-tenant-';

const cognito = new CognitoIdentityProviderClient({});
const sns = new SNSClient({});
const eventBridge = new EventBridgeClient({});
const cloudFormation = new CloudFormationClient({});

interface TenantStackOutputs {
  userPoolId: string;
  appClientId: string;
}

let stackOutputs: Promise<TenantStackOutputs> | undefined;

/** The pool and client ids live in the tenant stack's outputs; read once per warm environment, as the script read them per run. */
export function tenantStackOutputs(): Promise<TenantStackOutputs> {
  if (!stackOutputs) {
    stackOutputs = (async () => {
      const res = await cloudFormation.send(new DescribeStacksCommand({ StackName: TENANT_STACK_NAME }));
      const outputs = Object.fromEntries((res.Stacks?.[0]?.Outputs ?? []).map((o) => [o.OutputKey, o.OutputValue]));
      const userPoolId = outputs.TenantUserpoolId;
      const appClientId = outputs.UserPoolClientId;
      if (!userPoolId || !appClientId) {
        throw new Error(`${TENANT_STACK_NAME} has no TenantUserpoolId/UserPoolClientId output`);
      }
      return { userPoolId, appClientId };
    })().catch((err) => {
      stackOutputs = undefined;
      throw err;
    });
  }
  return stackOutputs;
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

async function ensureUser(userPoolId: string, username: string, t: { tenantId: string; tenantName: string; email: string }): Promise<'created' | 'exists'> {
  try {
    await cognito.send(
      new AdminCreateUserCommand({
        UserPoolId: userPoolId,
        Username: username,
        DesiredDeliveryMediums: ['EMAIL'],
        UserAttributes: [
          { Name: 'email', Value: t.email },
          { Name: 'email_verified', Value: 'true' },
          // The script set this placeholder for every tenant admin; kept so
          // existing users and new users look alike to the identity service.
          { Name: 'phone_number', Value: '+11234567890' },
          { Name: 'custom:userRole', Value: 'TenantAdmin' },
          { Name: 'custom:tenantId', Value: t.tenantId },
          { Name: 'custom:tenantTier', Value: 'BASIC' },
          { Name: 'custom:tenantName', Value: t.tenantName },
        ],
      }),
    );
    return 'created';
  } catch (err) {
    if (errorName(err) === 'UsernameExistsException') return 'exists';
    throw err;
  }
}

async function ensureGroup(userPoolId: string, groupName: string): Promise<'created' | 'exists'> {
  try {
    await cognito.send(new CreateGroupCommand({ UserPoolId: userPoolId, GroupName: groupName }));
    return 'created';
  } catch (err) {
    if (errorName(err) === 'GroupExistsException') return 'exists';
    throw err;
  }
}

async function ensureAlertTopic(tenantId: string, email: string): Promise<string> {
  const topic = await sns.send(new CreateTopicCommand({ Name: tenantAlertTopicName(TENANT_ALERT_TOPIC_PREFIX, tenantId) }));
  if (!topic.TopicArn) throw new Error('CreateTopic returned no ARN');
  await sns.send(new SubscribeCommand({ TopicArn: topic.TopicArn, Protocol: 'email', Endpoint: email }));
  return topic.TopicArn;
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

export async function handler(event: EventBridgeEvent<string, OnboardingDetail>): Promise<void> {
  const detail = event.detail ?? {};
  const tenantRegistrationId = String(detail.tenantRegistrationId ?? '');
  const tenantId = String(detail.tenantId ?? '');
  if (!tenantRegistrationId || !tenantId) {
    throw new Error('onboarding event without tenantRegistrationId and tenantId');
  }
  const ctx = { tenantId, tenantRegistrationId };

  try {
    const tier = String(detail.tier ?? '').trim().toUpperCase();
    if (tier !== 'BASIC') {
      throw new PermanentFailure(`V1 provisions BASIC tenants only; received tier '${detail.tier ?? ''}'`);
    }
    const email = String(detail.email ?? '').trim();
    if (!email) throw new PermanentFailure('onboarding event without an admin email');

    const tenantName = String(detail.tenantName ?? '').trim() || tenantId;
    const archetype = normalizeArchetype(detail.archetype);
    const tenantTag = normalizeTenantTag(detail.tenantTag);
    if (detail.archetype && archetype !== String(detail.archetype).toUpperCase()) {
      log('warn', `unknown archetype '${detail.archetype}' — using GENERIC`, ctx);
    }
    if (detail.tenantTag && tenantTag !== detail.tenantTag) {
      log('warn', `unknown tenantTag '${detail.tenantTag}' — using production`, ctx);
    }

    const { userPoolId, appClientId } = await tenantStackOutputs();
    const username = usernameFor(email);
    const user = await ensureUser(userPoolId, username, { tenantId, tenantName, email });
    const group = await ensureGroup(userPoolId, tenantId);
    await cognito.send(new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: tenantId }));
    const alertTopicArn = await ensureAlertTopic(tenantId, email);

    await putLifecycleEvent(
      SUCCESS_DETAIL_TYPE,
      provisionSuccessDetail({
        tenantRegistrationId,
        tenantId,
        tenantName,
        email,
        tier: 'BASIC',
        country: String(detail.country ?? '').trim().toUpperCase(),
        archetype,
        tenantTag,
        prices: detail.prices,
        alertTopicArn,
        tenantConfig: { userPoolId, appClientId, apiGatewayUrl: TENANT_API_URL },
      }),
    );
    log('info', 'tenant provisioned', { ...ctx, user, group, archetype, tenantTag, alertTopicArn });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const permanent = err instanceof PermanentFailure;
    await putLifecycleEvent(FAILURE_DETAIL_TYPE, lifecycleFailureDetail(tenantRegistrationId, PROVISION_FAILURE_STATUS, message)).catch((e) =>
      log('error', `could not emit ${FAILURE_DETAIL_TYPE}: ${(e as Error).message}`, ctx),
    );
    await alertOperator(`[EdForge] Tenant provisioning ${permanent ? 'refused' : 'failed'}: ${tenantId}`, {
      ...ctx,
      tenantName: detail.tenantName,
      tier: detail.tier,
      reason: message,
      retried: !permanent,
    }).catch((e) => log('error', `could not publish the operator alert: ${(e as Error).message}`, ctx));
    if (permanent) {
      log('error', `tenant provisioning refused: ${message}`, ctx);
      return;
    }
    log('error', `tenant provisioning failed: ${message}`, ctx);
    throw err;
  }
}
