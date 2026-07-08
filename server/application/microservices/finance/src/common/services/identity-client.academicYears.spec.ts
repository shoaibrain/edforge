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
 * than silent. These tests pin that observability contract + the safe
 * degrade-to-`[]` (generation never 5xxes on identity failure).
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

  it('403 (Accountant lacks scheduling:view) → degrades to [] AND logs a WARN naming the role + permission', async () => {
    const err: any = new Error('Request failed with status code 403');
    err.response = { status: 403 };
    httpClient.get.mockRejectedValue(err);

    const years = await service.getAcademicYears(SCHOOL_ID, ctx('Accountant'));

    // Safe degrade — never 5xxes generation.
    expect(years).toEqual([]);

    // Observable: the WARN names the role and the missing permission so the
    // silent Accountant no-op is actionable.
    const warnMessage = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMessage).toContain("role='Accountant'");
    expect(warnMessage).toContain('scheduling:view');
    expect(warnMessage).toContain('status=403');
  });

  it('non-403 failure (identity down) → degrades to [] WITHOUT the permission hint', async () => {
    const err: any = new Error('ECONNREFUSED');
    httpClient.get.mockRejectedValue(err);

    const years = await service.getAcademicYears(SCHOOL_ID, ctx('Accountant'));

    expect(years).toEqual([]);
    const warnMessage = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warnMessage).not.toContain('scheduling:view');
  });
});
