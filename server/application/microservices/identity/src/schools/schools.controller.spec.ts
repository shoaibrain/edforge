/**
 * Sprint C Gap 2 — RBAC decorator contract for SchoolsController.
 *
 * Why reflection, not end-to-end HTTP: the `GlobalRoleGuard` itself is already
 * proven in prod against `TenantsController`, `UsersController`, `RolesController`,
 * etc. — its `canActivate` logic is not what we're testing here. What we ARE
 * testing is that every write endpoint on this specific controller carries the
 * `@RequireGlobalRole('TenantAdmin')` decorator, and that read endpoints
 * deliberately do not. A drift (someone deletes the decorator during a
 * refactor) silently re-opens the endpoint. Reflection catches that in <10ms
 * per case without a full NestJS test bootstrap.
 *
 * The spec also pins the class-level `@UseGuards(JwtAuthGuard, GlobalRoleGuard)`
 * pairing so the guard is actually mounted. Omitting GlobalRoleGuard at class
 * level would make every @RequireGlobalRole a no-op.
 */
import { Reflector } from '@nestjs/core';
import { SchoolsController } from './schools.controller';
import { GLOBAL_ROLES_KEY } from '../common/decorators/require-global-role.decorator';
import { PERMISSION_KEY } from '../common/decorators/require-permission.decorator';

describe('SchoolsController — RBAC decorator contract', () => {
  const reflector = new Reflector();

  /**
   * Endpoints that MUST carry `@RequireGlobalRole('TenantAdmin')`.
   * Update this list when adding a new write endpoint — the test is the
   * single source of truth for "which school endpoints are TenantAdmin-only".
   */
  const TENANT_ADMIN_ONLY_METHODS = [
    'createSchool',
    'updateSchool',
    'deleteSchool',
    'updateConfiguration',
    'transitionStatus',
    'createDepartment',
    'updateDepartment',
    'deleteDepartment',
    'getAuditLog',
  ] as const;

  /**
   * Endpoints that MUST stay open to any authenticated tenant member.
   * Teachers/Principals/Students need these for navigation + role-assignment.
   * Asserting absence of the decorator locks in the "read is open" contract.
   */
  const OPEN_READ_METHODS = [
    'listSchools',
    'getSchool',
    'getConfiguration',
    'listDepartments',
    'getDepartment',
    // S0.6 — read-only view of the activation gate. Any authenticated user
    // can see the checklist; only TenantAdmin can flip the school to active.
    'getActivationRequirements',
  ] as const;

  /**
   * Phase 1 — endpoints gated by ABAC `@RequirePermission` instead of
   * the coarser `@RequireGlobalRole('TenantAdmin')`. Principal, VP, and
   * any other school-scoped role granted the listed permission can
   * call them. The PermissionGuard auto-bypasses TenantAdmin so admins
   * still work without explicit grants.
   *
   * The tuple form (method, resource, action) lets the test below
   * assert the precise permission contract — not just "decorator present".
   */
  const PERMISSION_BASED_METHODS = [
    ['updateGradeLevels', 'gradelevels', 'edit'],
  ] as const;

  describe.each(TENANT_ADMIN_ONLY_METHODS)(
    'write endpoint: %s',
    (methodName) => {
      it('requires TenantAdmin global role', () => {
        const handler = SchoolsController.prototype[
          methodName as keyof SchoolsController
        ];
        expect(handler).toBeDefined();

        const roles = reflector.get<string[] | undefined>(
          GLOBAL_ROLES_KEY,
          handler,
        );
        expect(roles).toBeDefined();
        expect(roles).toEqual(['TenantAdmin']);
      });
    },
  );

  describe.each(OPEN_READ_METHODS)('read endpoint: %s', (methodName) => {
    it('does NOT require a global role (open to any authenticated user)', () => {
      const handler = SchoolsController.prototype[
        methodName as keyof SchoolsController
      ];
      expect(handler).toBeDefined();

      const roles = reflector.get<string[] | undefined>(
        GLOBAL_ROLES_KEY,
        handler,
      );
      expect(roles).toBeUndefined();
    });
  });

  describe.each(PERMISSION_BASED_METHODS)(
    'permission-gated endpoint: %s (%s:%s)',
    (methodName, resource, action) => {
      it(`carries @RequirePermission({ resource: '${resource}', action: '${action}' })`, () => {
        const handler = SchoolsController.prototype[
          methodName as keyof SchoolsController
        ];
        expect(handler).toBeDefined();

        const meta = reflector.get<{ resource: string; action: string } | undefined>(
          PERMISSION_KEY,
          handler,
        );
        expect(meta).toBeDefined();
        expect(meta?.resource).toBe(resource);
        expect(meta?.action).toBe(action);
      });

      it('does NOT also require TenantAdmin (PermissionGuard auto-bypasses)', () => {
        const handler = SchoolsController.prototype[
          methodName as keyof SchoolsController
        ];
        const roles = reflector.get<string[] | undefined>(GLOBAL_ROLES_KEY, handler);
        expect(roles).toBeUndefined();
      });
    },
  );

  describe('class-level guard wiring', () => {
    it('mounts JwtAuthGuard + GlobalRoleGuard at class level', () => {
      // NestJS stores class-level @UseGuards metadata under '__guards__'.
      // Asserting two guards are registered ensures the GlobalRoleGuard is
      // actually wired — without it, per-method @RequireGlobalRole is a no-op.
      const guards = Reflect.getMetadata('__guards__', SchoolsController);
      expect(guards).toBeDefined();
      expect(guards).toHaveLength(2);
      // Guard identity is verified by the guards having the right names at
      // the class-metadata slot. We check names to stay resilient to import
      // aliasing.
      const guardNames = guards.map((g: { name: string }) => g.name);
      expect(guardNames).toContain('JwtAuthGuard');
      expect(guardNames).toContain('GlobalRoleGuard');
    });
  });

  describe('handler coverage', () => {
    it('every handler on SchoolsController is classified as write or read', () => {
      // Drift guard: if someone adds a new handler but forgets to update the
      // two lists above, this fails and points at the unclassified method.
      const ownMethods = Object.getOwnPropertyNames(
        SchoolsController.prototype,
      ).filter((name) => {
        if (name === 'constructor' || name === 'buildContext') return false;
        const descriptor = Object.getOwnPropertyDescriptor(
          SchoolsController.prototype,
          name,
        );
        return typeof descriptor?.value === 'function';
      });

      const classified = new Set<string>([
        ...TENANT_ADMIN_ONLY_METHODS,
        ...OPEN_READ_METHODS,
        ...PERMISSION_BASED_METHODS.map(([m]) => m),
      ]);
      const unclassified = ownMethods.filter((m) => !classified.has(m));
      expect(unclassified).toEqual([]);
    });
  });
});
