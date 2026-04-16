import {
  AnalyticsService,
  parseAggregateSk,
  isInGracePeriod,
} from './analytics.service';

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
    const svc = new AnalyticsService();
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
    const svc = new AnalyticsService();
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
    const svc = new AnalyticsService();
    await svc.getTenantTimeSeries('t1', '2026-04-01', '2026-04-14', 'week');
    const cmd = ddbSend.mock.calls[0][0];
    expect(cmd.input.ExpressionAttributeValues[':pk'].S).toBe('TENANT#t1');
    expect(cmd.input.ExpressionAttributeValues[':prefix'].S).toBe('WEEK#');
  });
});

describe('AnalyticsService.getAdoptionReport', () => {
  it('produces PASS/PARTIAL/FAIL per metric + overall', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        mkAgg('WEEK#2026-W16#auth.login.success', 30),
        mkAgg('WEEK#2026-W16#academics.attendance.recorded', 40),
        mkAgg('WEEK#2026-W16#academics.grade.recorded', 30),
        mkAgg('WEEK#2026-W16#user.create', 5),
      ],
    });
    const svc = new AnalyticsService();
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
      Items: [mkAgg('WEEK#2026-W16#auth.login.success', 7)],
    });
    const svc = new AnalyticsService();
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
      Items: [mkAgg('WEEK#2026-W16#auth.login.success', 30)],
    });
    const svc = new AnalyticsService();
    const out = await svc.getAdoptionReport(
      't1',
      '2026-W16',
      '2026-01-01T00:00:00Z',
    );
    expect(out.overall).toBe('FAIL');
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
    const svc = new AnalyticsService();
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
    const svc = new AnalyticsService();
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
    const svc = new AnalyticsService();
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
    const svc = new AnalyticsService();
    const out = await svc.getSessionHistory('user-a', 30);
    expect(out).toEqual([]);
    const pk = ddbSend.mock.calls[0][0].input.ExpressionAttributeValues[':pk'].S;
    expect(pk).toBe('USER#user-a');
    expect(pk).not.toMatch(/user-b/);
  });
});

describe('AnalyticsService.streamExportCsv', () => {
  it('yields a header + data rows, honors date filter', async () => {
    ddbSend.mockResolvedValueOnce({
      Items: [
        mkAgg('DAY#2026-04-14#auth.login.success', 7),
        mkAgg('DAY#2026-04-14#auth.login.success#role=Teacher', 7),
        mkAgg('DAY#2026-01-01#auth.login.success', 99), // out of range
      ],
    });
    const svc = new AnalyticsService();
    const chunks: string[] = [];
    for await (const c of svc.streamExportCsv(
      't1',
      '2026-04-01',
      '2026-04-30',
      'day',
    )) {
      chunks.push(c);
    }
    const csv = chunks.join('');
    const lines = csv.split('\n').filter(Boolean);
    expect(lines[0]).toBe('date,metric,value,dimension,dimensionValue');
    expect(lines).toContain('2026-04-14,auth.login.success,7,,');
    expect(lines).toContain('2026-04-14,auth.login.success,7,role,Teacher');
    expect(csv).not.toContain('2026-01-01');
  });
});
