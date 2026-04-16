import {
  EVENT_METRIC_MAP,
  lookupMetric,
  SESSION_EVENT_TYPES,
  type MetricMapping,
} from './event-metric-map';

describe('event-metric-map (Layer 5.1)', () => {
  it('returns null for unknown (source, detailType) combinations', () => {
    expect(lookupMetric('edforge.unknown', 'Whatever')).toBeNull();
    expect(lookupMetric('edforge.analytics', 'NoSuchEvent')).toBeNull();
    expect(lookupMetric(undefined, 'LoginSuccess')).toBeNull();
    expect(lookupMetric('edforge.analytics', undefined)).toBeNull();
  });

  describe('exhaustive mapping — every declared key resolves', () => {
    const allKeys = Object.keys(EVENT_METRIC_MAP);

    it('has at least 60 mappings (native + domain surface)', () => {
      // Sanity floor: Layer 4 adds 12 native analytics events; academics has
      // ~28 declared; finance has 9; identity has ~20. Total > 60.
      expect(allKeys.length).toBeGreaterThanOrEqual(60);
    });

    it.each(allKeys)('%s resolves via lookupMetric', (key) => {
      const [source, detailType] = key.split('::');
      const result = lookupMetric(source, detailType);
      expect(result).not.toBeNull();
      expect(result!.metric).toMatch(/^[a-z][a-z0-9._]*$/);
      expect(result!.dimensions.length).toBeGreaterThan(0);
    });
  });

  describe('native analytics mappings', () => {
    it.each([
      ['LoginSuccess',     'auth.login.success',     ['role']],
      ['LoginFailure',     'auth.login.failure',     ['role']],
      ['Logout',           'auth.logout',            ['role']],
      ['SessionCreated',   'session.create',         ['role']],
      ['SessionRevoked',   'session.revoke',         ['role']],
      ['SessionRefreshed', 'session.refresh',        ['role']],
      ['UserCreated',      'user.create',            ['role', 'schoolId']],
      ['UserDisabled',     'user.disable',           ['role', 'schoolId']],
      ['FeatureUsage',     'feature.usage',          ['role']],
      ['AuditLogged',      'audit.logged',           ['role']],
    ] as Array<[string, string, string[]]>)(
      '%s → %s with dims %j',
      (detailType, expectedMetric, expectedDims) => {
        const r = lookupMetric('edforge.analytics', detailType);
        expect(r).toEqual({ metric: expectedMetric, dimensions: expectedDims });
      },
    );
  });

  describe('domain mappings for observed (Layer 0) events', () => {
    const cases: Array<[string, string, string, string[]]> = [
      ['edforge.academics-service', 'BulkSectionAttendanceRecorded', 'academics.attendance.bulk_section', ['role', 'schoolId']],
      ['edforge.academics-service', 'GradeRecorded',                 'academics.grade.recorded',          ['role', 'schoolId']],
      ['edforge.academics-service', 'CourseCreated',                 'academics.course.created',          ['role', 'schoolId']],
      ['edforge.academics-service', 'SectionCreated',                'academics.section.created',         ['role', 'schoolId']],
      ['edforge.finance-service',   'InvoiceGenerated',              'finance.invoice.created',           ['role', 'schoolId']],
    ];
    it.each(cases)('(%s, %s) → %s', (source, detailType, expectedMetric, expectedDims) => {
      const r = lookupMetric(source, detailType);
      expect(r).toEqual({ metric: expectedMetric, dimensions: expectedDims } as MetricMapping);
    });
  });

  describe('no mapping puts userId in dimensions (PII cardinal rule)', () => {
    it('every mapping uses only role and schoolId as dimensions', () => {
      const allowed = new Set(['role', 'schoolId']);
      for (const [key, mapping] of Object.entries(EVENT_METRIC_MAP)) {
        for (const dim of mapping.dimensions) {
          expect([key, dim]).toEqual([key, expect.toSatisfy(() => allowed.has(dim))]);
        }
      }
    });
  });

  describe('SESSION_EVENT_TYPES', () => {
    it('covers the three session lifecycle events', () => {
      expect(SESSION_EVENT_TYPES.has('SessionCreated')).toBe(true);
      expect(SESSION_EVENT_TYPES.has('SessionRevoked')).toBe(true);
      expect(SESSION_EVENT_TYPES.has('SessionRefreshed')).toBe(true);
    });
    it('does NOT include login/logout events (those are not session-table writes)', () => {
      expect(SESSION_EVENT_TYPES.has('LoginSuccess')).toBe(false);
      expect(SESSION_EVENT_TYPES.has('Logout')).toBe(false);
    });
  });
});

// Small custom matcher so the PII test reads as one line above.
// This is the shortest workable form without pulling in jest-extended.
expect.extend({
  toSatisfy(received: unknown, predicate: () => boolean) {
    const pass = predicate();
    return {
      pass,
      message: () => `expected ${received} to satisfy predicate`,
    };
  },
});
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toSatisfy(predicate: () => boolean): R;
    }
  }
}
