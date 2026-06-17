/**
 * AttendanceController.getAttendancePolicy spec (Sprint 2 / S2.T5).
 *
 * The new GET /academics/attendance/policy endpoint requires schoolId. The
 * PermissionGuard already rejects a missing schoolId for non-admins, but
 * TenantAdmin bypasses that guard — so the handler itself must reject a missing
 * schoolId. Otherwise the resolver's graceful degradation would return 200 with
 * schoolId: undefined, violating attendancePolicyResponseSchema (schoolId is
 * required). The API Gateway `required: true` is documentation-only (no request
 * validator wired), so this handler guard is the real enforcement.
 */
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import { BadRequestException } from '@nestjs/common';
import { AttendanceController } from './attendance.controller';

const tenant = { userId: 'u1', tenantId: 't1', email: 'e', globalRole: 'TenantAdmin', username: 'admin' } as any;
const req = { headers: { authorization: 'Bearer jwt' } } as any;

function makeController() {
  const resolver = { resolveEffectivePolicy: jest.fn<any>() };
  const controller = new AttendanceController({} as any, resolver as any);
  return { controller, resolver };
}

describe('AttendanceController.getAttendancePolicy', () => {
  let h: ReturnType<typeof makeController>;
  beforeEach(() => { h = makeController(); });

  it('throws BadRequestException when schoolId is missing (TenantAdmin bypasses the guard)', async () => {
    await expect(
      h.controller.getAttendancePolicy(undefined as any, tenant, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.resolver.resolveEffectivePolicy).not.toHaveBeenCalled();
  });

  it('throws BadRequestException for an empty-string schoolId', async () => {
    await expect(
      h.controller.getAttendancePolicy('', tenant, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(h.resolver.resolveEffectivePolicy).not.toHaveBeenCalled();
  });

  it('delegates to the resolver with the schoolId + request context when present', async () => {
    h.resolver.resolveEffectivePolicy.mockResolvedValue({ schoolId: 'sch-1', effectiveMode: 'period' });

    const r = await h.controller.getAttendancePolicy('sch-1', tenant, req);

    expect(r).toEqual({ schoolId: 'sch-1', effectiveMode: 'period' });
    expect(h.resolver.resolveEffectivePolicy).toHaveBeenCalledWith(
      'sch-1',
      expect.objectContaining({ tenantId: 't1', userId: 'u1' }),
    );
  });
});
