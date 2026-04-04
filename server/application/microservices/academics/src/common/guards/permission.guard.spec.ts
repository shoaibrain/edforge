import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException, BadRequestException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { IdentityClientService } from '../services/identity-client.service';

// Mock AuditLoggerService (instantiated inline in the guard, not injected)
jest.mock('@app/logger', () => ({
  AuditLoggerService: jest.fn().mockImplementation(() => ({
    logPermissionDenied: jest.fn(),
  })),
}));

describe('PermissionGuard', () => {
  let guard: PermissionGuard;
  let reflector: Reflector;
  let identityClient: jest.Mocked<IdentityClientService>;

  const mockUser = {
    userId: 'user-1',
    tenantId: 'tenant-1',
    email: 'teacher@school.org',
    globalRole: 'StandardUser',
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
      path: '/academics/grades',
      method: 'GET',
      headers: { authorization: 'Bearer test-token' },
    };
    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;
  }

  beforeEach(async () => {
    identityClient = {
      checkPermission: jest.fn(),
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

  it('should allow when no @RequirePermission decorator is set', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);

    const context = createMockContext(mockUser);
    expect(await guard.canActivate(context)).toBe(true);
  });

  it('should throw ForbiddenException when no user on request', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'grades',
      action: 'view',
    });

    const context = createMockContext(null);
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('should bypass permission check for TenantAdmin', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'grades',
      action: 'view',
    });

    const context = createMockContext(mockTenantAdmin);
    expect(await guard.canActivate(context)).toBe(true);
    expect(identityClient.checkPermission).not.toHaveBeenCalled();
  });

  it('should throw BadRequestException when schoolId is missing', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'grades',
      action: 'view',
    });

    const context = createMockContext(mockUser, {}, {}, {});
    await expect(guard.canActivate(context)).rejects.toThrow(BadRequestException);
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Missing required parameter: schoolId',
    );
  });

  it('should extract schoolId from params', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'grades',
      action: 'view',
    });
    identityClient.checkPermission.mockResolvedValue({ allowed: true });

    const context = createMockContext(mockUser, { schoolId: 'school-1' });
    expect(await guard.canActivate(context)).toBe(true);
    expect(identityClient.checkPermission).toHaveBeenCalledWith(
      'user-1',
      'grades',
      'view',
      'school-1',
      expect.objectContaining({ userId: 'user-1', tenantId: 'tenant-1' }),
    );
  });

  it('should extract schoolId from query', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'attendance',
      action: 'create',
    });
    identityClient.checkPermission.mockResolvedValue({ allowed: true });

    const context = createMockContext(mockUser, {}, { schoolId: 'school-2' });
    expect(await guard.canActivate(context)).toBe(true);
    expect(identityClient.checkPermission).toHaveBeenCalledWith(
      'user-1',
      'attendance',
      'create',
      'school-2',
      expect.any(Object),
    );
  });

  it('should extract schoolId from body', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'enrollment',
      action: 'edit',
    });
    identityClient.checkPermission.mockResolvedValue({ allowed: true });

    const context = createMockContext(mockUser, {}, {}, { schoolId: 'school-3' });
    expect(await guard.canActivate(context)).toBe(true);
  });

  it('should use custom schoolIdParam when specified', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'grades',
      action: 'view',
      schoolIdParam: 'targetSchool',
    });
    identityClient.checkPermission.mockResolvedValue({ allowed: true });

    const context = createMockContext(mockUser, {}, { targetSchool: 'school-custom' });
    expect(await guard.canActivate(context)).toBe(true);
    expect(identityClient.checkPermission).toHaveBeenCalledWith(
      'user-1',
      'grades',
      'view',
      'school-custom',
      expect.any(Object),
    );
  });

  it('should deny when identity service returns allowed: false', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'grades',
      action: 'delete',
    });
    identityClient.checkPermission.mockResolvedValue({
      allowed: false,
      reason: 'Role Teacher does not have grades:delete',
    });

    const context = createMockContext(mockUser, { schoolId: 'school-1' });
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Permission denied: grades:delete',
    );
  });

  it('should allow when identity service returns allowed: true', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'grades',
      action: 'edit',
    });
    identityClient.checkPermission.mockResolvedValue({ allowed: true });

    const context = createMockContext(mockUser, { schoolId: 'school-1' });
    expect(await guard.canActivate(context)).toBe(true);
  });

  it('should prioritize params over query over body for schoolId', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
      resource: 'grades',
      action: 'view',
    });
    identityClient.checkPermission.mockResolvedValue({ allowed: true });

    const context = createMockContext(
      mockUser,
      { schoolId: 'from-params' },
      { schoolId: 'from-query' },
      { schoolId: 'from-body' },
    );
    await guard.canActivate(context);
    expect(identityClient.checkPermission).toHaveBeenCalledWith(
      'user-1',
      'grades',
      'view',
      'from-params',
      expect.any(Object),
    );
  });
});
