/**
 * Families Controllers Spec — EPIC-FB Sprint FB-1.6
 *
 * Static-metadata contract tests (schools.controller.spec.ts idiom):
 *   - Feature flag: FamilyGroupsFlagGuard 404s when
 *     FAMILY_GROUPS_ENABLED === 'false', passes otherwise — both states
 *     exercised by mutating process.env
 *   - Both controllers mount JwtAuthGuard + FamilyGroupsFlagGuard at class
 *     level (flag applies to EVERY families route)
 *   - Route paths pinned (three-way registration contract; API GW rows land
 *     in the FB-1.7 follow-up package)
 *   - @RequirePermission mirrors the students controller: reads
 *     students:view, mutations students:edit
 */

import { describe, expect, it, afterEach, beforeEach } from '@jest/globals';
import { NotFoundException, RequestMethod } from '@nestjs/common';
import { PERMISSION_KEY } from '@app/auth';
import { FamiliesController, StudentFamilyController } from './families.controller';
import { FamilyGroupsFlagGuard } from './family-groups-flag.guard';

const ORIGINAL_FLAG = process.env.FAMILY_GROUPS_ENABLED;

describe('FamilyGroupsFlagGuard — feature flag (FB-0.4 contract)', () => {
  let guard: FamilyGroupsFlagGuard;

  beforeEach(() => {
    guard = new FamilyGroupsFlagGuard();
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.FAMILY_GROUPS_ENABLED;
    } else {
      process.env.FAMILY_GROUPS_ENABLED = ORIGINAL_FLAG;
    }
  });

  it("throws NotFoundException when FAMILY_GROUPS_ENABLED === 'false' (routes don't exist)", () => {
    process.env.FAMILY_GROUPS_ENABLED = 'false';
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it("allows when FAMILY_GROUPS_ENABLED === 'true'", () => {
    process.env.FAMILY_GROUPS_ENABLED = 'true';
    expect(guard.canActivate()).toBe(true);
  });

  it('allows when FAMILY_GROUPS_ENABLED is unset (default-on)', () => {
    delete process.env.FAMILY_GROUPS_ENABLED;
    expect(guard.canActivate()).toBe(true);
  });

  it('reads the flag at request time, not module init (flip without re-instantiation)', () => {
    process.env.FAMILY_GROUPS_ENABLED = 'true';
    expect(guard.canActivate()).toBe(true);
    process.env.FAMILY_GROUPS_ENABLED = 'false';
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });
});

describe('class-level guard wiring — flag covers every families route', () => {
  it.each([
    { controller: FamiliesController, name: 'FamiliesController' },
    { controller: StudentFamilyController, name: 'StudentFamilyController' },
  ])('$name mounts JwtAuthGuard + FamilyGroupsFlagGuard at class level', ({ controller }) => {
    const guards = Reflect.getMetadata('__guards__', controller);
    expect(guards).toBeDefined();
    const guardNames = guards.map((g: { name: string }) => g.name);
    expect(guardNames).toContain('JwtAuthGuard');
    expect(guardNames).toContain('FamilyGroupsFlagGuard');
  });
});

describe('route table — paths pinned (FB-1.6)', () => {
  it('FamiliesController is mounted at academics/schools/:schoolId/families', () => {
    expect(Reflect.getMetadata('path', FamiliesController)).toBe(
      'academics/schools/:schoolId/families',
    );
  });

  it('StudentFamilyController is mounted at academics/students/:studentId/family', () => {
    expect(Reflect.getMetadata('path', StudentFamilyController)).toBe(
      'academics/students/:studentId/family',
    );
  });

  it.each([
    ['createFamily', '/', RequestMethod.POST],
    ['listFamilies', '/', RequestMethod.GET],
    ['getFamily', ':familyId', RequestMethod.GET],
    ['updateFamily', ':familyId', RequestMethod.PATCH],
    ['deactivateFamily', ':familyId', RequestMethod.DELETE],
    ['addMember', ':familyId/members', RequestMethod.POST],
    ['removeMember', ':familyId/members/:studentId', RequestMethod.DELETE],
  ] as Array<[string, string, RequestMethod]>)(
    'FamiliesController.%s handles %s',
    (methodName, path, method) => {
      const handler = FamiliesController.prototype[
        methodName as keyof FamiliesController
      ] as object;
      expect(handler).toBeDefined();
      expect(Reflect.getMetadata('path', handler)).toBe(path);
      expect(Reflect.getMetadata('method', handler)).toBe(method);
    },
  );

  it('StudentFamilyController.getStudentFamily handles GET /', () => {
    const handler = StudentFamilyController.prototype.getStudentFamily;
    expect(Reflect.getMetadata('path', handler)).toBe('/');
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.GET);
  });
});

describe('permissions — mirror the students controller (FB-1.6)', () => {
  const familiesRoutes: Array<[string, string, string]> = [
    ['createFamily', 'students', 'edit'],
    ['listFamilies', 'students', 'view'],
    ['getFamily', 'students', 'view'],
    ['updateFamily', 'students', 'edit'],
    ['deactivateFamily', 'students', 'edit'],
    ['addMember', 'students', 'edit'],
    ['removeMember', 'students', 'edit'],
  ];

  it.each(familiesRoutes)(
    "FamiliesController.%s requires %s:%s",
    (methodName, resource, action) => {
      const handler = FamiliesController.prototype[
        methodName as keyof FamiliesController
      ] as object;
      const meta = Reflect.getMetadata(PERMISSION_KEY, handler);
      expect(meta).toBeDefined();
      expect(meta.resource).toBe(resource);
      expect(meta.action).toBe(action);
    },
  );

  it('StudentFamilyController.getStudentFamily requires students:view', () => {
    const meta = Reflect.getMetadata(
      PERMISSION_KEY,
      StudentFamilyController.prototype.getStudentFamily,
    );
    expect(meta).toEqual({ resource: 'students', action: 'view' });
  });

  it.each(familiesRoutes)(
    'FamiliesController.%s mounts PermissionGuard at method level',
    (methodName) => {
      const handler = FamiliesController.prototype[
        methodName as keyof FamiliesController
      ] as object;
      const guards = Reflect.getMetadata('__guards__', handler);
      expect(guards).toBeDefined();
      const guardNames = guards.map((g: { name: string }) => g.name);
      expect(guardNames).toContain('PermissionGuard');
    },
  );

  it('StudentFamilyController.getStudentFamily mounts PermissionGuard at method level', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      StudentFamilyController.prototype.getStudentFamily,
    );
    const guardNames = guards.map((g: { name: string }) => g.name);
    expect(guardNames).toContain('PermissionGuard');
  });
});
