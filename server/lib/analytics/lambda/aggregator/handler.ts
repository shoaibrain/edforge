/**
 * Layer 5.2 — AnalyticsAggregatorLambda
 *
 * Receives EventBridge events from two rules (Layer 2.5):
 *   - edforge-analytics-native      (source = edforge.analytics)
 *   - edforge-domain-events         (source ∈ edforge.{academics,finance,identity}-service)
 *
 * Per event:
 *   1. Short-circuit when ANALYTICS_ENABLED=false (silent no-op).
 *   2. For edforge.analytics events: validate against the zod schema.
 *      Validation failure → DLQ + return (never throw — a throw would
 *      retry the Lambda and loop). Domain events are accepted as-is.
 *   3. Idempotency: conditional PutItem on the landing table keyed by
 *      eventId. ConditionalCheckFailed → duplicate, return silently.
 *   4. Metric lookup via event-metric-map.ts. Null → DLQ + return.
 *   5. TransactWriteItems against the aggregates table:
 *        - total SK:       DAY#<date>#<metric>
 *        - per role:       DAY#<date>#<metric>#role=<role>     (if role present)
 *        - per schoolId:   DAY#<date>#<metric>#school=<sid>    (if dim requested + sid present)
 *      Plus — for SessionCreated/SessionRevoked/SessionRefreshed — a fourth
 *      condition-put to UserSessionEventsTable.
 *      All 3–4 writes happen in a single TransactWriteItems so a partial
 *      commit can't leave aggregates inconsistent with the session table.
 *   6. Emit two CloudWatch custom metrics: AnalyticsEventsProcessed (=1) and
 *      AnalyticsAggregateWritten (=N).
 *   7. Structured logs carry correlationId/tenantId/eventId/detailType.
 *
 * Cardinal rules observed:
 *   - Never put userId in aggregate SKs. Only role and schoolId. Enforced
 *     by event-metric-map dimensions + an assertion in buildAggregateWrites.
 *   - Never throw. All errors are logged and routed to DLQ via SendMessage
 *     so Lambda doesn't retry-loop.
 */

import { EventBridgeEvent } from 'aws-lambda';
import {
  DynamoDBClient,
  TransactWriteItemsCommand,
  PutItemCommand,
  ConditionalCheckFailedException,
  type TransactWriteItem,
} from '@aws-sdk/client-dynamodb';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import {
  SQSClient,
  SendMessageCommand,
} from '@aws-sdk/client-sqs';
import { z } from 'zod';
import {
  lookupMetric,
  SESSION_EVENT_TYPES,
  type MetricMapping,
} from './event-metric-map';
import { toDateKey } from '../shared/date-utils';
import {
  DdbTenantSettingsResolver,
  TenantSettingsNotFoundError,
  type TenantWorkspaceSettings,
} from '@edforge/tenant-settings-resolver';

// ----------------------------------------------------------------------
// AWS clients (module-level — reused across invocations)
// ----------------------------------------------------------------------
const ddb = new DynamoDBClient({ region: process.env.AWS_REGION, maxAttempts: 3 });
const cw = new CloudWatchClient({ region: process.env.AWS_REGION, maxAttempts: 3 });
const sqs = new SQSClient({ region: process.env.AWS_REGION, maxAttempts: 3 });

// ----------------------------------------------------------------------
// Env
// ----------------------------------------------------------------------
const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME!;
const LANDING_TABLE = process.env.LANDING_TABLE_NAME!;
const USER_SESSION_TABLE = process.env.USER_SESSION_EVENTS_TABLE_NAME!;
const DLQ_URL = process.env.AGGREGATOR_DLQ_URL;
const ENABLED = process.env.ANALYTICS_ENABLED === 'true';
/**
 * Identity table name for workspace-settings lookups. V1 is BASIC-tier only
 * so this is hardcoded per environment; when Advanced/Premium tiers ship,
 * extend to resolve tier → table dynamically.
 */
const IDENTITY_TABLE = process.env.IDENTITY_TABLE_NAME || 'edforge-identity-basic';

// ----------------------------------------------------------------------
// Tenant settings resolver — module-level so the LRU cache survives warm
// Lambda invocations. A-WS3.T1 will consume `regional.defaultTimezone`
// from this resolver; this ticket only gets the wiring in place.
// ----------------------------------------------------------------------
const tenantSettingsResolver = new DdbTenantSettingsResolver({
  tableName: IDENTITY_TABLE,
  ddbClient: ddb,
  logger: {
    debug: (msg, meta) =>
      console.log(JSON.stringify({ level: 'debug', msg, ...meta })),
    info: (msg, meta) =>
      console.log(JSON.stringify({ level: 'info', msg, ...meta })),
    warn: (msg, meta) =>
      console.warn(JSON.stringify({ level: 'warn', msg, ...meta })),
    error: (msg, meta) =>
      console.error(JSON.stringify({ level: 'error', msg, ...meta })),
  },
});

/**
 * Fetch tenant settings with graceful fallback.
 *
 * Cardinal rule: aggregator must never reject an event because of a settings
 * lookup failure. On TenantSettingsNotFoundError or any backend error, we
 * return null and the caller uses fleet defaults (preserves pre-A-WS1
 * behavior).
 *
 * Exported for tests; callers elsewhere should use it for consistent
 * fallback semantics.
 */
export async function tryGetTenantSettings(
  tenantId: string,
): Promise<TenantWorkspaceSettings | null> {
  try {
    return await tenantSettingsResolver.get(tenantId);
  } catch (err) {
    if (err instanceof TenantSettingsNotFoundError) {
      // Common during onboarding races or test tenants; log at warn but
      // never block the event.
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'tenant-settings not found; falling back to fleet defaults',
          tenantId,
        }),
      );
    } else {
      console.error(
        JSON.stringify({
          level: 'error',
          msg: 'tenant-settings lookup failed; falling back to fleet defaults',
          tenantId,
          error: (err as Error).message,
        }),
      );
    }
    return null;
  }
}

/** Exposed for A-WS2.T2: EventBridge handler invalidates the resolver cache. */
export function invalidateTenantSettings(tenantId: string): void {
  tenantSettingsResolver.invalidate(tenantId);
}

const LANDING_TTL_DAYS = 90;
const USER_SESSION_TTL_DAYS = 395; // 13 months
const DAY_AGGREGATE_TTL_DAYS = 90; // DAY rows; WEEK/MONTH handled by rollup

const ANALYTICS_SOURCE = 'edforge.analytics';

// ----------------------------------------------------------------------
// AnalyticsEvent zod schema — duplicated here rather than imported from
// @app/analytics-events because this Lambda is bundled from server/ (a
// separate TS project) and must remain self-contained for esbuild.
// Keep in sync with
// server/application/libs/analytics-events/src/analytics-event.validator.ts
// ----------------------------------------------------------------------
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const analyticsEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: z.string().regex(UUID_REGEX, 'eventId must be a UUID'),
  ts: z.string().datetime({ offset: true }),
  tenantId: z.string().min(1),
  tenantTier: z.literal('BASIC'),
  userId: z.string().min(1),
  role: z.enum(['SystemAdmin', 'TenantAdmin', 'Teacher', 'Parent', 'Student']),
  schoolId: z.string().min(1).optional(),
  feature: z.string().min(1),
  action: z.string().min(1),
  correlationId: z.string().min(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

type AnalyticsEvent = z.infer<typeof analyticsEventSchema>;

// ----------------------------------------------------------------------
// Structured log helpers
// ----------------------------------------------------------------------
interface LogCtx {
  correlationId?: string;
  tenantId: string;
  eventId: string;
  detailType: string;
  [k: string]: unknown;
}
function logInfo(msg: string, ctx: LogCtx): void {
  console.log(JSON.stringify({ level: 'info', msg, ...ctx }));
}
function logWarn(msg: string, ctx: LogCtx): void {
  console.warn(JSON.stringify({ level: 'warn', msg, ...ctx }));
}
function logError(msg: string, ctx: LogCtx): void {
  console.error(JSON.stringify({ level: 'error', msg, ...ctx }));
}

// ----------------------------------------------------------------------
// Aggregate write construction
//
// Rule: SK NEVER contains userId. Enforced by restricting dimensions to the
// MetricDimension type (already enforced statically in event-metric-map.ts).
// We also double-check at runtime as a belt-and-braces guard.
// ----------------------------------------------------------------------
interface AggregateContext {
  tenantId: string;
  date: string; // yyyy-mm-dd
  metric: string;
  role?: string;
  schoolId?: string;
  expireAt: number;
}

function buildAggregateWrites(
  ctx: AggregateContext,
  requestedDimensions: ReadonlyArray<'role' | 'schoolId'>,
): TransactWriteItem[] {
  const { tenantId, date, metric, role, schoolId, expireAt } = ctx;
  const pk = `TENANT#${tenantId}`;

  const sks: string[] = [];
  sks.push(`DAY#${date}#${metric}`);
  if (requestedDimensions.includes('role') && role) {
    sks.push(`DAY#${date}#${metric}#role=${role}`);
  }
  if (requestedDimensions.includes('schoolId') && schoolId) {
    sks.push(`DAY#${date}#${metric}#school=${schoolId}`);
  }

  // PII invariant guard.
  for (const sk of sks) {
    if (/userId|user=|USER#/i.test(sk)) {
      throw new Error(`PII invariant violation: SK contains userId: ${sk}`);
    }
  }

  return sks.map((sk) => ({
    Update: {
      TableName: ANALYTICS_TABLE,
      Key: { PK: { S: pk }, SK: { S: sk } },
      // GSI1PK/GSI1SK populate Layer 6.4's GSI1 so /analytics/fleet can
      // query "top features" across all tenants without a table scan.
      // Only the total row (no dim suffix) gets indexed — splits would
      // multiply cardinality without query benefit.
      UpdateExpression:
        'ADD #count :one SET expireAt = if_not_exists(expireAt, :expireAt), lastUpdated = :now' +
        (sk.includes('#role=') || sk.includes('#school=')
          ? ''
          : ', GSI1PK = :gsi1pk, GSI1SK = :gsi1sk'),
      ExpressionAttributeNames: { '#count': 'count' },
      ExpressionAttributeValues: {
        ':one': { N: '1' },
        ':expireAt': { N: String(expireAt) },
        ':now': { S: new Date().toISOString() },
        ...(sk.includes('#role=') || sk.includes('#school=')
          ? {}
          : {
              ':gsi1pk': { S: `FEATURE#${metric}` },
              ':gsi1sk': { S: `${date}#${tenantId}` },
            }),
      },
    },
  }));
}

function buildUserSessionWrite(
  userId: string | undefined,
  eventId: string,
  ts: string,
  detailType: string,
  tenantId: string,
  detail: Record<string, unknown>,
  expireAt: number,
): TransactWriteItem | null {
  if (!userId) return null;
  return {
    Put: {
      TableName: USER_SESSION_TABLE,
      Item: {
        PK: { S: `USER#${userId}` },
        SK: { S: `EVENT#${ts}#${eventId}` },
        eventType: { S: detailType },
        tenantId: { S: tenantId },
        expireAt: { N: String(expireAt) },
        ...(typeof detail.ipAddress === 'string'
          ? { ipAddress: { S: detail.ipAddress } }
          : {}),
        ...(detail.deviceInfo
          ? { deviceInfo: { S: JSON.stringify(detail.deviceInfo) } }
          : {}),
      },
      ConditionExpression: 'attribute_not_exists(SK)',
    },
  };
}

// ----------------------------------------------------------------------
// DLQ helper
// ----------------------------------------------------------------------
async function sendToDlq(
  reason: string,
  event: unknown,
  logCtx: LogCtx,
): Promise<void> {
  if (!DLQ_URL) {
    logWarn('DLQ_URL not configured; discarding message', logCtx);
    return;
  }
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: DLQ_URL,
        MessageBody: JSON.stringify({ reason, event, at: new Date().toISOString() }),
      }),
    );
    logWarn(`event routed to DLQ: ${reason}`, logCtx);
  } catch (err) {
    logError(`DLQ send failed: ${(err as Error).message}`, logCtx);
  }
}

// ----------------------------------------------------------------------
// Landing write (idempotency anchor)
// ----------------------------------------------------------------------
async function writeLanding(
  event: EventBridgeEvent<string, unknown>,
  eventId: string,
  tenantId: string,
  logCtx: LogCtx,
): Promise<'wrote' | 'duplicate' | 'error'> {
  const nowSec = Math.floor(Date.now() / 1000);
  const expireAt = nowSec + LANDING_TTL_DAYS * 86400;
  try {
    await ddb.send(
      new PutItemCommand({
        TableName: LANDING_TABLE,
        Item: {
          eventId: { S: eventId },
          rawEvent: { S: JSON.stringify(event) },
          receivedAt: { S: new Date().toISOString() },
          tenantId: { S: tenantId },
          expireAt: { N: String(expireAt) },
        },
        ConditionExpression: 'attribute_not_exists(eventId)',
      }),
    );
    return 'wrote';
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) {
      logInfo('duplicate eventId — skipped', logCtx);
      return 'duplicate';
    }
    logError(`landing PutItem failed: ${(err as Error).message}`, logCtx);
    return 'error';
  }
}

// ----------------------------------------------------------------------
// CloudWatch metrics
// ----------------------------------------------------------------------
async function publishProcessedMetric(
  detailType: string,
  aggregatesWritten: number,
): Promise<void> {
  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: 'Edforge/Analytics',
        MetricData: [
          {
            MetricName: 'AnalyticsEventsProcessed',
            Value: 1,
            Unit: 'Count',
            Dimensions: [{ Name: 'DetailType', Value: detailType }],
          },
          {
            MetricName: 'AnalyticsAggregateWritten',
            Value: aggregatesWritten,
            Unit: 'Count',
            Dimensions: [{ Name: 'DetailType', Value: detailType }],
          },
        ],
      }),
    );
  } catch (err) {
    // Metrics are best-effort; never block the main write path.
    console.error(
      JSON.stringify({
        level: 'warn',
        msg: `CW metric publish failed: ${(err as Error).message}`,
        detailType,
      }),
    );
  }
}

// ----------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handler = async (event: EventBridgeEvent<string, any>): Promise<void> => {
  if (!ENABLED) return;

  const source = event.source;
  const detailType = event['detail-type'] || 'unknown';
  const detail: Record<string, unknown> = event.detail ?? {};

  // Prefer fields from the payload; fall back to EventBridge envelope fields.
  const eventId =
    (detail.eventId as string | undefined) ||
    event.id ||
    `synthetic-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const tenantId = (detail.tenantId as string | undefined) || 'unknown';
  const correlationId =
    (detail.correlationId as string | undefined) || event.id || undefined;

  const logCtx: LogCtx = { correlationId, tenantId, eventId, detailType };

  // --- 0. Settings-cache invalidation (A-WS2.T2) ---------------------------
  // WorkspaceSettingsUpdated events from identity-service are NOT analytics
  // data — they're cache-invalidation signals. Drop the cached entry for
  // this tenant so the next event fetches fresh settings, then return.
  // Doing this BEFORE schema validation because the event uses the legacy
  // BaseDomainEvent shape (no schemaVersion), not the analytics envelope.
  if (
    source === 'edforge.identity-service' &&
    detailType === 'WorkspaceSettingsUpdated'
  ) {
    if (tenantId !== 'unknown') {
      invalidateTenantSettings(tenantId);
      logInfo('tenant-settings cache invalidated by WorkspaceSettingsUpdated event', logCtx);
    } else {
      logWarn('WorkspaceSettingsUpdated received without tenantId; ignored', logCtx);
    }
    return;
  }

  // --- 1. Schema validation (analytics-source only) -----------------------
  let validated: AnalyticsEvent | null = null;
  if (source === ANALYTICS_SOURCE) {
    const parsed = analyticsEventSchema.safeParse(detail);
    if (!parsed.success) {
      await sendToDlq(
        `schema validation failed: ${parsed.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join(', ')}`,
        event,
        logCtx,
      );
      return;
    }
    validated = parsed.data as AnalyticsEvent;
  }

  // --- 2. Metric lookup ---------------------------------------------------
  const mapping: MetricMapping | null = lookupMetric(source, detailType);
  if (!mapping) {
    await sendToDlq(`no metric mapping for (${source}, ${detailType})`, event, logCtx);
    return;
  }

  // --- 3. Landing (idempotency) -------------------------------------------
  const landingResult = await writeLanding(event, eventId, tenantId, logCtx);
  if (landingResult === 'duplicate') return;
  if (landingResult === 'error') {
    // Landing write failed (not a duplicate). Don't retry — route to DLQ and
    // let the operator replay after investigating.
    await sendToDlq('landing PutItem failed', event, logCtx);
    return;
  }

  // --- 4. Build and execute aggregate writes ------------------------------
  const role = validated?.role ?? (detail.role as string | undefined);
  const schoolId =
    validated?.schoolId ?? (detail.schoolId as string | undefined);
  const userId = validated?.userId ?? (detail.userId as string | undefined);
  const eventTs = validated?.ts
    ? new Date(validated.ts)
    : detail.ts
    ? new Date(detail.ts as string)
    : new Date();

  // A-WS1.T7 + A-WS3.T1: fetch tenant settings to derive the bucket date
  // in the tenant's own timezone. Failure is non-blocking — when settings
  // are missing/unavailable, fall back to Asia/Kathmandu (the V1 default,
  // preserves existing Nepal-only behavior).
  //
  // The resolver is LRU-cached so this is a cheap call after the first
  // event per tenant per warm Lambda.
  const tenantSettings = await tryGetTenantSettings(tenantId);
  const tenantTz =
    tenantSettings?.regional.defaultTimezone || 'Asia/Kathmandu';

  // Bucket by the tenant's civil date, NOT UTC. Originally hardcoded to
  // NPT (ACRIT.1); now per-tenant via A-WS3.T1. An event at 23:45 UTC
  // Saturday is 05:30 NPT Sunday for a Nepal tenant (lands on Sunday)
  // but 18:45 EST Saturday for a US tenant (lands on Saturday).
  const date = toDateKey(eventTs, tenantTz);
  const nowSec = Math.floor(Date.now() / 1000);
  const aggExpireAt = nowSec + DAY_AGGREGATE_TTL_DAYS * 86400;

  let aggregateWrites: TransactWriteItem[];
  try {
    aggregateWrites = buildAggregateWrites(
      { tenantId, date, metric: mapping.metric, role, schoolId, expireAt: aggExpireAt },
      mapping.dimensions,
    );
  } catch (err) {
    logError(`aggregate write build failed: ${(err as Error).message}`, logCtx);
    await sendToDlq(`aggregate build failed: ${(err as Error).message}`, event, logCtx);
    return;
  }

  const writes: TransactWriteItem[] = [...aggregateWrites];
  // Dual-write for session events.
  if (SESSION_EVENT_TYPES.has(detailType)) {
    const userSessionExpireAt = nowSec + USER_SESSION_TTL_DAYS * 86400;
    const sessionWrite = buildUserSessionWrite(
      userId,
      eventId,
      eventTs.toISOString(),
      detailType,
      tenantId,
      detail,
      userSessionExpireAt,
    );
    if (sessionWrite) writes.push(sessionWrite);
  }

  try {
    await ddb.send(new TransactWriteItemsCommand({ TransactItems: writes }));
  } catch (err) {
    logError(
      `TransactWriteItems failed: ${(err as Error).message}`,
      logCtx,
    );
    await sendToDlq(`aggregate TransactWrite failed: ${(err as Error).message}`, event, logCtx);
    return;
  }

  // --- 5. CloudWatch metrics ----------------------------------------------
  await publishProcessedMetric(detailType, writes.length);

  logInfo(
    `processed event — metric=${mapping.metric} writes=${writes.length}`,
    logCtx,
  );
};
