import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  AnalyticsService,
  parseAggregateSk,
  isInGracePeriod,
} from './analytics-service';

// Mock DynamoDBClient with a shared send() spy.
const ddbSend = jest.fn();
jest.mock('@aws-sdk/client-dynamodb', () => {
  const actual = jest.requireActual('@aws-sdk/client-dynamodb');
  return {
    ...actual,
    DynamoDBClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => ddbSend(...args),
    })),
  };
});

function mkAgg(sk: string, count: number, extra: Record<string, any> = {}) {
  return {
    SK: { S: sk },
    count: { N: String(count) },
    ...extra,
  };
}

beforeEach(() => {
  ddbSend.mockReset();
  process.env.ANALYTICS_TABLE_NAME = 'edforge-analytics';
  process.env.USER_SESSION_EVENTS_TABLE_NAME = 'edforge-user-session-events';
});

describe('parseAggregateSk', () => {
  it('parses a total DAY row', () => {
    expect(parseAggregateSk('DAY#2026-04-14#auth.login.success')).toEqual({
      bucket: 'DAY',
      date: '2026-04-14',
      metric: 'auth.login.success',
    });
  });
  it('parses WEEK + role', () => {
    expect(
      parseAggregateSk('WEEK#2026-W16#academics.grade.recorded#role=Teacher'),
    ).toEqual({
      bucket: 'WEEK',
      date: '2026-W16',
      metric: 'academics.grade.recorded',
      role: 'Teacher',
    });
  });
  it('parses MONTH + school', () => {
    expect(
      parseAggregateSk('MONTH#2026-04#finance.invoice.created#school=school-1'),
    ).toEqual({
      bucket: 'MONTH',
      date: '2026-04',
      metric: 'finance.invoice.created',
      schoolId: 'school-1',
    });
  });
  it('returns null for a non-aggregate SK', () => {
    expect(parseAggregateSk('ROLLUP_PROCESSED#2026-04-14')).toBeNull();
    expect(parseAggregateSk('junk')).toBeNull();
  });
});

describe('isInGracePeriod', () => {
  it('returns true for a week within 21 days of provisioning', () => {
    // Tenant provisioned 2026-04-01 → week 2026-W16 starts 2026-04-13,
    // which is 12 days later → in grace.
    expect(isInGracePeriod('2026-04-01T00:00:00Z', '2026-W16')).toBe(true);
  });
  it('returns false for a week beyond the grace window', () => {
    // 2026-04-01 → 2026-W20 starts 2026-05-11, 40 days later → not in grace.
    expect(isInGracePeriod('2026-04-01T00:00:00Z', '2026-W20')).toBe(false);
  });
  it('returns false on bad input', () => {
    expect(isInGracePeriod('not-a-date', '2026-W16')).toBe(false);
    expect(isInGracePeriod('2026-04-01', 'bad-week')).toBe(false);
  });
});

describe('AnalyticsService.getTenantTimeSeries', () => {
  it('groups aggregate rows by metric and sorts by date', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        mkAgg('DAY#2026-04-13#auth.login.success', 5),
        mkAgg('DAY#2026-04-14#auth.login.success', 7),
        mkAgg('DAY#2026-04-14#auth.login.success#role=Teacher', 7),
        mkAgg('DAY#2026-04-14#academics.attendance.recorded', 50),
      ],
    });
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    const out = await svc.getTenantTimeSeries(
      't1',
      '2026-04-13',
      '2026-04-14',
      'day',
    );
    expect(out.map((s) => s.metric).sort()).toEqual([
      'academics.attendance.recorded',
      'auth.login.success',
    ]);
    const login = out.find((s) => s.metric === 'auth.login.success')!;
    expect(login.series).toEqual([
      { date: '2026-04-13', value: 5, breakdown: {} },
      expect.objectContaining({
        date: '2026-04-14',
        value: 7,
        breakdown: { 'role=Teacher': 7 },
      }),
    ]);
  });

  it('filters out rows outside the date range', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        mkAgg('DAY#2026-01-01#auth.login.success', 1),
        mkAgg('DAY#2026-04-14#auth.login.success', 2),
      ],
    });
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    const out = await svc.getTenantTimeSeries(
      't1',
      '2026-04-01',
      '2026-04-30',
      'day',
    );
    const pts = out[0]?.series.map((p) => p.date);
    expect(pts).toEqual(['2026-04-14']);
  });

  it('queries the right PK + prefix', async () => {
    ddbSend.mockResolvedValueOnce({ Items: [] });
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    await svc.getTenantTimeSeries('t1', '2026-04-01', '2026-04-14', 'week');
    const cmd = ddbSend.mock.calls[0][0];
    expect(cmd.input.ExpressionAttributeValues[':pk'].S).toBe('TENANT#t1');
    expect(cmd.input.ExpressionAttributeValues[':prefix'].S).toBe('WEEK#');
  });

  describe('A-WS3.T4 — dateSecondary attachment', () => {
    it('omits dateSecondary when no calendar option provided (default behavior)', async () => {
      ddbSend.mockResolvedValueOnce({
        Items: [mkAgg('DAY#2026-04-14#auth.login.success', 5)],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getTenantTimeSeries('t1', '2026-04-13', '2026-04-14', 'day');
      expect(out[0].series[0].dateSecondary).toBeUndefined();
    });

    it('omits dateSecondary when enableDualDateDisplay=false (US tenant)', async () => {
      ddbSend.mockResolvedValueOnce({
        Items: [mkAgg('DAY#2026-04-14#auth.login.success', 5)],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getTenantTimeSeries(
        't1',
        '2026-04-13',
        '2026-04-14',
        'day',
        { calendarSystem: 'gregorian', enableDualDateDisplay: false },
      );
      expect(out[0].series[0].dateSecondary).toBeUndefined();
    });

    it('attaches dateSecondary BS for Nepal tenant with dual-display on', async () => {
      ddbSend.mockResolvedValueOnce({
        Items: [mkAgg('DAY#2026-04-14#auth.login.success', 5)],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getTenantTimeSeries(
        't1',
        '2026-04-13',
        '2026-04-14',
        'day',
        { calendarSystem: 'bikram_sambat', enableDualDateDisplay: true },
      );
      const point = out[0].series[0];
      expect(point.dateSecondary).toBeDefined();
      expect(point.dateSecondary!.system).toBe('BS');
      // 2026-04-14 ≈ Baisakh 1, 2083 (start of BS new year). Don't pin the exact
      // value — converter is the canonical source.
      expect(point.dateSecondary!.value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('handles month-bucket dates by anchoring to first of month', async () => {
      ddbSend.mockResolvedValueOnce({
        Items: [mkAgg('MONTH#2026-04#auth.login.success', 5)],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getTenantTimeSeries(
        't1',
        '2026-04',
        '2026-04',
        'month',
        { calendarSystem: 'bikram_sambat', enableDualDateDisplay: true },
      );
      expect(out[0].series[0].dateSecondary?.system).toBe('BS');
    });

    it('preserves point shape when BS conversion fails (no 5xx, just AD)', async () => {
      ddbSend.mockResolvedValueOnce({
        Items: [mkAgg('WEEK#2026-W16#auth.login.success', 5)],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getTenantTimeSeries(
        't1',
        '2026-W01',
        '2026-W52',
        'week',
        { calendarSystem: 'bikram_sambat', enableDualDateDisplay: true },
      );
      // Week format isn't BS-convertible — point is returned unchanged.
      expect(out[0]?.series[0]?.dateSecondary).toBeUndefined();
    });
  });
});

describe('AnalyticsService.getAdoptionReport', () => {
  it('produces PASS/PARTIAL/FAIL per metric + overall', async () => {
    // C1/C2 (2026-04-16): teacherLoginCadence now requires role-tagged
    // login rows (Teacher / Principal / VicePrincipal). Fixture supplies
    // both the total row AND a role-tagged row so the metric resolves.
    ddbSend.mockResolvedValueOnce({
      Items: [
        mkAgg('WEEK#2026-W16#auth.login.success', 30),
        mkAgg('WEEK#2026-W16#auth.login.success#role=Teacher', 30),
        mkAgg('WEEK#2026-W16#academics.attendance.recorded', 40),
        mkAgg('WEEK#2026-W16#academics.grade.recorded', 30),
        mkAgg('WEEK#2026-W16#user.create', 5),
      ],
    });
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    const out = await svc.getAdoptionReport(
      't1',
      '2026-W16',
      '2026-03-01T00:00:00Z', // not in grace
    );
    expect(out.tenantId).toBe('t1');
    expect(out.weekKey).toBe('2026-W16');
    expect(out.inGracePeriod).toBe(false);
    expect(out.perMetric.teacherLoginCadence.status).toBe('PASS');
    expect(out.perMetric.attendanceCoverage.status).toBe('PASS');
    expect(out.perMetric.gradeSubmissionCadence.status).toBe('PASS');
    expect(out.perMetric.adminActivity.status).toBe('PASS');
    expect(out.overall).toBe('PASS');
  });

  it('applies grace thresholds when tenant is ≤21 days old', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        mkAgg('WEEK#2026-W16#auth.login.success', 7),
        mkAgg('WEEK#2026-W16#auth.login.success#role=Teacher', 7),
      ],
    });
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    const out = await svc.getAdoptionReport(
      't1',
      '2026-W16',
      '2026-04-05T00:00:00Z', // 8 days before Monday 2026-04-13 → in grace
    );
    expect(out.inGracePeriod).toBe(true);
    // 7/20 = 0.35 > grace threshold 0.3 → PASS under grace.
    expect(out.perMetric.teacherLoginCadence.status).toBe('PASS');
  });

  it('returns FAIL overall when only 1 metric passes', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        mkAgg('WEEK#2026-W16#auth.login.success', 30),
        mkAgg('WEEK#2026-W16#auth.login.success#role=Teacher', 30),
      ],
    });
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    const out = await svc.getAdoptionReport(
      't1',
      '2026-W16',
      '2026-01-01T00:00:00Z',
    );
    expect(out.overall).toBe('FAIL');
  });

  describe('C1/C2 — role-aware metric counting', () => {
    it('teacherLoginCadence ignores admin/parent/student logins', async () => {
      ddbSend.mockResolvedValueOnce({
        Items: [
          // Total reflects 30 logins, but only 4 came from a teacher.
          // The metric must use the teacher count, not the total.
          mkAgg('WEEK#2026-W16#auth.login.success', 30),
          mkAgg('WEEK#2026-W16#auth.login.success#role=TenantAdmin', 20),
          mkAgg('WEEK#2026-W16#auth.login.success#role=Parent', 4),
          mkAgg('WEEK#2026-W16#auth.login.success#role=Student', 2),
          mkAgg('WEEK#2026-W16#auth.login.success#role=Teacher', 4),
        ],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport('t1', '2026-W16', '2026-01-01T00:00:00Z');
      // 4/20 = 0.2; steady threshold for cadence is 0.6 → FAIL.
      expect(out.perMetric.teacherLoginCadence.value).toBeCloseTo(0.2, 5);
      expect(out.perMetric.teacherLoginCadence.status).toBe('FAIL');
    });

    it('teacherLoginCadence includes Principal and VicePrincipal logins', async () => {
      ddbSend.mockResolvedValueOnce({
        Items: [
          mkAgg('WEEK#2026-W16#auth.login.success', 18),
          mkAgg('WEEK#2026-W16#auth.login.success#role=Teacher', 6),
          mkAgg('WEEK#2026-W16#auth.login.success#role=Principal', 4),
          mkAgg('WEEK#2026-W16#auth.login.success#role=VicePrincipal', 2),
        ],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport('t1', '2026-W16', '2026-01-01T00:00:00Z');
      // 6+4+2=12 → 12/20 = 0.6 → exactly at PASS threshold.
      expect(out.perMetric.teacherLoginCadence.value).toBeCloseTo(0.6, 5);
      expect(out.perMetric.teacherLoginCadence.status).toBe('PASS');
    });

    it('parentPortalReach and studentPortalReach read different cohorts', async () => {
      ddbSend.mockResolvedValueOnce({
        Items: [
          // 60 total feature.usage events, dominated by an active admin.
          // Without C1, both reach metrics would inflate to 1.0.
          mkAgg('WEEK#2026-W16#feature.usage', 60),
          mkAgg('WEEK#2026-W16#feature.usage#role=TenantAdmin', 50),
          mkAgg('WEEK#2026-W16#feature.usage#role=Parent', 6),
          mkAgg('WEEK#2026-W16#feature.usage#role=Student', 4),
        ],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport('t1', '2026-W16', '2026-01-01T00:00:00Z');
      // Parent: 6/20 = 0.3 → above 0.15 steady → PASS.
      expect(out.perMetric.parentPortalReach.value).toBeCloseTo(0.3, 5);
      expect(out.perMetric.parentPortalReach.status).toBe('PASS');
      // Student: 4/20 = 0.2 → below 0.25 steady → FAIL (or PARTIAL).
      expect(out.perMetric.studentPortalReach.value).toBeCloseTo(0.2, 5);
      expect(out.perMetric.studentPortalReach.status).not.toBe('PASS');
    });

    it('role matching is case-insensitive (handles emit-pipeline inconsistency)', async () => {
      ddbSend.mockResolvedValueOnce({
        Items: [
          mkAgg('WEEK#2026-W16#feature.usage', 5),
          // Lowercased role tag — emitter inconsistency.
          mkAgg('WEEK#2026-W16#feature.usage#role=parent', 5),
        ],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport('t1', '2026-W16', '2026-01-01T00:00:00Z');
      // 5/20 = 0.25 → PASS (>0.15 steady).
      expect(out.perMetric.parentPortalReach.value).toBeCloseTo(0.25, 5);
      expect(out.perMetric.parentPortalReach.status).toBe('PASS');
    });

    it('reach metrics return 0 when no role-tagged rows exist (no false PASS from totals)', async () => {
      ddbSend.mockResolvedValueOnce({
        Items: [
          // Only the untagged total exists (e.g. all activity from un-broken-down emits).
          mkAgg('WEEK#2026-W16#feature.usage', 100),
        ],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport('t1', '2026-W16', '2026-01-01T00:00:00Z');
      expect(out.perMetric.parentPortalReach.value).toBe(0);
      expect(out.perMetric.studentPortalReach.value).toBe(0);
    });
  });

  describe('A-WS3.T3 — holiday-aware threshold relaxation', () => {
    it('omits holidaysExcluded when no holidays passed', async () => {
      ddbSend.mockResolvedValueOnce({ Items: [] });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport('t1', '2026-W16', '2026-01-01T00:00:00Z');
      expect(out.holidaysExcluded).toBeUndefined();
    });

    it('surfaces holidaysExcluded count when holidays passed', async () => {
      ddbSend.mockResolvedValueOnce({ Items: [] });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport(
        't1',
        '2026-W16',
        '2026-01-01T00:00:00Z',
        'sunday',
        ['2026-04-15', '2026-04-16'],
      );
      expect(out.holidaysExcluded).toBe(2);
    });

    it('relaxes thresholds proportionally to holiday count', async () => {
      // Activity = 10 (= normalizeFraction = 0.5).
      // Steady threshold for teacherLoginCadence = 0.6 → 0.5 < 0.6 → would normally PARTIAL/FAIL.
      // With 2 holidays out of 7 days: 0.6 * (1 - 2/7) ≈ 0.428 → 0.5 > 0.428 → PASS.
      ddbSend.mockResolvedValueOnce({
        Items: [
          mkAgg('WEEK#2026-W16#auth.login.success', 10),
          mkAgg('WEEK#2026-W16#auth.login.success#role=Teacher', 10),
        ],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport(
        't1',
        '2026-W16',
        '2026-01-01T00:00:00Z',
        'sunday',
        ['2026-04-15', '2026-04-16'],
      );
      expect(out.perMetric.teacherLoginCadence.status).toBe('PASS');
    });

    it('caps holiday relaxation at 50% — a 5-holiday week does not give a free pass', async () => {
      // Activity = 4 (normalizeFraction = 0.2).
      // Steady = 0.6, 50% cap → 0.3. 0.2 < 0.3 → still not PASS.
      ddbSend.mockResolvedValueOnce({
        Items: [
          mkAgg('WEEK#2026-W16#auth.login.success', 4),
          mkAgg('WEEK#2026-W16#auth.login.success#role=Teacher', 4),
        ],
      });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport(
        't1',
        '2026-W16',
        '2026-01-01T00:00:00Z',
        'sunday',
        ['d1', 'd2', 'd3', 'd4', 'd5'],
      );
      expect(out.perMetric.teacherLoginCadence.status).not.toBe('PASS');
    });
  });

  describe('A-WS3.T2 — weekStartsOn parameter', () => {
    it('omits weekStartsOn from response when default (sunday) is used implicitly', async () => {
      ddbSend.mockResolvedValueOnce({ Items: [] });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport('t1', '2026-W16', '2026-01-01T00:00:00Z');
      // Default is 'sunday' — included in response so frontend doesn't have to guess.
      expect(out.weekStartsOn).toBe('sunday');
    });

    it('passes through monday when tenant is configured Mon-Sun', async () => {
      ddbSend.mockResolvedValueOnce({ Items: [] });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport(
        't1',
        '2026-W16',
        '2026-01-01T00:00:00Z',
        'monday',
      );
      expect(out.weekStartsOn).toBe('monday');
    });

    it('accepts saturday for Middle East tenants (forward-compat)', async () => {
      ddbSend.mockResolvedValueOnce({ Items: [] });
      const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
      const out = await svc.getAdoptionReport(
        't1',
        '2026-W16',
        '2026-01-01T00:00:00Z',
        'saturday',
      );
      expect(out.weekStartsOn).toBe('saturday');
    });
  });
});

describe('AnalyticsService.getFleetSummary', () => {
  it('reads the latest FLEET#ALL row in range and accumulates top features', async () => {
    // First call: fleet rows
    ddbSend.mockResolvedValueOnce({
      Items: [
        {
          SK: { S: 'DAY#2026-04-13#tenant.status' },
          active: { N: '3' },
          inactive: { N: '1' },
          dormant: { N: '0' },
          atRisk: { N: '0' },
        },
        {
          SK: { S: 'DAY#2026-04-14#tenant.status' },
          active: { N: '4' },
          inactive: { N: '0' },
          dormant: { N: '1' },
          atRisk: { N: '0' },
        },
      ],
    });
    // Subsequent calls: per-metric GSI1 queries. Return synthetic counts.
    ddbSend.mockImplementation(async (cmd: any) => {
      const pk = cmd?.input?.ExpressionAttributeValues?.[':pk']?.S;
      if (pk === 'FEATURE#academics.attendance.recorded') {
        return { Items: [{ count: { N: '100' } }] };
      }
      if (pk === 'FEATURE#auth.login.success') {
        return { Items: [{ count: { N: '50' } }] };
      }
      return { Items: [] };
    });

    // Because we .mockResolvedValueOnce for the first call above AND then
    // swapped to mockImplementation, the first call will use the Once stub
    // and subsequent calls fall through to the implementation.
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    const out = await svc.getFleetSummary('2026-04-01', '2026-04-14');

    expect(out.active).toBe(4);
    expect(out.dormant).toBe(1);
    // Top-features should be sorted by totalCount desc
    expect(out.topFeatures[0]).toEqual({
      metric: 'academics.attendance.recorded',
      totalCount: 100,
    });
    expect(out.topFeatures[1]).toEqual({
      metric: 'auth.login.success',
      totalCount: 50,
    });
  });

  it('returns zeros when no fleet rows exist', async () => {
    ddbSend.mockImplementation(async () => ({ Items: [] }));
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    const out = await svc.getFleetSummary('2026-04-01', '2026-04-14');
    expect(out).toEqual({
      active: 0,
      inactive: 0,
      dormant: 0,
      atRisk: 0,
      topFeatures: [],
    });
  });
});

describe('AnalyticsService.getSessionHistory', () => {
  it('scopes PK to USER#<userId>', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        {
          SK: { S: 'EVENT#2026-04-14T12:00:00.000Z#evt-1' },
          eventType: { S: 'SessionCreated' },
          ipAddress: { S: '192.168.1.x' },
          deviceInfo: { S: '{"os":"macOS"}' },
        },
      ],
    });
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    const out = await svc.getSessionHistory('user-a', 30);
    const cmd = ddbSend.mock.calls[0][0];
    expect(cmd.input.ExpressionAttributeValues[':pk'].S).toBe('USER#user-a');
    expect(out).toEqual([
      {
        ts: '2026-04-14T12:00:00.000Z',
        eventType: 'SessionCreated',
        ipAddress: '192.168.1.x',
        deviceInfo: { os: 'macOS' },
      },
    ]);
  });

  it('user A query never returns user B rows (structural guarantee)', async () => {
    // Mock returns no items — the enforcement is the PK scoping itself.
    // This test asserts we never build a PK from anywhere but the passed userId.
    ddbSend.mockResolvedValueOnce({ Items: [] });
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    const out = await svc.getSessionHistory('user-a', 30);
    expect(out).toEqual([]);
    const pk = ddbSend.mock.calls[0][0].input.ExpressionAttributeValues[':pk'].S;
    expect(pk).toBe('USER#user-a');
    expect(pk).not.toMatch(/user-b/);
  });
});

describe('AnalyticsService.generateExportCsv', () => {
  it('returns CSV string with header + data rows, honors date filter', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        mkAgg('DAY#2026-04-14#auth.login.success', 7),
        mkAgg('DAY#2026-04-14#auth.login.success#role=Teacher', 7),
        mkAgg('DAY#2026-01-01#auth.login.success', 99), // out of range
      ],
    });
    const svc = new AnalyticsService({ ddb: new DynamoDBClient({}), analyticsTable: 'edforge-analytics', sessionTable: 'edforge-user-session-events' });
    const csv = await svc.generateExportCsv('t1', '2026-04-01', '2026-04-30', 'day');
    const lines = csv.split('\n').filter(Boolean);
    expect(lines[0]).toBe('date,metric,value,dimension,dimensionValue');
    expect(lines).toContain('2026-04-14,auth.login.success,7,,');
    expect(lines).toContain('2026-04-14,auth.login.success,7,role,Teacher');
    expect(csv).not.toContain('2026-01-01');
  });
});
