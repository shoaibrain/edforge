import { Test, TestingModule } from '@nestjs/testing';
import {
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { IdentityClientService } from '../services/identity-client.service';

// AuditLoggerService is instantiated inline in the guard (not injected). The
// `mock`-prefixed name lets the hoisted jest.mock factory reference it, so we
// can assert the breach-investigation trail actually fires on deny paths.
const mockLogPermissionDenied = jest.fn();
jest.mock('@app/logger', () => ({
  AuditLoggerService: jest.fn().mockImplementation(() => ({
    logPermissionDenied: mockLogPermissionDenied,
  })),
}));

describe('Finance PermissionGuard', () => {
  let guard: PermissionGuard;
  let reflector: Reflector;
  let identityClient: jest.Mocked<IdentityClientService>;

  const mockUser = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    email: 'accountant@school.org',
    globalRole: 'TenantUser',
  };

  const mockTenantAdmin = {
    userId: 'admin-1',
    tenantId: 'tenant-1',
    email: 'admin@school.org',
    globalRole: 'TenantAdmin',
  };

  function createMockContext(
    user: any,
    params: Record<string, string> = {},
    query: Record<string, string> = {},
    body: Record<string, string> = {},
  ): ExecutionContext {
    const request = {
      user,
      params,
      query,
      body,
      path: '/finance/invoices',
      method: 'GET',
      headers: { authorization: 'Bearer test-token' },
    };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    jest.clearAllMocks();
    identityClient = {
      checkPermission: jest.fn(),
      getSchoolName: jest.fn().mockResolvedValue('Some School'),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionGuard,
        { provide: Reflector, useValue: new Reflector() },
        { provide: IdentityClientService, useValue: identityClient },
      ],
    }).compile();

    guard = module.get<PermissionGuard>(PermissionGuard);
    reflector = module.get<Reflector>(Reflector);
  });

  it('allows when no @RequirePermission decorator is set', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    expect(await guard.canActivate(createMockContext(mockUser))).toBe(true);
    expect(identityClient.checkPermission).not.toHaveBeenCalled();
  });

  it('throws ForbiddenException when no user on request', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'view' });
    await expect(guard.canActivate(createMockContext(null))).rejects.toThrow(ForbiddenException);
  });

  it('bypasses the permission check for TenantAdmin (no identity call)', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'delete' });
    expect(await guard.canActivate(createMockContext(mockTenantAdmin))).toBe(true);
    expect(identityClient.checkPermission).not.toHaveBeenCalled();
  });

  it('throws BadRequest AND logs an audit event when schoolId is missing', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'create' });
    await expect(guard.canActivate(createMockContext(mockUser))).rejects.toThrow(BadRequestException);
    expect(mockLogPermissionDenied).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
      'billing',
      'create',
      undefined,
      expect.any(String),
    );
  });

  it('extracts schoolId from params and forwards the check to identity', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'invoices', action: 'view' });
    identityClient.checkPermission.mockResolvedValue({ allowed: true });

    expect(await guard.canActivate(createMockContext(mockUser, { schoolId: 'school-1' }))).toBe(true);
    expect(identityClient.checkPermission).toHaveBeenCalledWith(
      'user-1',
      'invoices',
      'view',
      'school-1',
      expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1' }),
    );
  });

  it('prioritizes params over query over body for schoolId', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'view' });
    identityClient.checkPermission.mockResolvedValue({ allowed: true });

    await guard.canActivate(
      createMockContext(mockUser, { schoolId: 'from-params' }, { schoolId: 'from-query' }, { schoolId: 'from-body' }),
    );
    expect(identityClient.checkPermission).toHaveBeenCalledWith(
      'user-1',
      'billing',
      'view',
      'from-params',
      expect.any(Object),
    );
  });

  it('honors a custom schoolIdParam', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'invoices',
      action: 'view',
      schoolIdParam: 'targetSchool',
    });
    identityClient.checkPermission.mockResolvedValue({ allowed: true });

    expect(await guard.canActivate(createMockContext(mockUser, {}, { targetSchool: 'school-x' }))).toBe(true);
    expect(identityClient.checkPermission).toHaveBeenCalledWith(
      'user-1',
      'invoices',
      'view',
      'school-x',
      expect.any(Object),
    );
  });

  it('allows when identity returns allowed: true', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'create' });
    identityClient.checkPermission.mockResolvedValue({ allowed: true });
    expect(await guard.canActivate(createMockContext(mockUser, { schoolId: 'school-1' }))).toBe(true);
  });

  it('denies AND logs an audit event when identity returns allowed: false', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'delete' });
    identityClient.checkPermission.mockResolvedValue({ allowed: false, reason: 'denied' });

    await expect(guard.canActivate(createMockContext(mockUser, { schoolId: 'school-1' }))).rejects.toThrow(
      'Permission denied: billing:delete',
    );
    expect(mockLogPermissionDenied).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-1', userId: 'user-1' }),
      'billing',
      'delete',
      'school-1',
      expect.any(String),
    );
  });

  // ───────────────────────────────────────────────────────────────────────
  // SH.1 — School-existence hardening (plan §5c, 2026-06-28 prod finding).
  // PermissionGuard must NOT return true for a UUID-shaped schoolId that
  // doesn't resolve to a real school in the tenant — even when the
  // operator's `billing:view` is granted on every school in the tenant.
  // ───────────────────────────────────────────────────────────────────────
  describe('SH.1 — school-existence check', () => {
    const REAL_SCHOOL = '11111111-2222-3333-4444-555555555555';
    const FAKE_SCHOOL = '00000000-0000-0000-0000-000000000000';

    it('rejects unknown schoolId with 404 even when operator has billing:view on their tenant', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'view' });
      identityClient.checkPermission.mockResolvedValue({ allowed: true });
      (identityClient.getSchoolName as jest.Mock).mockResolvedValue(null);

      await expect(
        guard.canActivate(createMockContext(mockUser, { schoolId: FAKE_SCHOOL })),
      ).rejects.toThrow(NotFoundException);
      await expect(
        guard.canActivate(createMockContext(mockUser, { schoolId: FAKE_SCHOOL })),
      ).rejects.toThrow(/not found/i);
    });

    it('passes when schoolId exists', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'view' });
      identityClient.checkPermission.mockResolvedValue({ allowed: true });
      (identityClient.getSchoolName as jest.Mock).mockResolvedValue('Saraswati Boarding School');

      expect(
        await guard.canActivate(createMockContext(mockUser, { schoolId: REAL_SCHOOL })),
      ).toBe(true);
      expect(identityClient.getSchoolName).toHaveBeenCalledWith(
        REAL_SCHOOL,
        expect.objectContaining({ tenantId: 'tenant-1' }),
      );
    });

    it('skips school-existence check when no schoolId is extractable (e.g. non-school-scoped routes)', async () => {
      // A decorator that declares a schoolIdParam pointing at a key not
      // present anywhere in the request — guard reaches its own
      // BadRequest path BEFORE the existence check, so getSchoolName
      // MUST NOT be called.
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        resource: 'billing',
        action: 'view',
        schoolIdParam: 'someOtherKey',
      });

      await expect(
        guard.canActivate(createMockContext(mockUser, { schoolId: REAL_SCHOOL })),
      ).rejects.toThrow(BadRequestException);
      expect(identityClient.getSchoolName).not.toHaveBeenCalled();
    });

    it('treats identity-service failure on getSchoolName as not-found (fail-closed)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'view' });
      identityClient.checkPermission.mockResolvedValue({ allowed: true });
      (identityClient.getSchoolName as jest.Mock).mockRejectedValue(
        new Error('ECONNREFUSED identity-api'),
      );

      await expect(
        guard.canActivate(createMockContext(mockUser, { schoolId: REAL_SCHOOL })),
      ).rejects.toThrow(NotFoundException);
    });

    it('TenantAdmin does NOT bypass the school-existence check', async () => {
      // The SH.1 finding was triggered specifically with a TenantAdmin
      // token. The role-bypass at the top of the guard skips
      // checkPermission for TenantAdmin, but the existence check is a
      // separate contract ("URL must reference a real school") and runs
      // regardless of role.
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'view' });
      (identityClient.getSchoolName as jest.Mock).mockResolvedValue(null);

      await expect(
        guard.canActivate(createMockContext(mockTenantAdmin, { schoolId: FAKE_SCHOOL })),
      ).rejects.toThrow(NotFoundException);
      expect(identityClient.checkPermission).not.toHaveBeenCalled();
      expect(identityClient.getSchoolName).toHaveBeenCalled();
    });

    it('TenantAdmin passes when school exists', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'view' });
      (identityClient.getSchoolName as jest.Mock).mockResolvedValue('Saraswati');

      expect(
        await guard.canActivate(createMockContext(mockTenantAdmin, { schoolId: REAL_SCHOOL })),
      ).toBe(true);
      expect(identityClient.checkPermission).not.toHaveBeenCalled();
    });

    it('skips identity call entirely when schoolId is not UUID-shaped', async () => {
      // Defensive — DTO Zod validators reject non-UUID schoolIds
      // downstream with 400. The guard shouldn't round-trip to identity
      // for inputs that can't be real schools.
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'view' });
      identityClient.checkPermission.mockResolvedValue({ allowed: true });

      expect(
        await guard.canActivate(createMockContext(mockUser, { schoolId: 'not-a-uuid' })),
      ).toBe(true);
      expect(identityClient.getSchoolName).not.toHaveBeenCalled();
    });

    it('memoizes school-existence within TTL — repeated calls hit identity once', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'view' });
      identityClient.checkPermission.mockResolvedValue({ allowed: true });
      (identityClient.getSchoolName as jest.Mock).mockResolvedValue('Saraswati');
      const ctx = () => createMockContext(mockUser, { schoolId: REAL_SCHOOL });

      expect(await guard.canActivate(ctx())).toBe(true);
      expect(await guard.canActivate(ctx())).toBe(true);
      expect(identityClient.getSchoolName).toHaveBeenCalledTimes(1);
    });
  });

  describe('decision cache', () => {
    it('serves a cached ALLOW without re-calling identity', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'invoices', action: 'view' });
      identityClient.checkPermission.mockResolvedValue({ allowed: true });
      const ctx = () => createMockContext(mockUser, { schoolId: 'school-1' });

      expect(await guard.canActivate(ctx())).toBe(true);
      expect(await guard.canActivate(ctx())).toBe(true);
      expect(identityClient.checkPermission).toHaveBeenCalledTimes(1);
    });

    it('serves a cached DENY without re-calling identity (still throws)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource: 'billing', action: 'delete' });
      identityClient.checkPermission.mockResolvedValue({ allowed: false, reason: 'denied' });
      const ctx = () => createMockContext(mockUser, { schoolId: 'school-1' });

      await expect(guard.canActivate(ctx())).rejects.toThrow(ForbiddenException);
      await expect(guard.canActivate(ctx())).rejects.toThrow(ForbiddenException);
      expect(identityClient.checkPermission).toHaveBeenCalledTimes(1);
      // FINDING: cached denials are NOT re-audited — only the first (fresh) deny
      // logs. Repeated denied attempts within the cache window therefore produce a
      // single audit entry, undercounting denial attempts in the breach trail.
      expect(mockLogPermissionDenied).toHaveBeenCalledTimes(1);
    });
  });
});
