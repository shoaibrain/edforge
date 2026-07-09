/**
 * `IdentityClientService.getAcademicYears` — BH-1.4 AY-scoping resolution.
 *
 * The route identity exposes (`GET /schools/:id/academic-years`) is
 * `@RequirePermission('scheduling','view')`. The Accountant role (a PRIMARY
 * invoice-generating role, has `billing:create`) lacks `scheduling:view`, so
 * this call 403s and AY-scoped sibling discounts silently degrade to unscoped
 * for every Accountant generation.
 *
 * Finance has NO service-auth path to this route — `HttpClientService` only
 * forwards the operator JWT, and the identity route carries no
 * internal-api-key bypass. So the fix (path b) is to keep the operator-JWT
 * call and make the degrade OBSERVABLE: a 403 logs a WARN naming the role and
 * the missing `scheduling:view` permission, so the no-op is actionable rather
 * than silent. These tests pin that observability contract.
 *
 * BH-1.4 hardening (3-state): the method returns `null` on any CALL FAILURE
 * (403 / identity down / network) — distinct from a SUCCESS that returns an
 * array (possibly empty). The caller uses `null` to mean "unavailable →
 * unscoped degrade + retry" and never confuses it with "no years configured".
 * These tests pin `null` on failure (generation still never 5xxes) and that
 * success (an array) is cached but failure (null) is not.
 */

import { HttpClientService } from '@app/http-client';
import { Logger } from '@nestjs/common';
import { IdentityClientService } from './identity-client.service';
import type { RequestContext } from '../entities/base.entity';

const SCHOOL_ID = 'school-1';

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

  beforeEach(() => {
    httpClient = { get: jest.fn() };
    service = new IdentityClientService(httpClient as unknown as HttpClientService);
    warnSpy = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('happy path → returns the {yearId, name} rows', async () => {
    httpClient.get.mockResolvedValue({
      data: { items: [{ yearId: 'ay-uuid', name: '2082-83' }] },
    });

    const years = await service.getAcademicYears(SCHOOL_ID, ctx('TenantAdmin'));
    expect(years).toEqual([{ yearId: 'ay-uuid', name: '2082-83' }]);
  });

  it('403 (Accountant lacks scheduling:view) → returns null (unavailable) AND logs a WARN naming the role + permission', async () => {
    const err: any = new Error('Request failed with status code 403');
    err.response = { status: 403 };
    httpClient.get.mockRejectedValue(err);

    const years = await service.getAcademicYears(SCHOOL_ID, ctx('Accountant'));

    // BH-1.4 hardening — null == CALL FAILED (unavailable), NOT success-empty.
    // Generation still never 5xxes (caller degrades to unscoped on null).
    expect(years).toBeNull();

    // Observable: the WARN names the role and the missing permission so the
    // silent Accountant no-op is actionable.
    const warnMessage = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMessage).toContain("role='Accountant'");
    expect(warnMessage).toContain('scheduling:view');
    expect(warnMessage).toContain('status=403');
  });

  it('non-403 failure (identity down) → returns null (unavailable) WITHOUT the permission hint', async () => {
    const err: any = new Error('ECONNREFUSED');
    httpClient.get.mockRejectedValue(err);

    const years = await service.getAcademicYears(SCHOOL_ID, ctx('Accountant'));

    expect(years).toBeNull();
    const warnMessage = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMessage).not.toContain('scheduling:view');
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
