/**
 * Layer 6.3 — AnalyticsRollupLambda.
 *
 * Daily scheduled Lambda that:
 *   1. Enumerates every active tenant via `tenant-enumerator`.
 *   2. For each tenant, queries yesterday's DAY rows on the analytics table.
 *   3. Rolls those rows up into WEEK#yyyy-Www and MONTH#yyyy-mm SKs on the
 *      same tenant partition. Uses ADD for idempotent-safe counters BUT
 *      protects against double-processing via a sentinel row
 *      `ROLLUP_PROCESSED#<date>` with ConditionExpression
 *      `attribute_not_exists(SK)`.
 *   4. Writes FLEET#ALL partition rows for active/inactive/dormant/at-risk
 *      tenant counts.
 *   5. Runs the dormancy state machine: on transition from 2 → 3 consecutive
 *      dormant weeks, emits a `TenantDormant` EventBridge event.
 *   6. Publishes `RollupTenantsProcessed` CloudWatch custom metric.
 *
 * Supports `DATE_OVERRIDE=yyyy-mm-dd` env var so tests and the backfill
 * script can invoke the Lambda with a synthetic date.
 */

import {
  DynamoDBClient,
  QueryCommand,
  type AttributeValue,
  type TransactWriteItem,
  TransactWriteItemsCommand,
} from '@aws-sdk/client-dynamodb';
import {
  PutItemCommand,
  ConditionalCheckFailedException,
} from '@aws-sdk/client-dynamodb';
import {
  CloudWatchClient,
  PutMetricDataCommand,
} from '@aws-sdk/client-cloudwatch';
import {
  EventBridgeClient,
  PutEventsCommand,
} from '@aws-sdk/client-eventbridge';
import {
  enumerateActiveTenants,
  type ActiveTenant,
} from '../shared/tenant-enumerator';
import {
  resolveTargetDate,
  toDateKey,
  toWeekKey,
  toMonthKey,
  shiftDays,
  secondsFromNow,
  type DateKey,
} from './date-utils';

const ddb = new DynamoDBClient({ region: process.env.AWS_REGION, maxAttempts: 3 });
const cw = new CloudWatchClient({ region: process.env.AWS_REGION, maxAttempts: 3 });
const eb = new EventBridgeClient({ region: process.env.AWS_REGION, maxAttempts: 3 });

const ANALYTICS_TABLE = process.env.ANALYTICS_TABLE_NAME!;
const IDENTITY_TABLE = process.env.IDENTITY_TABLE_NAME ?? 'edforge-identity-basic';
const EVENT_BUS_NAME = process.env.EVENT_BUS_NAME;
const ENABLED = process.env.ANALYTICS_ENABLED === 'true';

const WRITE_EVENT_METRICS = new Set([
  'academics.attendance.recorded',
  'academics.attendance.bulk_section',
  'academics.attendance.bulk_recorded',
  'academics.attendance.section',
  'academics.grade.recorded',
  'academics.grade.bulk_recorded',
  'academics.enrollment.completed',
  'user.create',
  'identity.user.created',
  'finance.invoice.created',
  'finance.payment.success',
]);

// ----------------------------------------------------------------------
// Logging
// ----------------------------------------------------------------------
function log(level: 'info' | 'warn' | 'error', msg: string, ctx: Record<string, unknown> = {}): void {
  // eslint-disable-next-line no-console
  (level === 'error' ? console.error : level === 'warn' ? console.warn : console.log)(
    JSON.stringify({ level, msg, ...ctx }),
  );
}

// ----------------------------------------------------------------------
// Sentinel — "have we already rolled this tenant-date up?"
// ----------------------------------------------------------------------
async function markSentinel(tenantId: string, date: DateKey): Promise<boolean> {
  try {
    await ddb.send(
      new PutItemCommand({
        TableName: ANALYTICS_TABLE,
        Item: {
          PK: { S: `TENANT#${tenantId}` },
          SK: { S: `ROLLUP_PROCESSED#${date}` },
          processedAt: { S: new Date().toISOString() },
          expireAt: { N: String(secondsFromNow(400)) }, // sentinel lives ~13mo
        },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
    return true;
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return false;
    throw err;
  }
}

// ----------------------------------------------------------------------
// Read DAY rows for a tenant on a specific date.
// ----------------------------------------------------------------------
interface DayRow {
  sk: string; // DAY#yyyy-mm-dd#<metric>[#role=..|#school=..]
  metric: string;
  count: number;
  role?: string;
  schoolId?: string;
}

function parseDaySk(sk: string): Omit<DayRow, 'sk' | 'count'> | null {
  // Format: DAY#yyyy-mm-dd#<metric>[#role=<role>][#school=<sid>]
  const rest = sk.replace(/^DAY#\d{4}-\d{2}-\d{2}#/, '');
  if (rest === sk) return null;
  const parts = rest.split('#');
  const metric = parts[0];
  if (!metric) return null;
  let role: string | undefined;
  let schoolId: string | undefined;
  for (const p of parts.slice(1)) {
    if (p.startsWith('role=')) role = p.slice(5);
    else if (p.startsWith('school=')) schoolId = p.slice(7);
  }
  return { metric, role, schoolId };
}

async function readDayRows(tenantId: string, date: DateKey): Promise<DayRow[]> {
  const rows: DayRow[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: ANALYTICS_TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: {
          ':pk': { S: `TENANT#${tenantId}` },
          ':prefix': { S: `DAY#${date}#` },
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of r.Items || []) {
      const sk = item.SK?.S;
      if (!sk) continue;
      const parsed = parseDaySk(sk);
      if (!parsed) continue;
      rows.push({
        sk,
        metric: parsed.metric,
        role: parsed.role,
        schoolId: parsed.schoolId,
        count: Number(item.count?.N ?? '0'),
      });
    }
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return rows;
}

// ----------------------------------------------------------------------
// Build WEEK + MONTH update items for one tenant's DAY rows.
// ----------------------------------------------------------------------
function buildRollupWrites(
  tenantId: string,
  targetDate: Date,
  dayRows: DayRow[],
): TransactWriteItem[] {
  if (dayRows.length === 0) return [];
  const pk = `TENANT#${tenantId}`;
  const weekKey = toWeekKey(targetDate);
  const monthKey = toMonthKey(targetDate);
  const weekExpireAt = secondsFromNow(400);
  const monthExpireAt = secondsFromNow(400);
  const writes: TransactWriteItem[] = [];

  for (const row of dayRows) {
    const dims: string[] = [];
    if (row.role) dims.push(`#role=${row.role}`);
    if (row.schoolId) dims.push(`#school=${row.schoolId}`);
    const suffix = dims.join('');

    const weekSk = `WEEK#${weekKey}#${row.metric}${suffix}`;
    const monthSk = `MONTH#${monthKey}#${row.metric}${suffix}`;

    // PII invariant guard — same as aggregator
    for (const sk of [weekSk, monthSk]) {
      if (/userId|user=|USER#/i.test(sk)) {
        throw new Error(`PII invariant violation in rollup SK: ${sk}`);
      }
    }

    for (const [sk, expireAt] of [
      [weekSk, weekExpireAt],
      [monthSk, monthExpireAt],
    ] as Array<[string, number]>) {
      writes.push({
        Update: {
          TableName: ANALYTICS_TABLE,
          Key: { PK: { S: pk }, SK: { S: sk } },
          UpdateExpression:
            'ADD #count :v SET expireAt = if_not_exists(expireAt, :expireAt), lastUpdated = :now',
          ExpressionAttributeNames: { '#count': 'count' },
          ExpressionAttributeValues: {
            ':v': { N: String(row.count) },
            ':expireAt': { N: String(expireAt) },
            ':now': { S: new Date().toISOString() },
          },
        },
      });
    }
  }
  return writes;
}

// ----------------------------------------------------------------------
// Fleet counts: active / inactive / dormant / at-risk
//
// For each tenant, we look back 7, 14, 21 days at write-event activity.
//   active   ≥1 write event in past 7 days
//   inactive 0 in past 7, ≥1 in past 30
//   dormant  0 in past 14
//   at-risk  0 in past 21
// (a tenant can be both dormant AND at-risk; these are independent counters)
// ----------------------------------------------------------------------
interface FleetCounts {
  active: number;
  inactive: number;
  dormant: number;
  atRisk: number;
  dormantTenantIds: string[]; // for the dormancy state machine
}

async function countWriteEventsInWindow(
  tenantId: string,
  fromDate: Date,
  toDate: Date,
): Promise<number> {
  // Scan DAY rows between fromDate..toDate for write-event metrics.
  let total = 0;
  const from = toDateKey(fromDate);
  const to = toDateKey(toDate);
  let lastKey: Record<string, AttributeValue> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: ANALYTICS_TABLE,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :a AND :b',
        ExpressionAttributeValues: {
          ':pk': { S: `TENANT#${tenantId}` },
          ':a': { S: `DAY#${from}#` },
          ':b': { S: `DAY#${to}#\uffff` },
        },
        ExclusiveStartKey: lastKey,
      }),
    );
    for (const item of r.Items || []) {
      const sk = item.SK?.S;
      if (!sk) continue;
      const parsed = parseDaySk(sk);
      if (!parsed) continue;
      // Only count TOTAL rows (no role=/school= suffix) to avoid double-counting.
      if (parsed.role || parsed.schoolId) continue;
      if (WRITE_EVENT_METRICS.has(parsed.metric)) {
        total += Number(item.count?.N ?? '0');
      }
    }
    lastKey = r.LastEvaluatedKey;
  } while (lastKey);
  return total;
}

async function computeFleetCounts(
  tenants: ActiveTenant[],
  targetDate: Date,
): Promise<FleetCounts> {
  const counts: FleetCounts = {
    active: 0,
    inactive: 0,
    dormant: 0,
    atRisk: 0,
    dormantTenantIds: [],
  };

  for (const t of tenants) {
    const writes7 = await countWriteEventsInWindow(
      t.tenantId,
      shiftDays(targetDate, -6),
      targetDate,
    );
    const writes30 = await countWriteEventsInWindow(
      t.tenantId,
      shiftDays(targetDate, -29),
      targetDate,
    );
    const writes14 = await countWriteEventsInWindow(
      t.tenantId,
      shiftDays(targetDate, -13),
      targetDate,
    );
    const writes21 = await countWriteEventsInWindow(
      t.tenantId,
      shiftDays(targetDate, -20),
      targetDate,
    );

    if (writes7 > 0) counts.active++;
    else if (writes30 > 0) counts.inactive++;

    if (writes14 === 0) {
      counts.dormant++;
      counts.dormantTenantIds.push(t.tenantId);
    }
    if (writes21 === 0) counts.atRisk++;
  }
  return counts;
}

async function writeFleetRow(
  date: DateKey,
  counts: FleetCounts,
): Promise<void> {
  const expireAt = secondsFromNow(400);
  await ddb.send(
    new PutItemCommand({
      TableName: ANALYTICS_TABLE,
      Item: {
        PK: { S: 'FLEET#ALL' },
        SK: { S: `DAY#${date}#tenant.status` },
        active: { N: String(counts.active) },
        inactive: { N: String(counts.inactive) },
        dormant: { N: String(counts.dormant) },
        atRisk: { N: String(counts.atRisk) },
        lastUpdated: { S: new Date().toISOString() },
        expireAt: { N: String(expireAt) },
      },
    }),
  );
}

// ----------------------------------------------------------------------
// Dormancy state machine
//
// For each tenant, look at the last 3 ISO weeks (including targetDate's).
// If all three have zero write events → emit TenantDormant (once per
// transition — we use a sentinel row DORMANT_EMITTED#<week>).
// ----------------------------------------------------------------------
async function hasRecentWriteEvents(
  tenantId: string,
  weekStart: Date,
): Promise<boolean> {
  const end = shiftDays(weekStart, 6);
  const count = await countWriteEventsInWindow(tenantId, weekStart, end);
  return count > 0;
}

async function maybeEmitDormancy(
  tenantId: string,
  targetDate: Date,
): Promise<'emitted' | 'already_emitted' | 'not_dormant'> {
  // Compute the three most recent complete weeks ending on the Sunday that
  // precedes targetDate (ISO week uses Monday start; we use a coarse 7-day
  // bucket here — good enough for a "3 weeks of silence" gate).
  const wk0Start = shiftDays(targetDate, -6);
  const wk1Start = shiftDays(targetDate, -13);
  const wk2Start = shiftDays(targetDate, -20);

  const [w0, w1, w2] = await Promise.all([
    hasRecentWriteEvents(tenantId, wk0Start),
    hasRecentWriteEvents(tenantId, wk1Start),
    hasRecentWriteEvents(tenantId, wk2Start),
  ]);
  if (w0 || w1 || w2) return 'not_dormant';

  // One-shot sentinel keyed on the target week so re-running the same date
  // (idempotent replays) won't re-emit.
  const weekKey = toWeekKey(targetDate);
  try {
    await ddb.send(
      new PutItemCommand({
        TableName: ANALYTICS_TABLE,
        Item: {
          PK: { S: `TENANT#${tenantId}` },
          SK: { S: `DORMANT_EMITTED#${weekKey}` },
          emittedAt: { S: new Date().toISOString() },
          expireAt: { N: String(secondsFromNow(400)) },
        },
        ConditionExpression: 'attribute_not_exists(SK)',
      }),
    );
  } catch (err) {
    if (err instanceof ConditionalCheckFailedException) return 'already_emitted';
    throw err;
  }

  if (EVENT_BUS_NAME) {
    await eb.send(
      new PutEventsCommand({
        Entries: [
          {
            Source: 'edforge.analytics',
            DetailType: 'TenantDormant',
            EventBusName: EVENT_BUS_NAME,
            Detail: JSON.stringify({
              schemaVersion: 1,
              eventId: `dormant-${tenantId}-${weekKey}`,
              ts: new Date().toISOString(),
              tenantId,
              tenantTier: 'BASIC',
              userId: 'system',
              role: 'SystemAdmin',
              feature: 'tenant',
              action: 'dormant.transition',
              metadata: { weekKey, consecutiveDormantWeeks: 3 },
            }),
          },
        ],
      }),
    );
  }
  return 'emitted';
}

// ----------------------------------------------------------------------
// Main handler
// ----------------------------------------------------------------------
interface RollupEvent {
  date?: string;
}

export const handler = async (event: RollupEvent = {}): Promise<{
  processed: number;
  skipped: number;
  dormant: number;
  targetDate: string;
}> => {
  if (!ENABLED) {
    log('info', 'rollup skipped — ANALYTICS_ENABLED=false');
    return { processed: 0, skipped: 0, dormant: 0, targetDate: 'disabled' };
  }

  const targetDate = resolveTargetDate(event);
  const dateKey = toDateKey(targetDate);
  const tenants = await enumerateActiveTenants(ddb, { tableName: IDENTITY_TABLE });
  log('info', `rollup starting`, {
    targetDate: dateKey,
    tenantCount: tenants.length,
  });

  let processed = 0;
  let skipped = 0;

  for (const t of tenants) {
    const logCtx = { tenantId: t.tenantId, targetDate: dateKey };
    let sentinelOk = false;
    try {
      sentinelOk = await markSentinel(t.tenantId, dateKey);
    } catch (err) {
      log('error', `sentinel write failed: ${(err as Error).message}`, logCtx);
      continue;
    }
    if (!sentinelOk) {
      log('info', 'tenant already rolled up — skipped', logCtx);
      skipped++;
      continue;
    }
    const dayRows = await readDayRows(t.tenantId, dateKey);
    if (dayRows.length === 0) {
      log('info', 'no DAY rows for tenant', logCtx);
      processed++;
      continue;
    }
    const writes = buildRollupWrites(t.tenantId, targetDate, dayRows);
    // TransactWriteItems limit is 100 items. Chunk as needed.
    for (let i = 0; i < writes.length; i += 100) {
      const chunk = writes.slice(i, i + 100);
      try {
        await ddb.send(new TransactWriteItemsCommand({ TransactItems: chunk }));
      } catch (err) {
        log('error', `rollup TransactWrite failed: ${(err as Error).message}`, logCtx);
      }
    }
    processed++;
  }

  // Fleet counts + dormancy.
  let fleetCounts: FleetCounts = {
    active: 0,
    inactive: 0,
    dormant: 0,
    atRisk: 0,
    dormantTenantIds: [],
  };
  try {
    fleetCounts = await computeFleetCounts(tenants, targetDate);
    await writeFleetRow(dateKey, fleetCounts);
  } catch (err) {
    log('error', `fleet computation failed: ${(err as Error).message}`, {
      targetDate: dateKey,
    });
  }

  let emittedDormant = 0;
  for (const tid of fleetCounts.dormantTenantIds) {
    try {
      const outcome = await maybeEmitDormancy(tid, targetDate);
      if (outcome === 'emitted') emittedDormant++;
    } catch (err) {
      log('error', `dormancy emit failed for ${tid}: ${(err as Error).message}`, {
        tenantId: tid,
      });
    }
  }

  try {
    await cw.send(
      new PutMetricDataCommand({
        Namespace: 'Edforge/Analytics',
        MetricData: [
          {
            MetricName: 'RollupTenantsProcessed',
            Value: processed,
            Unit: 'Count',
            Dimensions: [{ Name: 'DateKey', Value: dateKey }],
          },
          {
            MetricName: 'RollupTenantsSkipped',
            Value: skipped,
            Unit: 'Count',
          },
          {
            MetricName: 'FleetActive',
            Value: fleetCounts.active,
            Unit: 'Count',
          },
          {
            MetricName: 'FleetDormant',
            Value: fleetCounts.dormant,
            Unit: 'Count',
          },
        ],
      }),
    );
  } catch (err) {
    log('warn', `CW metric publish failed: ${(err as Error).message}`, {
      targetDate: dateKey,
    });
  }

  log('info', 'rollup complete', {
    targetDate: dateKey,
    processed,
    skipped,
    emittedDormant,
    fleet: fleetCounts,
  });
  return {
    processed,
    skipped,
    dormant: emittedDormant,
    targetDate: dateKey,
  };
};
