/**
 * Layer 6.3 — AnalyticsRollupLambda.
 *
 * Daily scheduled Lambda that:
 *   1. Enumerates every active tenant via `tenant-enumerator`.
 *   2. For each tenant, reads ALL DAY rows for the WEEK and MONTH that contain
 *      `targetDate`, sums by (metric, role?, school?), and SETs the
 *      `WEEK#yyyy-Www#metric…` and `MONTH#yyyy-mm#metric…` rows from the
 *      computed sums. SET (overwrite) semantics make the rollup idempotent
 *      under repeated invocation AND correct under late-arriving DAY writes —
 *      replacing the prior ADD-with-sentinel design that silently undercounted
 *      events that arrived after the per-tenant-per-date sentinel was written.
 *      A non-gating `ROLLUP_PROCESSED#<date>` sentinel is still written for
 *      observability (operator can see when each tenant was last processed).
 *   3. Writes FLEET#ALL partition rows for active/inactive/dormant/at-risk
 *      tenant counts.
 *   4. Runs the dormancy state machine: on transition from 2 → 3 consecutive
 *      dormant weeks, emits a `TenantDormant` EventBridge event.
 *   5. Publishes `RollupTenantsProcessed` CloudWatch custom metric.
 *
 * Supports `DATE_OVERRIDE=yyyy-mm-dd` env var so tests and the backfill
 * script can invoke the Lambda with a synthetic date; also accepts
 * `event.date` for ad-hoc invocation.
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
  DEFAULT_TIMEZONE,
  resolveTargetDate,
  toDateKey,
  toWeekKey,
  toMonthKey,
  shiftDays,
  secondsFromNow,
  type DateKey,
} from '../shared/date-utils';

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
// Sentinel — observability marker (NOT a gate). Records "we last touched
// this tenant-date here" so operators can audit rollup runs without
// preventing recomputation on late-arriving DAY rows.
// ----------------------------------------------------------------------
async function writeSentinel(tenantId: string, date: DateKey): Promise<void> {
  await ddb.send(
    new PutItemCommand({
      TableName: ANALYTICS_TABLE,
      Item: {
        PK: { S: `TENANT#${tenantId}` },
        SK: { S: `ROLLUP_PROCESSED#${date}` },
        processedAt: { S: new Date().toISOString() },
        expireAt: { N: String(secondsFromNow(400)) }, // sentinel lives ~13mo
      },
    }),
  );
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

/**
 * Read all DAY rows for a tenant in the inclusive `[fromDate, toDate]`
 * range. Used by the WEEK/MONTH rollup pass — we read once per tenant
 * and slice into week vs. month sets in memory.
 */
async function readDayRowsInRange(
  tenantId: string,
  fromDate: DateKey,
  toDate: DateKey,
): Promise<DayRow[]> {
  const rows: DayRow[] = [];
  let lastKey: Record<string, AttributeValue> | undefined;
  do {
    const r = await ddb.send(
      new QueryCommand({
        TableName: ANALYTICS_TABLE,
        KeyConditionExpression: 'PK = :pk AND SK BETWEEN :a AND :b',
        ExpressionAttributeValues: {
          ':pk': { S: `TENANT#${tenantId}` },
          ':a': { S: `DAY#${fromDate}#` },
          ':b': { S: `DAY#${toDate}#\uffff` },
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

/** Extract the yyyy-mm-dd date out of a DAY SK. */
function dayKeyFromSk(sk: string): DateKey | null {
  const m = /^DAY#(\d{4}-\d{2}-\d{2})#/.exec(sk);
  return m ? (m[1] as DateKey) : null;
}

/**
 * ISO week range [Mon, Sun] for the calendar day containing `targetDate`
 * in the given tz. Returns DateKey strings (yyyy-mm-dd).
 */
function isoWeekRange(targetDate: Date, tz: string = DEFAULT_TIMEZONE): {
  start: DateKey;
  end: DateKey;
} {
  // ISO week starts on Monday. Convert local-day-of-week to 1..7 (Mon..Sun)
  // and shift back to Monday.
  const localKey = toDateKey(targetDate, tz);
  const [y, m, d] = localKey.split('-').map(Number);
  const utcAnchor = new Date(Date.UTC(y, m - 1, d));
  const dayNum = utcAnchor.getUTCDay() === 0 ? 7 : utcAnchor.getUTCDay();
  const monday = shiftDays(targetDate, -(dayNum - 1), tz);
  const sunday = shiftDays(monday, 6, tz);
  return { start: toDateKey(monday, tz), end: toDateKey(sunday, tz) };
}

/**
 * Calendar month range [first, last] for the day containing `targetDate`
 * in the given tz.
 */
function monthRange(targetDate: Date, tz: string = DEFAULT_TIMEZONE): {
  start: DateKey;
  end: DateKey;
} {
  const localKey = toDateKey(targetDate, tz);
  const [y, m] = localKey.split('-').map(Number);
  const start = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-01` as DateKey;
  // last day of month: Date(year, month, 0) gives last day of previous month;
  // Date(y, m, 0) → m here is 1-indexed input → last day of month m
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const end = `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` as DateKey;
  return { start, end };
}

// ----------------------------------------------------------------------
// Aggregate DayRows by (metric, role?, school?) → sum of counts.
// ----------------------------------------------------------------------
interface AggregatedRow {
  metric: string;
  role?: string;
  schoolId?: string;
  count: number;
}

function aggregateDayRows(rows: DayRow[]): AggregatedRow[] {
  const buckets = new Map<string, AggregatedRow>();
  for (const r of rows) {
    const key = `${r.metric}|${r.role ?? ''}|${r.schoolId ?? ''}`;
    const existing = buckets.get(key);
    if (existing) existing.count += r.count;
    else
      buckets.set(key, {
        metric: r.metric,
        role: r.role,
        schoolId: r.schoolId,
        count: r.count,
      });
  }
  return Array.from(buckets.values());
}

/**
 * Build SET-semantics writes for a bucket of DAY rows (week or month
 * range). Overwrites the aggregate row's count with the computed sum,
 * which makes the rollup idempotent and correct under late-arriving
 * DAY writes.
 *
 * `prefix` is `WEEK` or `MONTH`; `key` is the WeekKey/MonthKey string.
 */
function buildAggregateWrites(
  tenantId: string,
  prefix: 'WEEK' | 'MONTH',
  key: string,
  aggregated: AggregatedRow[],
): TransactWriteItem[] {
  if (aggregated.length === 0) return [];
  const pk = `TENANT#${tenantId}`;
  const expireAt = secondsFromNow(400);
  const now = new Date().toISOString();
  const writes: TransactWriteItem[] = [];

  for (const a of aggregated) {
    const dims: string[] = [];
    if (a.role) dims.push(`#role=${a.role}`);
    if (a.schoolId) dims.push(`#school=${a.schoolId}`);
    const sk = `${prefix}#${key}#${a.metric}${dims.join('')}`;

    // PII invariant guard — same as aggregator
    if (/userId|user=|USER#/i.test(sk)) {
      throw new Error(`PII invariant violation in rollup SK: ${sk}`);
    }

    writes.push({
      Update: {
        TableName: ANALYTICS_TABLE,
        Key: { PK: { S: pk }, SK: { S: sk } },
        UpdateExpression:
          'SET #count = :v, expireAt = if_not_exists(expireAt, :expireAt), lastUpdated = :now',
        ExpressionAttributeNames: { '#count': 'count' },
        ExpressionAttributeValues: {
          ':v': { N: String(a.count) },
          ':expireAt': { N: String(expireAt) },
          ':now': { S: now },
        },
      },
    });
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

  // Compute the WEEK and MONTH ranges that contain targetDate. We read DAY
  // rows once per tenant for the union range, then slice in memory so each
  // tenant gets exactly one DDB Query for the rollup pass.
  const week = isoWeekRange(targetDate);
  const month = monthRange(targetDate);
  const unionStart = week.start < month.start ? week.start : month.start;
  const unionEnd = week.end > month.end ? week.end : month.end;
  const weekKey = toWeekKey(targetDate);
  const monthKey = toMonthKey(targetDate);

  for (const t of tenants) {
    const logCtx = { tenantId: t.tenantId, targetDate: dateKey };

    // Observability sentinel — non-gating. Records "we touched this
    // tenant-date here". Repeated invocations overwrite freely.
    try {
      await writeSentinel(t.tenantId, dateKey);
    } catch (err) {
      log('warn', `sentinel write failed: ${(err as Error).message}`, logCtx);
      // Continue — sentinel is informational, not a blocker.
    }

    let allRows: DayRow[];
    try {
      allRows = await readDayRowsInRange(t.tenantId, unionStart, unionEnd);
    } catch (err) {
      log('error', `range read failed: ${(err as Error).message}`, logCtx);
      skipped++;
      continue;
    }
    if (allRows.length === 0) {
      log('info', 'no DAY rows for tenant in range', { ...logCtx, unionStart, unionEnd });
      processed++;
      continue;
    }

    const weekRows = allRows.filter((r) => {
      const d = dayKeyFromSk(r.sk);
      return d !== null && d >= week.start && d <= week.end;
    });
    const monthRows = allRows.filter((r) => {
      const d = dayKeyFromSk(r.sk);
      return d !== null && d >= month.start && d <= month.end;
    });

    const writes: TransactWriteItem[] = [
      ...buildAggregateWrites(t.tenantId, 'WEEK', weekKey, aggregateDayRows(weekRows)),
      ...buildAggregateWrites(t.tenantId, 'MONTH', monthKey, aggregateDayRows(monthRows)),
    ];

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
