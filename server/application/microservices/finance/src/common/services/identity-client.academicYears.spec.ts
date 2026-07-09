/**
 * `IdentityClientService.getAcademicYears` — BH-1.4 AY-scoping resolution.
 *
 * **Service-auth retarget:** this now reads identity's INTERNAL route
 * (`GET /internal/schools/:id/academic-years`) authenticated by
 * `x-internal-api-key`, NOT the operator route
 * (`GET /schools/:id/academic-years`, `@RequirePermission('scheduling','view')`).
 * AY resolution for billing is internal logic, not an operator action — the
 * Accountant role and the enrollment-webhook context LACK `scheduling:view`, so
 * the operator route 403'd for them and AY-scoping degraded to unscoped. The
 * internal route removes the permission gate (tenant isolation is still
 * enforced via the forwarded operator JWT → TokenVendingMachine on identity's
 * side), so those callers now RESOLVE the year.
 *
 * These tests pin the transport: the request hits the `/internal/...` path and
 * carries `x-internal-api-key`, and the Accountant role no longer causes a
 * degrade (the whole point of the change).
 *
 * BH-1.4 hardening (3-state): the method returns `null` on any CALL FAILURE
 * (identity down / network / misconfigured internal key → 401) — distinct from
 * a SUCCESS that returns an array (possibly empty). The caller uses `null` to
 * mean "unavailable → unscoped degrade + retry" and never confuses it with "no
 * years configured". These tests pin `null` on failure (generation still never
 * 5xxes) and that success (an array) is cached but failure (null) is not.
 */

import { HttpClientService } from '@app/http-client';
import { Logger } from '@nestjs/common';
import { IdentityClientService } from './identity-client.service';
import type { RequestContext } from '../entities/base.entity';

const SCHOOL_ID = 'school-1';
const INTERNAL_KEY = 'internal-key-abc';

const ctx = (role: string): RequestContext =>
  ({
    tenantId: 'tenant-a-uuid',
    userId: 'u1',
    jwtToken: 'jwt',
    role,
    schoolId: SCHOOL_ID,
  }) as unknown as RequestContext;

describe('finance IdentityClientService.getAcademicYears (BH-1.4)', () => {
  let service: IdentityClientService;
  let httpClient: { get: jest.Mock };
  let warnSpy: jest.SpyInstance;
  const ORIGINAL_KEY = process.env.INTERNAL_API_KEY;

  beforeEach(() => {
    process.env.INTERNAL_API_KEY = INTERNAL_KEY;
    httpClient = { get: jest.fn() };
    service = new IdentityClientService(httpClient as unknown as HttpClientService);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    if (ORIGINAL_KEY === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = ORIGINAL_KEY;
  });

  it('hits the INTERNAL route with x-internal-api-key (no operator permission needed)', async () => {
    httpClient.get.mockResolvedValue({
      data: { items: [{ yearId: 'ay-uuid', name: '2082-83' }] },
    });

    await service.getAcademicYears(SCHOOL_ID, ctx('TenantAdmin'));

    const [url, config] = httpClient.get.mock.calls[0];
    expect(url).toContain(`/internal/schools/${SCHOOL_ID}/academic-years`);
    expect(config.headers['x-internal-api-key']).toBe(INTERNAL_KEY);
  });

  it('happy path → returns the {yearId, name} rows', async () => {
    httpClient.get.mockResolvedValue({
      data: { items: [{ yearId: 'ay-uuid', name: '2082-83' }] },
    });

    const years = await service.getAcademicYears(SCHOOL_ID, ctx('TenantAdmin'));
    expect(years).toEqual([{ yearId: 'ay-uuid', name: '2082-83' }]);
  });

  it('Accountant role RESOLVES the year (no 403 / no unscoped degrade) — the point of the service-auth fix', async () => {
    // Pre-fix: the operator route 403'd for the Accountant (lacks
    // scheduling:view) → null → unscoped. With the internal route there is NO
    // permission gate: the SAME success is returned regardless of role, so the
    // Accountant (and the enrollment-webhook context, same missing permission)
    // now resolve the year.
    httpClient.get.mockResolvedValue({
      data: { items: [{ yearId: 'ay-uuid', name: '2082-83' }] },
    });

    const years = await service.getAcademicYears(SCHOOL_ID, ctx('Accountant'));

    expect(years).toEqual([{ yearId: 'ay-uuid', name: '2082-83' }]);
    // No degrade WARN for a role-permission reason.
    const warnMessage = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMessage).not.toContain('scheduling:view');
  });

  it('transport failure (identity down / network) → returns null (unavailable), WARN, never throws', async () => {
    const err: any = new Error('ECONNREFUSED');
    httpClient.get.mockRejectedValue(err);

    const years = await service.getAcademicYears(SCHOOL_ID, ctx('Accountant'));

    expect(years).toBeNull();
    const warnMessage = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMessage).toContain('degrade to unscoped');
    // No stale operator-permission hint — the internal route can't 403 on perms.
    expect(warnMessage).not.toContain('scheduling:view');
  });

  it('misconfigured internal key (identity guard 401) → returns null (unavailable), no throw', async () => {
    const err: any = new Error('Request failed with status code 401');
    err.response = { status: 401 };
    httpClient.get.mockRejectedValue(err);

    const years = await service.getAcademicYears(SCHOOL_ID, ctx('TenantAdmin'));

    expect(years).toBeNull();
    const warnMessage = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMessage).toContain('status=401');
  });

  it('success is cached (arrays), a subsequent failure returns the cached array — but a failure alone is NOT cached', async () => {
    // Cache SUCCESS only: a transient blip after a success serves the cached
    // array; a failure never populates the cache (retry next call).
    httpClient.get.mockResolvedValueOnce({
      data: { items: [{ yearId: 'ay-uuid', name: '2082-83' }] },
    });
    const first = await service.getAcademicYears(SCHOOL_ID, ctx('TenantAdmin'));
    expect(first).toEqual([{ yearId: 'ay-uuid', name: '2082-83' }]);

    // Second call would fail, but the cached SUCCESS array is served (no HTTP).
    httpClient.get.mockRejectedValue(new Error('ECONNREFUSED'));
    const second = await service.getAcademicYears(SCHOOL_ID, ctx('TenantAdmin'));
    expect(second).toEqual([{ yearId: 'ay-uuid', name: '2082-83' }]);
    expect(httpClient.get).toHaveBeenCalledTimes(1);
  });

  it('a failure is NOT cached — a later success returns fresh data', async () => {
    httpClient.get.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    const failed = await service.getAcademicYears(SCHOOL_ID, ctx('TenantAdmin'));
    expect(failed).toBeNull();

    httpClient.get.mockResolvedValueOnce({
      data: { items: [{ yearId: 'ay-2', name: '2083-84' }] },
    });
    const ok = await service.getAcademicYears(SCHOOL_ID, ctx('TenantAdmin'));
    expect(ok).toEqual([{ yearId: 'ay-2', name: '2083-84' }]);
    expect(httpClient.get).toHaveBeenCalledTimes(2);
  });
});
