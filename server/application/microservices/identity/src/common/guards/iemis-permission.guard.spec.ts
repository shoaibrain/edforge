import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IemisPermission } from '@aibrains/shared-types';
import { IemisPermissionGuard } from './iemis-permission.guard';

const ctxFor = (user: unknown): ExecutionContext => ({
  switchToHttp: () => ({ getRequest: () => ({ user }) }) as any,
  getHandler: () => undefined,
  getClass: () => undefined,
}) as unknown as ExecutionContext;

function guardWithRequired(required: IemisPermission[] | undefined) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return { guard: new IemisPermissionGuard(reflector), reflector };
}

describe('IemisPermissionGuard', () => {
  it('passes when no @RequireIemisPermission metadata is present', () => {
    const { guard } = guardWithRequired(undefined);
    expect(guard.canActivate(ctxFor({ globalRole: 'TenantUser', userId: 'u1' }))).toBe(true);
  });

  it('passes when the decorator is present with empty array', () => {
    const { guard } = guardWithRequired([]);
    expect(guard.canActivate(ctxFor({ globalRole: 'TenantUser', userId: 'u1' }))).toBe(true);
  });

  it('throws Unauthorized when user is not authenticated', () => {
    const { guard } = guardWithRequired([IemisPermission.Import]);
    expect(() => guard.canActivate(ctxFor(undefined))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctxFor({}))).toThrow(UnauthorizedException);
  });

  it('grants every tenant-admin IEMIS permission to TenantAdmin', () => {
    const { guard } = guardWithRequired([
      IemisPermission.Import,
      IemisPermission.Export,
      IemisPermission.VerifyCode,
      IemisPermission.ViewAudit,
    ]);
    expect(guard.canActivate(ctxFor({ globalRole: 'TenantAdmin', userId: 'u-admin' }))).toBe(true);
  });

  it('denies TenantAdmin the platform-operator-only ManageTemplates permission', () => {
    const { guard } = guardWithRequired([IemisPermission.ManageTemplates]);
    expect(() =>
      guard.canActivate(ctxFor({ globalRole: 'TenantAdmin', userId: 'u-admin' })),
    ).toThrow(ForbiddenException);
  });

  it('denies TenantUser every IEMIS permission', () => {
    for (const p of Object.values(IemisPermission)) {
      const { guard } = guardWithRequired([p]);
      expect(() =>
        guard.canActivate(ctxFor({ globalRole: 'TenantUser', userId: 'u1' })),
      ).toThrow(ForbiddenException);
    }
  });

  it('grants PlatformOperator the ManageTemplates permission', () => {
    const { guard } = guardWithRequired([IemisPermission.ManageTemplates]);
    expect(
      guard.canActivate(ctxFor({ globalRole: 'PlatformOperator', userId: 'u-ops' })),
    ).toBe(true);
  });

  it('denies PlatformOperator the tenant-admin IEMIS permissions (no accidental privilege escalation)', () => {
    const { guard } = guardWithRequired([IemisPermission.Import]);
    expect(() =>
      guard.canActivate(ctxFor({ globalRole: 'PlatformOperator', userId: 'u-ops' })),
    ).toThrow(ForbiddenException);
  });

  it('forbidden message names every missing permission', () => {
    const { guard } = guardWithRequired([
      IemisPermission.Import,
      IemisPermission.ManageTemplates,
    ]);
    try {
      guard.canActivate(ctxFor({ globalRole: 'TenantAdmin', userId: 'u-admin' }));
      fail('should have thrown');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ForbiddenException);
      expect(e.message).toContain('iemis:manage-templates');
      expect(e.message).not.toContain('iemis:import'); // held, not missing
    }
  });
});
