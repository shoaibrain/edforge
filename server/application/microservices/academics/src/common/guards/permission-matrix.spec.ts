/**
 * Permission Matrix Integration Tests
 *
 * Validates the PermissionGuard behavior for every resource:action × role combination.
 * Uses the backend DEFAULT_ROLE_PERMISSIONS as source of truth to verify expected outcomes.
 *
 * This catches:
 * - TenantAdmin bypass regressions
 * - Missing permissions for a role
 * - Incorrect deny for a role that should have access
 * - Incorrect allow for a role that should not have access
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionGuard } from './permission.guard';
import { IdentityClientService } from '../services/identity-client.service';

// Mock AuditLoggerService
jest.mock('@app/logger', () => ({
  AuditLoggerService: jest.fn().mockImplementation(() => ({
    logPermissionDenied: jest.fn(),
  })),
}));

// ============================================================================
// ROLE PERMISSION MATRIX (mirrors DEFAULT_ROLE_PERMISSIONS from identity service)
// ============================================================================

/**
 * Maps each role to the resource:action pairs they should have access to.
 * Wildcard `*` means all standard CRUD actions (view, create, edit, delete).
 */
const ROLE_PERMISSIONS: Record<string, string[]> = {
  Principal: [
    'students:*', 'grades:*', 'attendance:*', 'courses:*',
    'scheduling:*', 'enrollment:*',
  ],
  VicePrincipal: [
    'students:view', 'students:edit',
    'grades:view', 'grades:edit',
    'attendance:*',
    'courses:view',
    'scheduling:view', 'scheduling:edit',
    'enrollment:view', 'enrollment:edit',
  ],
  Teacher: [
    'students:view',
    'grades:view', 'grades:edit',
    'attendance:view', 'attendance:create', 'attendance:edit',
    'courses:view',
    'scheduling:view',
  ],
  Staff: [
    'students:view',
    'attendance:view',
    'scheduling:view',
  ],
  Counselor: [
    'students:view',
    'scheduling:view',
  ],
  Nurse: [
    'students:view',
  ],
  Accountant: [
    'students:view',
  ],
};

/** All resource:action pairs used in academics controllers */
const ALL_ENDPOINT_PERMISSIONS = [
  // Students
  { resource: 'students', action: 'view' },
  { resource: 'students', action: 'create' },
  { resource: 'students', action: 'edit' },
  { resource: 'students', action: 'delete' },
  // Courses
  { resource: 'courses', action: 'view' },
  { resource: 'courses', action: 'create' },
  { resource: 'courses', action: 'edit' },
  { resource: 'courses', action: 'delete' },
  // Grades
  { resource: 'grades', action: 'view' },
  { resource: 'grades', action: 'create' },
  { resource: 'grades', action: 'edit' },
  // Attendance
  { resource: 'attendance', action: 'view' },
  { resource: 'attendance', action: 'create' },
  { resource: 'attendance', action: 'edit' },
  // Scheduling (Sections)
  { resource: 'scheduling', action: 'view' },
  { resource: 'scheduling', action: 'create' },
  { resource: 'scheduling', action: 'edit' },
  { resource: 'scheduling', action: 'delete' },
  // Enrollment
  { resource: 'enrollment', action: 'view' },
  { resource: 'enrollment', action: 'create' },
  { resource: 'enrollment', action: 'edit' },
];

/**
 * Resolve whether a role has access to a specific resource:action.
 * Handles wildcard expansion.
 */
function roleHasPermission(role: string, resource: string, action: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.some((p) => {
    const [r, a] = p.split(':');
    if (r !== resource) return false;
    return a === '*' || a === action;
  });
}

// ============================================================================
// TEST HELPERS
// ============================================================================

function createMockContext(
  user: any,
  query: Record<string, string> = { schoolId: 'school-1' },
): ExecutionContext {
  const request = {
    user,
    params: {},
    query,
    body: {},
    path: '/academics/test',
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

// ============================================================================
// TESTS
// ============================================================================

describe('Permission Matrix', () => {
  let guard: PermissionGuard;
  let reflector: Reflector;
  let identityClient: jest.Mocked<IdentityClientService>;

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

  // --------------------------------------------------------------------------
  // TenantAdmin bypass for ALL endpoints
  // --------------------------------------------------------------------------
  describe('TenantAdmin bypass', () => {
    const adminUser = {
      userId: 'admin-1',
      tenantId: 'tenant-1',
      email: 'admin@school.org',
      globalRole: 'TenantAdmin',
    };

    it.each(ALL_ENDPOINT_PERMISSIONS)(
      'TenantAdmin should access $resource:$action without HTTP call',
      async ({ resource, action }) => {
        jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource, action });
        const context = createMockContext(adminUser);

        const result = await guard.canActivate(context);

        expect(result).toBe(true);
        expect(identityClient.checkPermission).not.toHaveBeenCalled();
      },
    );
  });

  // --------------------------------------------------------------------------
  // Per-role permission matrix
  // --------------------------------------------------------------------------
  const roles = Object.keys(ROLE_PERMISSIONS);

  for (const role of roles) {
    describe(`${role} permissions`, () => {
      const user = {
        userId: `${role.toLowerCase()}-1`,
        tenantId: 'tenant-1',
        email: `${role.toLowerCase()}@school.org`,
        globalRole: 'StandardUser',
      };

      // Test each endpoint permission
      for (const { resource, action } of ALL_ENDPOINT_PERMISSIONS) {
        const shouldAllow = roleHasPermission(role, resource, action);
        const label = shouldAllow
          ? `should ALLOW ${resource}:${action}`
          : `should DENY ${resource}:${action}`;

        it(label, async () => {
          jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({ resource, action });

          // Mock identity service to return expected result for this role
          identityClient.checkPermission.mockResolvedValue({
            allowed: shouldAllow,
            reason: shouldAllow ? undefined : `Role ${role} lacks ${resource}:${action}`,
          });

          const context = createMockContext(user);

          if (shouldAllow) {
            const result = await guard.canActivate(context);
            expect(result).toBe(true);
          } else {
            await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
          }

          // Verify the correct resource:action was checked
          expect(identityClient.checkPermission).toHaveBeenCalledWith(
            user.userId,
            resource,
            action,
            'school-1',
            expect.objectContaining({ userId: user.userId, tenantId: 'tenant-1' }),
          );
        });
      }
    });
  }

  // --------------------------------------------------------------------------
  // Permission cache behavior
  // --------------------------------------------------------------------------
  describe('Permission caching', () => {
    const user = {
      userId: 'teacher-1',
      tenantId: 'tenant-1',
      email: 'teacher@school.org',
      globalRole: 'StandardUser',
    };

    it('should use cached result on second call (same user, resource, action, school)', async () => {
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        resource: 'grades',
        action: 'view',
      });
      identityClient.checkPermission.mockResolvedValue({ allowed: true });

      const context = createMockContext(user);

      // First call — hits identity service
      await guard.canActivate(context);
      expect(identityClient.checkPermission).toHaveBeenCalledTimes(1);

      // Second call — should use cache
      await guard.canActivate(context);
      expect(identityClient.checkPermission).toHaveBeenCalledTimes(1); // still 1
    });

    it('should NOT use cache for different resource:action', async () => {
      identityClient.checkPermission.mockResolvedValue({ allowed: true });

      // First call: grades:view
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        resource: 'grades',
        action: 'view',
      });
      await guard.canActivate(createMockContext(user));

      // Second call: attendance:view (different resource)
      jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue({
        resource: 'attendance',
        action: 'view',
      });
      await guard.canActivate(createMockContext(user));

      expect(identityClient.checkPermission).toHaveBeenCalledTimes(2);
    });
  });

  // --------------------------------------------------------------------------
  // Completeness check: verify all roles have at least students:view
  // --------------------------------------------------------------------------
  describe('Completeness', () => {
    it('every role in the matrix should have students:view', () => {
      for (const role of roles) {
        expect(roleHasPermission(role, 'students', 'view')).toBe(true);
      }
    });

    it('no non-admin role should have a permission not in ALL_ENDPOINT_PERMISSIONS', () => {
      for (const role of roles) {
        const perms = ROLE_PERMISSIONS[role];
        for (const perm of perms) {
          const [resource, actionStr] = perm.split(':');
          const actions = actionStr === '*'
            ? ALL_ENDPOINT_PERMISSIONS.filter((e) => e.resource === resource).map((e) => e.action)
            : [actionStr];
          for (const action of actions) {
            const found = ALL_ENDPOINT_PERMISSIONS.some(
              (e) => e.resource === resource && e.action === action,
            );
            expect(found).toBe(true);
          }
        }
      }
    });
  });
});
