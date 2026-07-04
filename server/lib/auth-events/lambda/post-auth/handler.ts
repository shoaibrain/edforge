/**
 * Cognito PostAuthentication trigger — emits `LoginSuccess` to the
 * EventBridge analytics bus on every successful Cognito authentication.
 *
 * WHY THIS EXISTS (C0a, 2026-04-16):
 *   The saas-frontend authenticates users via Amplify's `signIn()` which
 *   talks directly to Cognito's `InitiateAuth` API. The backend route
 *   `POST /auth/login` (where `auth.service.login()` calls
 *   `emitLoginSuccess`) is therefore never invoked on the user-login path.
 *   Result: zero `LoginSuccess` events ever reached the bus, and
 *   `teacherLoginCadence` was permanently stuck at 0%.
 *
 *   This Lambda fixes that at the right layer: hooked into Cognito's
 *   PostAuthentication event so it fires for every login regardless of
 *   how the client authenticated (direct sign-in, hosted UI, federated,
 *   admin-initiated).
 *
 * SHAPE PARITY:
 *   The emitted event is wire-compatible with what
 *   `AnalyticsEventsService.emitLoginSuccess()` produces — same
 *   Source (`edforge.identity-service`), same DetailType (`LoginSuccess`),
 *   same envelope fields. The aggregator's `event-metric-map.ts` already
 *   routes this to `auth.login.success`.
 *
 * SAFETY:
 *   This trigger MUST NOT throw. PostAuthentication failures can break
 *   user logins. We wrap everything in try/catch and always return the
 *   event unchanged (Cognito requires the event back).
 */

import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { randomUUID } from 'node:crypto';

const eb = new EventBridgeClient({
  region: process.env.AWS_REGION,
  maxAttempts: 2,
});

// maxAttempts:1 — a best-effort write on the SYNCHRONOUS login path. SDK
// retries would only add latency to a login we must not delay.
const ddb = DynamoDBDocumentClient.from(
  new DynamoDBClient({ region: process.env.AWS_REGION, maxAttempts: 1 }),
);

const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const EVENT_SOURCE = 'edforge.identity-service';
const DETAIL_TYPE = 'LoginSuccess';

// Identity DynamoDB table that holds the user-facing login-history rows
// (same physical table the SecurityService read path queries).
const TABLE_NAME = process.env.TABLE_NAME;
// Login-history rows self-prune via the identity table's `ttl` attribute.
// The identity-service `recordLoginAttempt` sets none; trigger-written rows do
// so the partition can't grow unbounded.
const LOGIN_HISTORY_TTL_SECONDS = 180 * 24 * 60 * 60; // 180 days

// Per-side-effect wall-clock budget. A PostAuthentication trigger runs
// SYNCHRONOUSLY on the login path (5s Lambda timeout). A caught exception is
// not enough: a DDB/EventBridge call that STALLS (network / SDK) and never
// returns would run the Lambda out to timeout, which Cognito treats as a
// trigger failure — and the user's login fails. Both side-effects are raced
// against this budget so the handler always returns well under the Lambda
// timeout. Tunable via env for tests / ops.
const SIDE_EFFECT_TIMEOUT_MS =
  Number(process.env.LOGIN_SIDE_EFFECT_TIMEOUT_MS) || 1500;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Subset of the Cognito PostAuthentication event we read. The full shape
 * is documented at:
 * https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-authentication.html
 */
export interface CognitoPostAuthEvent {
  version: string;
  region: string;
  userPoolId: string;
  userName: string;
  triggerSource: string;
  request: {
    userAttributes: Record<string, string>;
    newDeviceUsed?: boolean;
    clientMetadata?: Record<string, string>;
  };
  response: Record<string, unknown>;
}

type AnalyticsRole = 'SystemAdmin' | 'TenantAdmin' | 'Teacher' | 'Parent' | 'Student';

// ---------------------------------------------------------------------------
// Role coercion — mirror packages/analytics-events/coerceRole + collapse
// teaching-staff variants (Principal, VicePrincipal) onto Teacher so the
// adoption-report's teacherLoginCadence picks them up via a single tag.
// ---------------------------------------------------------------------------
function coerceRole(raw: string | undefined): AnalyticsRole {
  if (!raw) return 'TenantAdmin';
  const normalized = raw.trim();
  switch (normalized) {
    case 'SystemAdmin':
    case 'TenantAdmin':
    case 'Teacher':
    case 'Parent':
    case 'Student':
      return normalized;
    case 'Principal':
    case 'VicePrincipal':
    case 'principal':
    case 'viceprincipal':
    case 'teacher':
      return 'Teacher';
    case 'parent':
      return 'Parent';
    case 'student':
      return 'Student';
    default:
      // Unknown role → log via the metadata, default to TenantAdmin so
      // schema validation passes downstream. Aggregator will still tag the
      // row with this role, so dashboards reflect reality.
      return 'TenantAdmin';
  }
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
function log(
  level: 'info' | 'warn' | 'error',
  msg: string,
  ctx: Record<string, unknown> = {},
): void {
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(JSON.stringify({ level, msg, ...ctx }));
}

// ---------------------------------------------------------------------------
// Bounded best-effort side-effects
// ---------------------------------------------------------------------------
/**
 * Race a best-effort side-effect against a wall-clock budget. Resolves on
 * completion, rejection, OR timeout — it never rejects and never blocks past
 * `ms`. This is the fix for the login-path reliability trap: a caught exception
 * only rescues a *thrown* error; a DDB/EventBridge call that STALLS and never
 * returns would run the Lambda out to its timeout, which Cognito treats as a
 * trigger failure and fails the user's login. The abandoned operation is
 * harmless (the row simply isn't written / the event isn't emitted).
 */
function withTimeout(
  op: Promise<unknown>,
  ms: number,
  label: string,
): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      log('warn', `${label} exceeded ${ms}ms — abandoned (login not blocked)`);
      resolve();
    }, ms);
    op.then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      (err) => {
        clearTimeout(timer);
        log('error', `${label} failed: ${(err as Error).message}`, {
          stack: (err as Error).stack,
        });
        resolve();
      },
    );
  });
}

/**
 * Write the user-facing login-history row for a successful login — the same
 * shape the identity SecurityService read path queries (PK = bare tenantId,
 * SK = `USER#{userId}#LOGIN#{ts}`, entityType `LOGIN_HISTORY`, status success).
 * IP / user-agent are intentionally absent (a Cognito PostAuthentication event
 * carries neither; only Advanced Security contextData would), so those columns
 * stay empty and the security UI shows identity + timestamp + outcome. May
 * reject or stall — the caller bounds it via withTimeout (best-effort).
 */
async function recordLoginHistory(
  tenantId: string,
  userId: string,
  event: CognitoPostAuthEvent,
): Promise<void> {
  if (!TABLE_NAME) {
    log('warn', 'TABLE_NAME not configured — skipping login-history write');
    return;
  }
  const now = new Date();
  const timestamp = now.toISOString();
  const ttl = Math.floor(now.getTime() / 1000) + LOGIN_HISTORY_TTL_SECONDS;
  await ddb.send(
    new PutCommand({
      TableName: TABLE_NAME,
      Item: {
        tenantId,
        entityKey: `USER#${userId}#LOGIN#${timestamp}`,
        entityType: 'LOGIN_HISTORY',
        userId,
        timestamp,
        status: 'success',
        newDeviceUsed: event.request?.newDeviceUsed ?? false,
        source: 'cognito-post-auth-trigger',
        ttl,
      },
    }),
  );
  log('info', 'login history recorded', { userId, tenantId });
}

/**
 * Emit the analytics LoginSuccess event (wire-compatible with
 * AnalyticsEventsService.emitLoginSuccess). May reject or stall — the caller
 * bounds it via withTimeout (best-effort).
 */
async function emitLoginSuccess(
  tenantId: string,
  userId: string,
  rawRole: string | undefined,
  attrs: Record<string, string>,
  event: CognitoPostAuthEvent,
): Promise<void> {
  if (!EVENT_BUS_NAME) {
    log('warn', 'EVENT_BUS_NAME not configured — skipping LoginSuccess emit');
    return;
  }

  const detail = {
    schemaVersion: 1,
    eventId: randomUUID(),
    ts: new Date().toISOString(),
    tenantId,
    tenantTier: 'BASIC',
    userId,
    role: coerceRole(rawRole),
    feature: 'auth',
    action: 'login.success',
    metadata: {
      email: attrs.email ?? null,
      triggerSource: event.triggerSource,
      newDeviceUsed: event.request?.newDeviceUsed ?? false,
      // Preserve raw role for diagnostic traceability in the landing table.
      rawRole: rawRole ?? null,
      source: 'cognito-post-auth-trigger',
    },
  };

  const result = await eb.send(
    new PutEventsCommand({
      Entries: [
        {
          Source: EVENT_SOURCE,
          DetailType: DETAIL_TYPE,
          EventBusName: EVENT_BUS_NAME,
          Detail: JSON.stringify(detail),
          Time: new Date(detail.ts),
        },
      ],
    }),
  );

  if (result.FailedEntryCount && result.FailedEntryCount > 0) {
    log('error', 'PutEvents reported failed entry', {
      userId,
      tenantId,
      entry: result.Entries?.[0],
    });
  } else {
    log('info', 'LoginSuccess emitted', {
      userId,
      tenantId,
      role: detail.role,
      eventId: detail.eventId,
    });
  }
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------
export const handler = async (
  event: CognitoPostAuthEvent,
): Promise<CognitoPostAuthEvent> => {
  // Always return the event — Cognito requires it, and nothing here may block
  // the login. The two side-effects run CONCURRENTLY and are each bounded by
  // SIDE_EFFECT_TIMEOUT_MS (well under the Lambda timeout), so neither a thrown
  // error NOR a network/SDK stall can fail or delay the user's login.
  const attrs = event.request?.userAttributes ?? {};
  const tenantId = attrs['custom:tenantId'];
  const userId = attrs.sub ?? event.userName;
  const rawRole = attrs['custom:userRole'];

  if (!tenantId) {
    log('warn', 'PostAuth event missing custom:tenantId — skipping', {
      userId,
      triggerSource: event.triggerSource,
    });
    return event;
  }

  await Promise.allSettled([
    // 1) User-facing login history — the seam every real login crosses.
    withTimeout(
      recordLoginHistory(tenantId, userId, event),
      SIDE_EFFECT_TIMEOUT_MS,
      'login-history write',
    ),
    // 2) Analytics LoginSuccess emit.
    withTimeout(
      emitLoginSuccess(tenantId, userId, rawRole, attrs, event),
      SIDE_EFFECT_TIMEOUT_MS,
      'analytics emit',
    ),
  ]);

  return event;
};
