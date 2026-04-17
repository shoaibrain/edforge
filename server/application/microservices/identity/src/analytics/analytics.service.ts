/**
 * Layer 7 — Analytics read-path service.
 *
 * Queries the DynamoDB tables populated by Layer 5 (aggregator) and Layer 6
 * (rollup + fleet counts). All queries scope on a server-validated PK; the
 * controller enforces authz BEFORE calling any service method — this service
 * never takes a "role" arg and never branches on it.
 *
 * Tables consumed:
 *   - edforge-analytics              aggregates (DAY/WEEK/MONTH + FLEET#ALL)
 *   - edforge-user-session-events    per-user session history
 *
 * IAM: the identity ECS task role must have dynamodb:Query on both tables.
 * Wire that in Layer 11's deploy sequence (analytics-stack export of ARNs,
 * tenant-template attaches a policy).
 */

import { Injectable, Logger } from '@nestjs/common';
import {
  DynamoDBClient,
  QueryCommand,
  type AttributeValue,
} from '@aws-sdk/client-dynamodb';
import {
  THRESHOLDS,
  GRACE_PERIOD_DAYS,
  classifyMetric,
  classifyWeekly,
  type AdoptionMetricKey,
  type AdoptionStatus,
} from './adoption-thresholds';

export type Granularity = 'day' | 'week' | 'month';

export interface MetricSeriesPoint {
  date: string;
  value: number;
  breakdown?: Record<string, number>;
}

export interface MetricSeries {
  metric: string;
  series: MetricSeriesPoint[];
}

export interface AdoptionReport {
  tenantId: string;
  weekKey: string;
  inGracePeriod: boolean;
  perMetric: Record<
    AdoptionMetricKey,
    { value: number; threshold: number; status: AdoptionStatus }
  >;
  overall: AdoptionStatus;
}

export interface FleetSummary {
  active: number;
  inactive: number;
  dormant: number;
  atRisk: number;
  topFeatures: Array<{ metric: string; totalCount: number }>;
}

export interface SessionHistoryEvent {
  ts: string;
  eventType: string;
  ipAddress?: string;
  deviceInfo?: Record<string, unknown>;
}

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);
  private readonly ddb: DynamoDBClient;
  private readonly analyticsTable: string;
  private readonly sessionTable: string;

  constructor() {
    this.ddb = new DynamoDBClient({ region: process.env.AWS_REGION });
    this.analyticsTable =
      process.env.ANALYTICS_TABLE_NAME || 'edforge-analytics';
    this.sessionTable =
      process.env.USER_SESSION_EVENTS_TABLE_NAME ||
      'edforge-user-session-events';
  }

  // --------------------------------------------------------------
  // 7.1 — time-series per tenant, per granularity
  // --------------------------------------------------------------
  async getTenantTimeSeries(
    tenantId: string,
    from: string,
    to: string,
    granularity: Granularity,
  ): Promise<MetricSeries[]> {
    const skPrefix = granularity.toUpperCase() + '#'; // DAY# | WEEK# | MONTH#
    const items = await this.queryAllPages({
      TableName: this.analyticsTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `TENANT#${tenantId}` },
        ':prefix': { S: skPrefix },
      },
    });

    // Group into series by metric.
    const byMetric = new Map<string, Map<string, MetricSeriesPoint>>();
    for (const item of items) {
      const sk = item.SK?.S;
      if (!sk) continue;
      const parsed = parseAggregateSk(sk);
      if (!parsed || parsed.bucket !== granularity.toUpperCase()) continue;
      if (parsed.date < from || parsed.date > to) continue;

      const count = Number(item.count?.N ?? '0');
      const seriesMap =
        byMetric.get(parsed.metric) ||
        byMetric.set(parsed.metric, new Map()).get(parsed.metric)!;

      const existing = seriesMap.get(parsed.date) ?? {
        date: parsed.date,
        value: 0,
        breakdown: {},
      };
      if (!parsed.role && !parsed.schoolId) {
        existing.value = count; // total row is authoritative for the point's value
      } else if (parsed.role) {
        existing.breakdown = existing.breakdown || {};
        existing.breakdown[`role=${parsed.role}`] = count;
      } else if (parsed.schoolId) {
        existing.breakdown = existing.breakdown || {};
        existing.breakdown[`school=${parsed.schoolId}`] = count;
      }
      seriesMap.set(parsed.date, existing);
    }

    return [...byMetric.entries()].map(([metric, seriesMap]) => ({
      metric,
      series: [...seriesMap.values()].sort((a, b) => a.date.localeCompare(b.date)),
    }));
  }

  // --------------------------------------------------------------
  // 7.2 — adoption report for a given ISO week
  // --------------------------------------------------------------
  async getAdoptionReport(
    tenantId: string,
    weekKey: string,
    tenantProvisionedAt: string,
  ): Promise<AdoptionReport> {
    const items = await this.queryAllPages({
      TableName: this.analyticsTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `TENANT#${tenantId}` },
        ':prefix': { S: `WEEK#${weekKey}#` },
      },
    });

    // Aggregate total-row counts by metric name.
    const totals = new Map<string, number>();
    for (const item of items) {
      const sk = item.SK?.S;
      if (!sk) continue;
      const parsed = parseAggregateSk(sk);
      if (!parsed || parsed.role || parsed.schoolId) continue;
      totals.set(parsed.metric, Number(item.count?.N ?? '0'));
    }

    const inGracePeriod = isInGracePeriod(tenantProvisionedAt, weekKey);

    // Map the 6 adoption metrics to their aggregator metric names. If the
    // source metric isn't yet produced (e.g., parentPortalReach requires a
    // parent-portal publisher that doesn't exist yet), we still return a
    // row with value=0 so the UI can render consistently — tests assert this.
    const source: Record<AdoptionMetricKey, string[]> = {
      teacherLoginCadence:    ['auth.login.success'],
      attendanceCoverage:     ['academics.attendance.recorded', 'academics.attendance.bulk_section'],
      gradeSubmissionCadence: ['academics.grade.recorded', 'academics.grade.bulk_recorded'],
      adminActivity:          ['user.create', 'user.update', 'identity.user.created'],
      parentPortalReach:      ['feature.usage'],
      studentPortalReach:     ['feature.usage'],
    };

    const perMetric: Record<
      AdoptionMetricKey,
      { value: number; threshold: number; status: AdoptionStatus }
    > = {} as any;

    for (const key of Object.keys(THRESHOLDS) as AdoptionMetricKey[]) {
      const raw = source[key].reduce((a, m) => a + (totals.get(m) ?? 0), 0);
      // Normalize to [0..1] for fraction metrics; adminActivity is binary (≥1).
      const value =
        key === 'adminActivity' ? Math.min(raw, 1) : normalizeFraction(raw);
      const t = inGracePeriod ? THRESHOLDS[key].grace : THRESHOLDS[key].steady;
      perMetric[key] = {
        value,
        threshold: t,
        status: classifyMetric(value, THRESHOLDS[key], inGracePeriod),
      };
    }

    const overall = classifyWeekly(
      Object.fromEntries(
        Object.entries(perMetric).map(([k, v]) => [k, v.status]),
      ) as Record<AdoptionMetricKey, AdoptionStatus>,
    );

    return {
      tenantId,
      weekKey,
      inGracePeriod,
      perMetric,
      overall,
    };
  }

  // --------------------------------------------------------------
  // 7.3 — fleet summary
  // --------------------------------------------------------------
  async getFleetSummary(from: string, to: string): Promise<FleetSummary> {
    // Latest FLEET#ALL DAY row in the range (or the most recent in-range row).
    const fleetItems = await this.queryAllPages({
      TableName: this.analyticsTable,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :a AND :b',
      ExpressionAttributeValues: {
        ':pk': { S: 'FLEET#ALL' },
        ':a': { S: `DAY#${from}#` },
        ':b': { S: `DAY#${to}#\uffff` },
      },
    });
    const latest = fleetItems
      .slice()
      .sort((a, b) => (a.SK?.S ?? '').localeCompare(b.SK?.S ?? ''))
      .pop();

    const active = Number(latest?.active?.N ?? '0');
    const inactive = Number(latest?.inactive?.N ?? '0');
    const dormant = Number(latest?.dormant?.N ?? '0');
    const atRisk = Number(latest?.atRisk?.N ?? '0');

    // Top features via GSI1: iterate GSI1PK starting with FEATURE# would
    // require a scan; instead, read FEATURE#<metric> partitions for a
    // predefined candidate list. In V1 we keep it simple: scan GSI1 within
    // the date range for each well-known write-metric.
    const candidateMetrics = [
      'academics.attendance.recorded',
      'academics.attendance.bulk_section',
      'academics.grade.recorded',
      'academics.grade.bulk_recorded',
      'academics.enrollment.completed',
      'finance.invoice.created',
      'finance.payment.success',
      'auth.login.success',
      'session.create',
      'user.create',
      'feature.usage',
    ];
    const topFeatures: Array<{ metric: string; totalCount: number }> = [];
    for (const metric of candidateMetrics) {
      const rows = await this.queryAllPages({
        TableName: this.analyticsTable,
        IndexName: 'GSI1',
        KeyConditionExpression:
          'GSI1PK = :pk AND GSI1SK BETWEEN :a AND :b',
        ExpressionAttributeValues: {
          ':pk': { S: `FEATURE#${metric}` },
          ':a': { S: `${from}#` },
          ':b': { S: `${to}#\uffff` },
        },
      });
      const total = rows.reduce(
        (acc, r) => acc + Number(r.count?.N ?? '0'),
        0,
      );
      if (total > 0) topFeatures.push({ metric, totalCount: total });
    }
    topFeatures.sort((a, b) => b.totalCount - a.totalCount);

    return { active, inactive, dormant, atRisk, topFeatures: topFeatures.slice(0, 10) };
  }

  // --------------------------------------------------------------
  // 7.4 — per-user session history
  // --------------------------------------------------------------
  async getSessionHistory(
    userId: string,
    days: number,
  ): Promise<SessionHistoryEvent[]> {
    const now = new Date();
    const from = new Date(now.getTime() - days * 86400_000);
    const items = await this.queryAllPages({
      TableName: this.sessionTable,
      KeyConditionExpression: 'PK = :pk AND SK BETWEEN :a AND :b',
      ExpressionAttributeValues: {
        ':pk': { S: `USER#${userId}` },
        ':a': { S: `EVENT#${from.toISOString()}` },
        ':b': { S: `EVENT#${now.toISOString()}\uffff` },
      },
    });
    return items.map((item) => {
      const sk = item.SK?.S ?? '';
      const ts = sk.replace(/^EVENT#/, '').split('#')[0];
      const devInfo = item.deviceInfo?.S
        ? safeParse(item.deviceInfo.S)
        : undefined;
      return {
        ts,
        eventType: item.eventType?.S ?? 'unknown',
        ipAddress: item.ipAddress?.S,
        deviceInfo: devInfo,
      };
    });
  }

  // --------------------------------------------------------------
  // 7.5 — CSV export (streamed to the controller for chunked response)
  //
  // Returns an async iterator of string chunks (header first, then rows).
  // Caller is responsible for pipe-to-HTTP. This keeps the service
  // testable without depending on Express Response.
  // --------------------------------------------------------------
  async *streamExportCsv(
    tenantId: string,
    from: string,
    to: string,
    granularity: Granularity,
  ): AsyncGenerator<string> {
    yield 'date,metric,value,dimension,dimensionValue\n';
    const skPrefix = granularity.toUpperCase() + '#';
    let lastKey: Record<string, AttributeValue> | undefined;
    do {
      const r = await this.ddb.send(
        new QueryCommand({
          TableName: this.analyticsTable,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
          ExpressionAttributeValues: {
            ':pk': { S: `TENANT#${tenantId}` },
            ':prefix': { S: skPrefix },
          },
          ExclusiveStartKey: lastKey,
        }),
      );
      for (const item of r.Items || []) {
        const sk = item.SK?.S;
        if (!sk) continue;
        const parsed = parseAggregateSk(sk);
        if (!parsed) continue;
        if (parsed.date < from || parsed.date > to) continue;
        const value = Number(item.count?.N ?? '0');
        const dim = parsed.role
          ? 'role'
          : parsed.schoolId
          ? 'schoolId'
          : '';
        const dimValue = parsed.role ?? parsed.schoolId ?? '';
        yield `${parsed.date},${parsed.metric},${value},${dim},${dimValue}\n`;
      }
      lastKey = r.LastEvaluatedKey;
    } while (lastKey);
  }

  private async queryAllPages(
    cmd: ConstructorParameters<typeof QueryCommand>[0],
  ): Promise<Record<string, AttributeValue>[]> {
    const out: Record<string, AttributeValue>[] = [];
    let lastKey: Record<string, AttributeValue> | undefined;
    do {
      const r = await this.ddb.send(
        new QueryCommand({ ...cmd, ExclusiveStartKey: lastKey }),
      );
      out.push(...(r.Items || []));
      lastKey = r.LastEvaluatedKey;
    } while (lastKey);
    return out;
  }
}

// --------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------

interface ParsedAggregateSk {
  bucket: 'DAY' | 'WEEK' | 'MONTH';
  date: string; // yyyy-mm-dd | yyyy-Www | yyyy-mm
  metric: string;
  role?: string;
  schoolId?: string;
}

export function parseAggregateSk(sk: string): ParsedAggregateSk | null {
  const m = sk.match(/^(DAY|WEEK|MONTH)#([^#]+)#(.+)$/);
  if (!m) return null;
  const [, bucket, date, rest] = m;
  const [metric, ...dims] = rest.split('#');
  let role: string | undefined;
  let schoolId: string | undefined;
  for (const d of dims) {
    if (d.startsWith('role=')) role = d.slice(5);
    else if (d.startsWith('school=')) schoolId = d.slice(7);
  }
  return {
    bucket: bucket as 'DAY' | 'WEEK' | 'MONTH',
    date,
    metric,
    role,
    schoolId,
  };
}

function safeParse(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

/**
 * Normalize an absolute count to a [0..1] fraction for adoption metrics.
 * V1 compromise: without tenant-size inputs we can't compute real ratios,
 * so we use a logistic-ish curve that treats counts ≥ 20 as a full
 * "active" signal. Good enough for weekly PASS/PARTIAL/FAIL labels; the
 * real ratio computation lands in a later sprint when tenant sizing
 * metadata (teacher count, parent count) is available.
 */
function normalizeFraction(count: number): number {
  if (count <= 0) return 0;
  const x = count / 20;
  return x >= 1 ? 1 : x;
}

/**
 * A tenant is in grace period if the week under report falls within the
 * first GRACE_PERIOD_DAYS (21) days after provisionedAt.
 */
export function isInGracePeriod(
  provisionedAt: string,
  weekKey: string,
): boolean {
  try {
    const provisioned = new Date(provisionedAt);
    if (Number.isNaN(provisioned.getTime())) return false;
    // yyyy-Www → approximate Monday of that week
    const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
    if (!m) return false;
    const year = Number(m[1]);
    const week = Number(m[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfJan4 = (jan4.getUTCDay() + 6) % 7;
    const weekStart = new Date(jan4);
    weekStart.setUTCDate(jan4.getUTCDate() - dayOfJan4 + (week - 1) * 7);
    const daysSinceProvisioned =
      (weekStart.getTime() - provisioned.getTime()) / 86400_000;
    return daysSinceProvisioned <= GRACE_PERIOD_DAYS;
  } catch {
    return false;
  }
}
