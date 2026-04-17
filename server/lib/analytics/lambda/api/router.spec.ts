import { route } from './router';

describe('route', () => {
  it('GET /analytics/tenants/{tenantId} → tenantSeries', () => {
    expect(route('GET', '/analytics/tenants/abc-123')).toEqual({
      handler: 'tenantSeries',
      params: { tenantId: 'abc-123' },
    });
  });
  it('GET /analytics/tenants/{tenantId}/adoption-report → adoptionReport', () => {
    expect(route('GET', '/analytics/tenants/abc/adoption-report')).toEqual({
      handler: 'adoptionReport',
      params: { tenantId: 'abc' },
    });
  });
  it('GET /analytics/fleet → fleet', () => {
    expect(route('GET', '/analytics/fleet')).toEqual({
      handler: 'fleet',
      params: {},
    });
  });
  it('GET /analytics/me/session-history → sessionHistory', () => {
    expect(route('GET', '/analytics/me/session-history')).toEqual({
      handler: 'sessionHistory',
      params: {},
    });
  });
  it('GET /analytics/tenants/{tenantId}/export-csv-url → exportCsvUrl', () => {
    expect(route('GET', '/analytics/tenants/t1/export-csv-url')).toEqual({
      handler: 'exportCsvUrl',
      params: { tenantId: 't1' },
    });
  });
  it('returns null for unknown path', () => {
    expect(route('GET', '/something/else')).toBeNull();
  });
  it('returns null for wrong method', () => {
    expect(route('POST', '/analytics/fleet')).toBeNull();
  });
  it('decodes URL-encoded path params', () => {
    expect(route('GET', '/analytics/tenants/a%20b')?.params.tenantId).toBe('a b');
  });
  it('matches without trailing slash', () => {
    expect(route('GET', '/analytics/fleet/')?.handler).toBe('fleet');
  });
});
