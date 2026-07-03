import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { RolesService } from '../../roles/roles.service';
import { DynamoDBClientService } from '../services/dynamodb-client.service';

type Perm = {
  resource: string;
  action: string;
  schoolIdParam?: string;
  verifyDynamoRole?: boolean;
};

const ctxFor = (user: unknown, params: Record<string, string> = {}): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ user, params, query: {}, body: {}, headers: {} }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  }) as unknown as ExecutionContext;

function makeGuard(
  permission: Perm | undefined,
  opts: { dbUser?: unknown; checkResult?: { allowed: boolean; reason?: string } } = {},
) {
  const reflector = { getAllAndOverride: jest.fn().mockReturnValue(permission) } as unknown as Reflector;
  const rolesService = {
    checkPermission: jest.fn().mockResolvedValue(opts.checkResult ?? { allowed: true }),
  } as unknown as RolesService;
  const getItem = jest.fn().mockResolvedValue(opts.dbUser);
  const dynamoDBClient = {
    getSystemClient: jest.fn().mockReturnValue({}),
    getItem,
    getClient: jest.fn().mockResolvedValue({}),
  } as unknown as DynamoDBClientService;
  return { guard: new PermissionGuard(reflector, rolesService, dynamoDBClient), getItem, rolesService };
}

const admin = { globalRole: 'TenantAdmin', userId: 'admin-1', tenantId: 'tenant-1', email: 'a@test.edu' };
const teacher = { globalRole: 'TenantUser', userId: 'u-1', tenantId: 'tenant-1', email: 't@test.edu' };

describe('PermissionGuard (identity)', () => {
  it('passes when no @RequirePermission decorator is present', async () => {
    const { guard } = makeGuard(undefined);
    await expect(guard.canActivate(ctxFor(teacher))).resolves.toBe(true);
  });

  it('throws ForbiddenException when unauthenticated', async () => {
    const { guard } = makeGuard({ resource: 'students', action: 'view' });
    await expect(guard.canActivate(ctxFor(undefined))).rejects.toThrow(ForbiddenException);
  });

  it('TenantAdmin bypasses without a DB check when verifyDynamoRole is not set', async () => {
    const { guard, getItem } = makeGuard({ resource: 'students', action: 'delete' });
    await expect(guard.canActivate(ctxFor(admin))).resolves.toBe(true);
    expect(getItem).not.toHaveBeenCalled();
  });

  // PPL.6 — a recently-demoted admin holding a still-valid JWT must be re-checked
  // against DDB for sensitive operations and denied.
  describe('verifyDynamoRole (PPL.6)', () => {
    it('DENIES a TenantAdmin JWT when DDB shows the user was demoted to TenantUser', async () => {
      const { guard } = makeGuard(
        { resource: 'students', action: 'delete', verifyDynamoRole: true },
        { dbUser: { globalRole: 'TenantUser' } },
      );
      await expect(guard.canActivate(ctxFor(admin))).rejects.toThrow(ForbiddenException);
    });

    it('DENIES when the DDB user record is missing', async () => {
      const { guard } = makeGuard(
        { resource: 'students', action: 'delete', verifyDynamoRole: true },
        { dbUser: null },
      );
      await expect(guard.canActivate(ctxFor(admin))).rejects.toThrow(ForbiddenException);
    });

    it('ALLOWS when DDB still confirms TenantAdmin, scoping the lookup to the user', async () => {
      const { guard, getItem } = makeGuard(
        { resource: 'students', action: 'delete', verifyDynamoRole: true },
        { dbUser: { globalRole: 'TenantAdmin' } },
      );
      await expect(guard.canActivate(ctxFor(admin))).resolves.toBe(true);
      expect(getItem).toHaveBeenCalledWith(expect.anything(), 'tenant-1', 'USER#admin-1');
    });
  });

  it('delegates a non-admin to RolesService.checkPermission (allow)', async () => {
    const { guard, rolesService } = makeGuard(
      { resource: 'grades', action: 'view', schoolIdParam: 'schoolId' },
      { checkResult: { allowed: true } },
    );
    await expect(guard.canActivate(ctxFor(teacher, { schoolId: 'school-1' }))).resolves.toBe(true);
    expect(rolesService.checkPermission).toHaveBeenCalled();
  });

  it('denies a non-admin when RolesService.checkPermission denies', async () => {
    const { guard } = makeGuard(
      { resource: 'billing', action: 'edit', schoolIdParam: 'schoolId' },
      { checkResult: { allowed: false, reason: 'not granted' } },
    );
    await expect(guard.canActivate(ctxFor(teacher, { schoolId: 'school-1' }))).rejects.toThrow(ForbiddenException);
  });

  it('denies a non-admin when no school context is resolvable', async () => {
    const { guard } = makeGuard({ resource: 'grades', action: 'view' });
    await expect(guard.canActivate(ctxFor(teacher, {}))).rejects.toThrow(ForbiddenException);
  });
});
