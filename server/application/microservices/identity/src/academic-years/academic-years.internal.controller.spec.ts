/**
 * AcademicYearsInternalController — BH-1.4 service-auth AY read.
 *
 * The internal route lists a school's academic years for finance's
 * sibling-discount label→id resolution, authenticated by `x-internal-api-key`
 * (InternalApiKeyGuard) rather than the operator `scheduling:view` permission.
 * It returns the SAME rows as the operator route by calling the SAME service
 * method (`AcademicYearsService.listAcademicYears`), with NO permission gate —
 * so the Accountant role and the enrollment-webhook context (which lack
 * scheduling:view) resolve the year instead of degrading to unscoped.
 *
 * These tests pin: (1) a valid key returns the years, (2) a missing/wrong key
 * 401s via the guard, (3) the tenant + JWT for the tenant-scoped DDB read come
 * from the forwarded operator headers, not from a permission-bearing session.
 */

import { UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { AcademicYearsInternalController } from './academic-years.internal.controller';
import { InternalApiKeyGuard } from '../common/guards/internal-api-key.guard';
import { AcademicYearsService } from './academic-years.service';

const SCHOOL_ID = 'school-1';
const KEY = 'fixture-value-alpha0'; // 20 chars

const reqWith = (headers: Record<string, unknown>): Request =>
  ({ headers }) as unknown as Request;

describe('AcademicYearsInternalController (BH-1.4 service-auth)', () => {
  let controller: AcademicYearsInternalController;
  let service: { listAcademicYears: jest.Mock };
  const ORIGINAL = process.env.INTERNAL_API_KEY;

  beforeEach(() => {
    process.env.INTERNAL_API_KEY = KEY;
    service = {
      listAcademicYears: jest.fn().mockResolvedValue({
        items: [{ yearId: 'ay-uuid', name: '2082-83' } as any],
        lastEvaluatedKey: undefined,
        hasMore: false,
      }),
    };
    controller = new AcademicYearsInternalController(
      service as unknown as AcademicYearsService,
    );
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.INTERNAL_API_KEY;
    else process.env.INTERNAL_API_KEY = ORIGINAL;
  });

  it('returns the same academic-year rows as the operator route (no permission gate)', async () => {
    const req = reqWith({
      authorization: 'Bearer jwt-abc',
      'x-tenant-id': 'tenant-a',
      'x-user-id': 'accountant-1',
      'x-user-role': 'Accountant',
    });

    const result = await controller.listAcademicYears(SCHOOL_ID, '', req);

    expect(result.items).toEqual([{ yearId: 'ay-uuid', name: '2082-83' }]);
    expect(result.hasMore).toBe(false);
  });

  it('derives the tenant-scoped DDB context from the forwarded operator headers, not a session', async () => {
    const req = reqWith({
      authorization: 'Bearer jwt-abc',
      'x-tenant-id': 'tenant-a',
      'x-user-id': 'accountant-1',
      'x-user-role': 'Accountant',
    });

    await controller.listAcademicYears(SCHOOL_ID, '25', req);

    // The service is called with the tenant + JWT extracted from headers so the
    // TokenVendingMachine can vend tenant-scoped DDB creds; the Accountant role
    // is IRRELEVANT here (no scheduling:view check on this route).
    const [calledSchoolId, ctx, limit] = service.listAcademicYears.mock.calls[0];
    expect(calledSchoolId).toBe(SCHOOL_ID);
    expect(ctx.tenantId).toBe('tenant-a');
    expect(ctx.jwtToken).toBe('jwt-abc');
    expect(limit).toBe(25);
  });

  it('defaults limit to 20 when absent', async () => {
    const req = reqWith({ authorization: 'Bearer jwt-abc', 'x-tenant-id': 'tenant-a' });

    await controller.listAcademicYears(SCHOOL_ID, '', req);

    expect(service.listAcademicYears.mock.calls[0][2]).toBe(20);
  });

  describe('InternalApiKeyGuard protects the route', () => {
    it('allows a request carrying the correct x-internal-api-key', () => {
      const guard = new InternalApiKeyGuard();
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-internal-api-key': KEY } }) }),
      } as any;
      expect(guard.canActivate(ctx)).toBe(true);
    });

    it('rejects a request with no key (401)', () => {
      const guard = new InternalApiKeyGuard();
      const ctx = { switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }) } as any;
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('rejects a wrong key of the same length (401)', () => {
      const guard = new InternalApiKeyGuard();
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-internal-api-key': 'fixture-value-bravo0' } }) }),
      } as any;
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });

    it('fail-closed 401 when INTERNAL_API_KEY is not configured', () => {
      delete process.env.INTERNAL_API_KEY;
      const guard = new InternalApiKeyGuard();
      const ctx = {
        switchToHttp: () => ({ getRequest: () => ({ headers: { 'x-internal-api-key': KEY } }) }),
      } as any;
      expect(() => guard.canActivate(ctx)).toThrow(UnauthorizedException);
    });
  });
});
