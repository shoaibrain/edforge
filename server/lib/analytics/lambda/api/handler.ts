/**
 * S1.T8/T9/T10 — analytics-api Lambda handler.
 *
 * Takes an APIGatewayProxyEvent, extracts JWT from the Authorization
 * header, routes to the correct handler, and returns
 * APIGatewayProxyResult.
 */

import type {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  EventBridgeEvent,
} from 'aws-lambda';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';
import { AnalyticsService } from './analytics-service';
import { extractClaims, AuthorizationError } from './jwt-claims';
import {
  requireOwnTenantOrSystemAdmin,
  requireSystemAdmin,
  ForbiddenError,
} from './authz';
import {
  validateDateRange,
  validateGranularity,
  validateWeekKey,
  validateDays,
  ValidationError,
} from './validation';
import { route } from './router';
import {
  DdbTenantSettingsResolver,
} from '@edforge/tenant-settings-resolver';

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION, maxAttempts: 3 });
const s3 = new S3Client({ region: process.env.AWS_REGION });

const svc = new AnalyticsService({
  ddb,
  analyticsTable: process.env.ANALYTICS_TABLE_NAME || 'edforge-analytics',
  sessionTable: process.env.USER_SESSION_EVENTS_TABLE_NAME || 'edforge-user-session-events',
});

// A-WS2.T3: tenant-settings resolver — used by A-WS3.T4 to attach
// dateSecondary to responses based on tenant calendar settings.
// Module-level so the LRU cache survives warm invocations.
const tenantSettingsResolver = new DdbTenantSettingsResolver({
  tableName: process.env.IDENTITY_TABLE_NAME || 'edforge-identity-basic',
  ddbClient: ddb,
});

export { tenantSettingsResolver };

const EXPORT_BUCKET = process.env.EXPORT_BUCKET_NAME || '';
const CORS_ORIGIN = process.env.CORS_ALLOWED_ORIGIN || '*';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': CORS_ORIGIN,
    'Access-Control-Allow-Credentials': 'true',
    'Content-Type': 'application/json',
  };
}

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(body),
  };
}

function qs(event: APIGatewayProxyEvent, key: string): string | undefined {
  return event.queryStringParameters?.[key] ?? undefined;
}

/**
 * EventBridge event from identity service. Detected by the presence of
 * `source` + `detail-type` fields (APIGatewayProxyEvent has neither).
 */
function isEventBridgeEvent(
  evt: unknown,
): evt is EventBridgeEvent<string, { tenantId?: string }> {
  return (
    !!evt &&
    typeof evt === 'object' &&
    'source' in evt &&
    'detail-type' in evt
  );
}

/**
 * EventBridge sub-handler (A-WS2.T3). Receives WorkspaceSettingsUpdated
 * events and invalidates the per-tenant settings cache so the next API
 * request returns fresh values within seconds, not after the 5-min TTL.
 *
 * Returns null because EventBridge target invocations don't read a body.
 */
function handleEventBridgeEvent(
  evt: EventBridgeEvent<string, { tenantId?: string }>,
): null {
  if (
    evt.source === 'edforge.identity-service' &&
    evt['detail-type'] === 'WorkspaceSettingsUpdated'
  ) {
    const tenantId = evt.detail?.tenantId;
    if (tenantId) {
      tenantSettingsResolver.invalidate(tenantId);
      console.log(
        JSON.stringify({
          level: 'info',
          msg: 'analytics-api tenant-settings cache invalidated',
          tenantId,
        }),
      );
    } else {
      console.warn(
        JSON.stringify({
          level: 'warn',
          msg: 'WorkspaceSettingsUpdated received without tenantId; ignored',
        }),
      );
    }
  }
  return null;
}

export const handler = async (
  event: APIGatewayProxyEvent | EventBridgeEvent<string, { tenantId?: string }>,
): Promise<APIGatewayProxyResult | null> => {
  // A-WS2.T3 — EventBridge dispatch. The Lambda's Lambda permission allows
  // both API Gateway and EventBridge invocations; we differentiate by event
  // shape. EventBridge target invocations don't consume a return value.
  if (isEventBridgeEvent(event)) {
    return handleEventBridgeEvent(event);
  }

  // OPTIONS preflight (if it leaks through)
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        ...corsHeaders(),
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers':
          'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token',
      },
      body: '',
    };
  }

  try {
    const claims = extractClaims(
      event.headers?.Authorization || event.headers?.authorization,
    );
    const matched = route(event.httpMethod, event.path);
    if (!matched) return json(404, { error: 'Not found' });

    switch (matched.handler) {
      case 'tenantSeries': {
        const tenantId = matched.params.tenantId;
        requireOwnTenantOrSystemAdmin(claims, tenantId);
        const { from, to } = validateDateRange(qs(event, 'from'), qs(event, 'to'));
        const gran = validateGranularity(qs(event, 'granularity'));
        // A-WS3.T4: when the tenant has dual-display enabled (e.g., Nepal
        // BASIC tenants with Bikram Sambat), every series point carries a
        // dateSecondary block. US tenants get plain Gregorian.
        const settings = await tenantSettingsResolver.get(tenantId).catch(() => null);
        const result = await svc.getTenantTimeSeries(tenantId, from, to, gran, {
          calendarSystem: settings?.regional.defaultCalendarSystem,
          enableDualDateDisplay: settings?.regional.enableDualDateDisplay,
        });
        return json(200, result);
      }

      case 'adoptionReport': {
        const tenantId = matched.params.tenantId;
        requireOwnTenantOrSystemAdmin(claims, tenantId);
        const week = validateWeekKey(qs(event, 'week'));
        const provisionedAt = qs(event, 'provisionedAt') ?? '';
        // A-WS3.T2: pull tenant's preferred week-start so the response can
        // tell the frontend how to label the week range. Fallback to
        // 'sunday' (Nepal V1 default) when settings aren't available.
        const settings = await tenantSettingsResolver.get(tenantId).catch(() => null);
        const weekStartsOn = settings?.regional.defaultWeekStartsOn ?? 'sunday';
        // A-WS3.T3: caller passes holiday dates that fall in this report
        // week (e.g., from identity's /schools/{id}/holidays endpoint, which
        // the saas-frontend already calls for its calendar UI). When
        // omitted, no holiday-relaxation applies. Comma-separated yyyy-mm-dd.
        const holidaysQs = qs(event, 'holidays') ?? '';
        const holidayDatesInWeek = holidaysQs
          .split(',')
          .map((s) => s.trim())
          .filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
        const result = await svc.getAdoptionReport(
          tenantId,
          week,
          provisionedAt,
          weekStartsOn,
          holidayDatesInWeek,
        );
        return json(200, result);
      }

      case 'fleet': {
        requireSystemAdmin(claims);
        const { from, to } = validateDateRange(qs(event, 'from'), qs(event, 'to'));
        const result = await svc.getFleetSummary(from, to);
        return json(200, result);
      }

      case 'sessionHistory': {
        const days = validateDays(qs(event, 'days'));
        const result = await svc.getSessionHistory(claims.userId, days);
        return json(200, result);
      }

      case 'exportCsvUrl': {
        const tenantId = matched.params.tenantId;
        requireOwnTenantOrSystemAdmin(claims, tenantId);
        const { from, to } = validateDateRange(qs(event, 'from'), qs(event, 'to'));
        const gran = validateGranularity(qs(event, 'granularity'));
        if (!EXPORT_BUCKET) return json(500, { error: 'Export bucket not configured' });
        const csv = await svc.generateExportCsv(tenantId, from, to, gran);
        const key = `exports/${tenantId}/${randomUUID()}.csv`;
        await s3.send(
          new PutObjectCommand({
            Bucket: EXPORT_BUCKET,
            Key: key,
            Body: csv,
            ContentType: 'text/csv',
          }),
        );
        const url = await getSignedUrl(
          s3,
          new GetObjectCommand({ Bucket: EXPORT_BUCKET, Key: key }),
          { expiresIn: 600 },
        );
        return json(200, { url, expiresIn: 600 });
      }

      default:
        return json(404, { error: 'Not found' });
    }
  } catch (err) {
    if (err instanceof AuthorizationError) return json(401, { error: err.message });
    if (err instanceof ForbiddenError) return json(403, { error: err.message });
    if (err instanceof ValidationError) return json(400, { error: err.message });
    console.error('Unhandled error:', err);
    return json(500, { error: 'Internal server error' });
  }
};
