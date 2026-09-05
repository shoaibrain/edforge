import * as fs from 'fs';
import * as path from 'path';

/**
 * C2.1 — the routing table API-B is generated from must be complete against
 * the source spec and must stay in lockstep with the two places that still
 * hold routing knowledge until later sprints delete them: the analytics
 * stack's addRoute() list (API-A) and the route linter's /internal exemptions.
 */
const LIB = __dirname;
const REPO = path.resolve(LIB, '../..');
const STAGE_VARS = new Set(['identityFn', 'academicsFn', 'financeFn', 'analyticsFn']);

type Prefix = { target: 'lambda'; fn: string } | { target: 'vpclink' };
type Addition = { fn: string; methods: string[] };

const routeMap = JSON.parse(fs.readFileSync(path.join(LIB, 'route-map.json'), 'utf8')) as { prefixes: Record<string, Prefix> };
const additions = JSON.parse(fs.readFileSync(path.join(LIB, 'tenant-api-additions.json'), 'utf8')) as { paths: Record<string, Addition> };
const sourceSpec = JSON.parse(fs.readFileSync(path.join(LIB, 'tenant-api-prod.json'), 'utf8')) as { paths: Record<string, unknown> };

const prefixOf = (p: string) => p.split('/')[1] ?? '';

describe('route-map.json (C2.1)', () => {
  const specPrefixes = new Set(Object.keys(sourceSpec.paths).map(prefixOf));

  it('has an entry for every top-level prefix in tenant-api-prod.json and nothing else', () => {
    expect([...specPrefixes].sort()).toEqual(Object.keys(routeMap.prefixes).sort());
  });

  it('names only real stage variables and only the two target kinds', () => {
    for (const [prefix, entry] of Object.entries(routeMap.prefixes)) {
      if (entry.target === 'lambda') expect({ prefix, fn: entry.fn, known: STAGE_VARS.has(entry.fn) }).toEqual({ prefix, fn: entry.fn, known: true });
      else expect({ prefix, target: entry.target }).toEqual({ prefix, target: 'vpclink' });
    }
  });

  it('routes academics to academicsFn and, since Sprint 5, finance to financeFn (no VPC-link prefix remains)', () => {
    expect(routeMap.prefixes['academics']).toEqual({ target: 'lambda', fn: 'academicsFn' });
    expect(routeMap.prefixes['finance']).toEqual({ target: 'lambda', fn: 'financeFn' });
    expect(Object.values(routeMap.prefixes).some((e) => e.target === 'vpclink')).toBe(false);
    const identity = Object.entries(routeMap.prefixes).filter(([, e]) => e.target === 'lambda' && e.fn === 'identityFn').map(([p]) => p);
    expect(identity).toHaveLength(17);
    expect(identity).toContain('');
  });
});

describe('tenant-api-additions.json (C2.1)', () => {
  it('adds only paths the source spec does not have, with valid targets and lowercase methods', () => {
    for (const [p, a] of Object.entries(additions.paths)) {
      expect({ path: p, inSource: p in sourceSpec.paths }).toEqual({ path: p, inSource: false });
      expect({ path: p, fn: a.fn, known: STAGE_VARS.has(a.fn) }).toEqual({ path: p, fn: a.fn, known: true });
      expect(a.methods.length).toBeGreaterThan(0);
      for (const m of a.methods) expect(m).toMatch(/^(get|post|put|patch|delete)$/);
    }
  });

  it('carries the five analytics routes as GET on analyticsFn, and the analytics stack attaches nothing to API-A any more (C6.2)', () => {
    const ours = Object.entries(additions.paths).filter(([, a]) => a.fn === 'analyticsFn').map(([p]) => p);
    expect(ours.sort()).toEqual([
      '/analytics/fleet',
      '/analytics/me/session-history',
      '/analytics/tenants/{tenantId}',
      '/analytics/tenants/{tenantId}/adoption-report',
      '/analytics/tenants/{tenantId}/export-csv-url',
    ]);
    for (const [p, a] of Object.entries(additions.paths)) {
      if (a.fn === 'analyticsFn') expect({ path: p, methods: a.methods }).toEqual({ path: p, methods: ['get'] });
    }
    const src = fs.readFileSync(path.join(LIB, 'analytics/analytics-stack.ts'), 'utf8');
    expect(src).not.toMatch(/addRoute\(/);
    expect(src).not.toContain('TenantApiRestApiId');
  });

  it('the route linter no longer exempts any /internal path (they are API-B additions now)', () => {
    const linter = fs.readFileSync(path.join(REPO, 'scripts/check-route-drift.ts'), 'utf8');
    const exemptBlock = linter.slice(linter.indexOf('const EXEMPT_PATHS'), linter.indexOf('const KNOWN_DRIFT'));
    expect([...exemptBlock.matchAll(/'(\/internal\/[^']+)'/g)]).toHaveLength(0);
    expect(Object.keys(additions.paths).filter((p) => p.startsWith('/internal/'))).toHaveLength(3);
  });

  it('sends the finance webhooks to financeFn and the identity internal read to identityFn', () => {
    expect(additions.paths['/internal/webhooks/enrollment-completed']).toEqual({ fn: 'financeFn', methods: ['post'] });
    expect(additions.paths['/internal/webhooks/student-withdrawn']).toEqual({ fn: 'financeFn', methods: ['post'] });
    expect(additions.paths['/internal/schools/{schoolId}/academic-years']).toEqual({ fn: 'identityFn', methods: ['get'] });
  });

  it('adds only under prefixes the route map does not have (API-B-only surfaces)', () => {
    const additionPrefixes = new Set(Object.keys(additions.paths).map(prefixOf));
    expect([...additionPrefixes].sort()).toEqual(['analytics', 'internal']);
    for (const p of additionPrefixes) expect({ prefix: p, mapped: routeMap.prefixes[p] }).toEqual({ prefix: p, mapped: undefined });
  });
});
