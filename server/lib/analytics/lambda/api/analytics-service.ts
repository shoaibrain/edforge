/**
 * Analytics read-path service — framework-agnostic (no Nest).
 *
 * Ported from server/application/microservices/identity/src/analytics/analytics.service.ts
 * for use inside the analytics-api Lambda. Constructor accepts a DDB client
 * and table names explicitly — no process.env reads (the handler resolves
 * those and passes them in).
 */

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
} from './adoption-thresholds';
import type {
  AdoptionMetricKey,
  AdoptionReport,
  AdoptionStatus,
  FleetSummary,
  Granularity,
  MetricSeries,
  MetricSeriesPoint,
  SessionHistoryEvent,
} from '@aibrains/shared-types';

export type {
  AdoptionReport,
  FleetSummary,
  Granularity,
  MetricSeries,
  MetricSeriesPoint,
  SessionHistoryEvent,
};

export interface AnalyticsServiceConfig {
  ddb: DynamoDBClient;
  analyticsTable: string;
  sessionTable: string;
}

export class AnalyticsService {
  private readonly ddb: DynamoDBClient;
  private readonly analyticsTable: string;
  private readonly sessionTable: string;

  constructor(config: AnalyticsServiceConfig) {
    this.ddb = config.ddb;
    this.analyticsTable = config.analyticsTable;
    this.sessionTable = config.sessionTable;
  }

  async getTenantTimeSeries(
    tenantId: string,
    from: string,
    to: string,
    granularity: Granularity,
    /**
     * A-WS3.T4: when set to 'bikram_sambat' AND `enableDualDateDisplay` is
     * true, every series point carries a `dateSecondary` block with the BS
     * equivalent. Caller (handler) resolves these from tenant settings;
     * the service stays calendar-agnostic. The schema field is generic
     * (`{ system: string, value: string }`) — adding HIJRI etc. is
     * additive and requires no shared-types release.
     */
    options?: { calendarSystem?: 'gregorian' | 'bikram_sambat'; enableDualDateDisplay?: boolean },
  ): Promise<MetricSeries[]> {
    const skPrefix = granularity.toUpperCase() + '#';
    const items = await this.queryAllPages({
      TableName: this.analyticsTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `TENANT#${tenantId}` },
        ':prefix': { S: skPrefix },
      },
    });

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
        existing.value = count;
      } else if (parsed.role) {
        existing.breakdown = existing.breakdown || {};
        existing.breakdown[`role=${parsed.role}`] = count;
      } else if (parsed.schoolId) {
        existing.breakdown = existing.breakdown || {};
        existing.breakdown[`school=${parsed.schoolId}`] = count;
      }
      seriesMap.set(parsed.date, existing);
    }

    // A-WS3.T4: optionally attach dateSecondary (e.g., BS) to each point
    // when the tenant's calendar system + dual-display flag are set. The
    // primary `date` is always Gregorian — dateSecondary is the alternate.
    const attachSecondary =
      options?.enableDualDateDisplay === true &&
      options?.calendarSystem === 'bikram_sambat';

    return [...byMetric.entries()].map(([metric, seriesMap]) => ({
      metric,
      series: [...seriesMap.values()]
        .sort((a, b) => a.date.localeCompare(b.date))
        .map((p) => (attachSecondary ? attachBsSecondary(p) : p)),
    }));
  }

  async getAdoptionReport(
    tenantId: string,
    weekKey: string,
    tenantProvisionedAt: string,
    /**
     * A-WS3.T2: tenant's preferred week-start (from
     * regional.defaultWeekStartsOn). Today's storage shape is ISO weeks
     * (Mon-Sun); this parameter is recorded with the response so callers
     * (frontend, future Sun-Fri aware aggregator) know which week-boundary
     * was applied. When the value is omitted (default Sun), behavior is
     * unchanged from pre-A-WS3.
     */
    weekStartsOn: 'sunday' | 'monday' | 'saturday' = 'sunday',
    /**
     * A-WS3.T3: dates in this week that are tenant holidays (yyyy-mm-dd).
     * When ≥1 holiday is present, the adoption denominator is relaxed
     * proportionally so a Dashain week doesn't get flagged FAIL just
     * because the school was closed.
     *
     * V1 model: ~7 expected instructional days per week. Each holiday
     * reduces the expected denominator by 1/7. Floors at 50% reduction
     * to avoid degenerate cases (a week with 4+ holidays).
     */
    holidayDatesInWeek: ReadonlyArray<string> = [],
  ): Promise<AdoptionReport> {
    const items = await this.queryAllPages({
      TableName: this.analyticsTable,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: {
        ':pk': { S: `TENANT#${tenantId}` },
        ':prefix': { S: `WEEK#${weekKey}#` },
      },
    });

    // C1/C2 (2026-04-16) — collect both totals AND per-role counts for each
    // metric so reach metrics can be filtered to the right cohort. Without
    // this, parentPortalReach and studentPortalReach were both reading the
    // same `feature.usage` total and silently inflating from TenantAdmin
    // activity. Role spellings are normalized to lowercase here because the
    // emit pipeline isn't consistent (`Parent` vs `parent`, etc).
    const totals = new Map<string, number>();
    const byRole = new Map<string, Map<string, number>>();
    for (const item of items) {
      const sk = item.SK?.S;
      if (!sk) continue;
      const parsed = parseAggregateSk(sk);
      if (!parsed) continue;
      if (parsed.schoolId) continue; // school breakdowns aren't used here
      const count = Number(item.count?.N ?? '0');
      if (!parsed.role) {
        totals.set(parsed.metric, count);
      } else {
        let m = byRole.get(parsed.metric);
        if (!m) {
          m = new Map();
          byRole.set(parsed.metric, m);
        }
        m.set(parsed.role.toLowerCase(), count);
      }
    }

    const inGracePeriod = isInGracePeriod(tenantProvisionedAt, weekKey);

    /**
     * Per-metric source config.
     * - `metrics`: which detail-type metrics contribute to the numerator.
     * - `roles` (optional, lowercased): when set, sum ONLY the per-role
     *   breakdowns whose role is in this set. When absent, sum the totals.
     *
     * C1/C2 (2026-04-16):
     *   - parentPortalReach now filters to `feature.usage#role=parent`
     *   - studentPortalReach now filters to `feature.usage#role=student`
     *   - teacherLoginCadence now filters to teaching staff only
     *     (Teacher / Principal / VicePrincipal)
     */
    interface MetricSource {
      metrics: string[];
      roles?: Set<string>;
    }
    const source: Record<AdoptionMetricKey, MetricSource> = {
      teacherLoginCadence: {
        metrics: ['auth.login.success'],
        roles: new Set(['teacher', 'principal', 'viceprincipal']),
      },
      attendanceCoverage: {
        metrics: [
          'academics.attendance.recorded',
          'academics.attendance.bulk_section',
        ],
      },
      gradeSubmissionCadence: {
        metrics: [
          'academics.grade.recorded',
          'academics.grade.bulk_recorded',
        ],
      },
      adminActivity: {
        metrics: ['user.create', 'user.update', 'identity.user.created'],
      },
      parentPortalReach: {
        metrics: ['feature.usage'],
        roles: new Set(['parent']),
      },
      studentPortalReach: {
        metrics: ['feature.usage'],
        roles: new Set(['student']),
      },
    };

    /** Sum the contributing rows for a metric, applying role filter if any. */
    const sumForSource = (s: MetricSource): number => {
      let total = 0;
      for (const m of s.metrics) {
        if (s.roles) {
          const rolesMap = byRole.get(m);
          if (!rolesMap) continue;
          for (const r of s.roles) {
            total += rolesMap.get(r) ?? 0;
          }
        } else {
          total += totals.get(m) ?? 0;
        }
      }
      return total;
    };

    const perMetric = {} as Record<
      AdoptionMetricKey,
      { value: number; threshold: number; status: AdoptionStatus }
    >;

    // A-WS3.T3: holiday-aware threshold relaxation. Each holiday reduces
    // expected activity by 1/7 of the week. Capped at 50% reduction so
    // Dashain doesn't degenerate the metric to 0.
    const holidayCount = holidayDatesInWeek.length;
    const holidayRelaxation = Math.max(0.5, 1 - holidayCount / 7);

    for (const key of Object.keys(THRESHOLDS) as AdoptionMetricKey[]) {
      const raw = sumForSource(source[key]);
      const value =
        key === 'adminActivity' ? Math.min(raw, 1) : normalizeFraction(raw);
      const baseThreshold = inGracePeriod
        ? THRESHOLDS[key].grace
        : THRESHOLDS[key].steady;
      // adminActivity is "did anything happen?" — already binary, don't relax.
      const t =
        key === 'adminActivity' ? baseThreshold : baseThreshold * holidayRelaxation;
      // Build a per-metric threshold object for classifyMetric. Reuse the
      // shape so grace-vs-steady semantics are preserved for adminActivity.
      const adjustedThresholds = {
        steady: key === 'adminActivity'
          ? THRESHOLDS[key].steady
          : THRESHOLDS[key].steady * holidayRelaxation,
        grace: key === 'adminActivity'
          ? THRESHOLDS[key].grace
          : THRESHOLDS[key].grace * holidayRelaxation,
      };
      perMetric[key] = {
        value,
        threshold: t,
        status: classifyMetric(value, adjustedThresholds, inGracePeriod),
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
      weekStartsOn,
      inGracePeriod,
      // A-WS3.T3: surface count of holidays applied so the UI can show a
      // "X holidays excluded" badge when the threshold was relaxed.
      ...(holidayCount > 0 ? { holidaysExcluded: holidayCount } : {}),
      perMetric,
      overall,
    };
  }

  async getFleetSummary(from: string, to: string): Promise<FleetSummary> {
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

    return {
      active,
      inactive,
      dormant,
      atRisk,
      topFeatures: topFeatures.slice(0, 10),
    };
  }

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
      return {
        ts,
        eventType: item.eventType?.S ?? 'unknown',
        ipAddress: item.ipAddress?.S,
        deviceInfo: item.deviceInfo?.S
          ? safeParse(item.deviceInfo.S)
          : undefined,
      };
    });
  }

  /**
   * Generates CSV content as a single string. For the Lambda path, the
   * caller writes this to S3 and returns a presigned URL. Not streaming
   * (Lambda proxy has a 6MB cap anyway).
   */
  async generateExportCsv(
    tenantId: string,
    from: string,
    to: string,
    granularity: Granularity,
  ): Promise<string> {
    const chunks: string[] = ['date,metric,value,dimension,dimensionValue\n'];
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
        chunks.push(`${parsed.date},${parsed.metric},${value},${dim},${dimValue}\n`);
      }
      lastKey = r.LastEvaluatedKey;
    } while (lastKey);
    return chunks.join('');
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

// ----------------------------------------------------------------
// Pure helpers — exported for tests
// ----------------------------------------------------------------

interface ParsedAggregateSk {
  bucket: 'DAY' | 'WEEK' | 'MONTH';
  date: string;
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
  return { bucket: bucket as ParsedAggregateSk['bucket'], date, metric, role, schoolId };
}

function safeParse(s: string): Record<string, unknown> | undefined {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

export function normalizeFraction(count: number): number {
  if (count <= 0) return 0;
  const x = count / 20;
  return x >= 1 ? 1 : x;
}

/**
 * A-WS3.T4: attach a Bikram Sambat secondary date to a series point.
 *
 * The primary `date` may be:
 *   - DAY:   yyyy-mm-dd  → BS yyyy-mm-dd
 *   - WEEK:  yyyy-Www    → BS-equivalent week label not standardized; pass through
 *   - MONTH: yyyy-mm     → BS yyyy-mm (1st of month)
 *
 * Uses the canonical converter from @aibrains/shared-types/utils/bikram-sambat
 * — single source of truth across server + frontend. Failures (out-of-range
 * AD years, malformed input) silently return the point unchanged so the
 * response remains usable; we'd rather show AD-only than 5xx.
 */
function attachBsSecondary(p: MetricSeriesPoint): MetricSeriesPoint {
  try {
    // Accept yyyy-mm-dd; expand yyyy-mm to yyyy-mm-01 for monthly buckets.
    let isoDate: string | null = null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
      isoDate = p.date;
    } else if (/^\d{4}-\d{2}$/.test(p.date)) {
      isoDate = `${p.date}-01`;
    }
    if (!isoDate) return p;
    // Lazy require from the package main entry. The dedicated subpath
    // ./utils/bikram-sambat is not in v0.24.0's exports map; main entry
    // re-exports the converter via schemas/index.ts. When the subpath is
    // promoted to a published export in v0.25+ we can switch — strictly
    // an optimization (smaller require graph), no behavior change.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { gregorianToBs } = require('@aibrains/shared-types');
    const bs = gregorianToBs(isoDate) as { year: number; month: number; day: number };
    const value = `${bs.year}-${String(bs.month).padStart(2, '0')}-${String(bs.day).padStart(2, '0')}`;
    return { ...p, dateSecondary: { system: 'BS', value } };
  } catch {
    return p;
  }
}

export function isInGracePeriod(
  provisionedAt: string,
  weekKey: string,
): boolean {
  try {
    const provisioned = new Date(provisionedAt);
    if (Number.isNaN(provisioned.getTime())) return false;
    const m = weekKey.match(/^(\d{4})-W(\d{2})$/);
    if (!m) return false;
    const year = Number(m[1]);
    const week = Number(m[2]);
    const jan4 = new Date(Date.UTC(year, 0, 4));
    const dayOfJan4 = (jan4.getUTCDay() + 6) % 7;
    const weekStart = new Date(jan4);
    weekStart.setUTCDate(jan4.getUTCDate() - dayOfJan4 + (week - 1) * 7);
    return (weekStart.getTime() - provisioned.getTime()) / 86400_000 <= GRACE_PERIOD_DAYS;
  } catch {
    return false;
  }
}
