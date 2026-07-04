/**
 * Agreements Controllers Spec — EPIC-FB Sprint FB-2.6
 *
 * Static-metadata contract tests (families.controller.spec.ts idiom):
 *   - Feature flag: BillingAgreementsFlagGuard 404s when
 *     BILLING_AGREEMENTS_ENABLED === 'false', passes otherwise — both
 *     states exercised by mutating process.env
 *   - Both controllers mount JwtAuthGuard + BillingAgreementsFlagGuard at
 *     class level (flag applies to EVERY agreements route)
 *   - Route paths pinned (three-way registration contract; API GW rows
 *     land in the follow-up package)
 *   - FB-2.0b: EVERY route — including reads — requires billing:manage.
 *     This is the owner decision of 2026-07-04; do NOT "fix" reads to
 *     billing:view.
 */

import { describe, expect, it, afterEach, beforeEach } from '@jest/globals';
import { NotFoundException, RequestMethod } from '@nestjs/common';
import { PERMISSION_KEY } from '@app/auth';
import { AgreementsController, StudentAgreementsController } from './agreements.controller';
import { BillingAgreementsFlagGuard } from './billing-agreements-flag.guard';

const ORIGINAL_FLAG = process.env.BILLING_AGREEMENTS_ENABLED;

describe('BillingAgreementsFlagGuard — feature flag (FB-0.4 contract)', () => {
  let guard: BillingAgreementsFlagGuard;

  beforeEach(() => {
    guard = new BillingAgreementsFlagGuard();
  });

  afterEach(() => {
    if (ORIGINAL_FLAG === undefined) {
      delete process.env.BILLING_AGREEMENTS_ENABLED;
    } else {
      process.env.BILLING_AGREEMENTS_ENABLED = ORIGINAL_FLAG;
    }
  });

  it("throws NotFoundException when BILLING_AGREEMENTS_ENABLED === 'false' (routes don't exist)", () => {
    process.env.BILLING_AGREEMENTS_ENABLED = 'false';
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });

  it("allows when BILLING_AGREEMENTS_ENABLED === 'true'", () => {
    process.env.BILLING_AGREEMENTS_ENABLED = 'true';
    expect(guard.canActivate()).toBe(true);
  });

  it('allows when BILLING_AGREEMENTS_ENABLED is unset (default-on)', () => {
    delete process.env.BILLING_AGREEMENTS_ENABLED;
    expect(guard.canActivate()).toBe(true);
  });

  it('reads the flag at request time, not module init (flip without re-instantiation)', () => {
    process.env.BILLING_AGREEMENTS_ENABLED = 'true';
    expect(guard.canActivate()).toBe(true);
    process.env.BILLING_AGREEMENTS_ENABLED = 'false';
    expect(() => guard.canActivate()).toThrow(NotFoundException);
  });
});

describe('class-level guard wiring — flag covers every agreements route', () => {
  it.each([
    { controller: AgreementsController, name: 'AgreementsController' },
    { controller: StudentAgreementsController, name: 'StudentAgreementsController' },
  ])('$name mounts JwtAuthGuard + BillingAgreementsFlagGuard at class level', ({ controller }) => {
    const guards = Reflect.getMetadata('__guards__', controller);
    expect(guards).toBeDefined();
    const guardNames = guards.map((g: { name: string }) => g.name);
    expect(guardNames).toContain('JwtAuthGuard');
    expect(guardNames).toContain('BillingAgreementsFlagGuard');
  });
});

describe('route table — paths pinned (FB-2.6)', () => {
  it('AgreementsController is mounted at finance/schools/:schoolId/agreements', () => {
    expect(Reflect.getMetadata('path', AgreementsController)).toBe(
      'finance/schools/:schoolId/agreements',
    );
  });

  it('StudentAgreementsController is mounted at finance/students/:studentId/agreements', () => {
    expect(Reflect.getMetadata('path', StudentAgreementsController)).toBe(
      'finance/students/:studentId/agreements',
    );
  });

  it.each([
    ['create', '/', RequestMethod.POST],
    ['list', '/', RequestMethod.GET],
    ['get', ':agreementId', RequestMethod.GET],
    ['getVersionHistory', ':agreementId/versions', RequestMethod.GET],
    ['update', ':agreementId', RequestMethod.PATCH],
    ['cancel', ':agreementId/cancel', RequestMethod.POST],
    ['activate', ':agreementId/activate', RequestMethod.POST],
  ] as Array<[string, string, RequestMethod]>)(
    'AgreementsController.%s handles %s',
    (methodName, path, method) => {
      const handler = AgreementsController.prototype[
        methodName as keyof AgreementsController
      ] as object;
      expect(handler).toBeDefined();
      expect(Reflect.getMetadata('path', handler)).toBe(path);
      expect(Reflect.getMetadata('method', handler)).toBe(method);
    },
  );

  it('StudentAgreementsController.listForStudent handles GET /', () => {
    const handler = StudentAgreementsController.prototype.listForStudent;
    expect(Reflect.getMetadata('path', handler)).toBe('/');
    expect(Reflect.getMetadata('method', handler)).toBe(RequestMethod.GET);
  });
});

describe('permissions — EVERY route requires billing:manage (FB-2.0b owner decision)', () => {
  const agreementRoutes = [
    'create',
    'list',
    'get',
    'getVersionHistory',
    'update',
    'cancel',
    'activate',
  ] as const;

  it.each([...agreementRoutes])(
    'AgreementsController.%s requires billing:manage (reads included — FB-2.0b)',
    (methodName) => {
      const handler = AgreementsController.prototype[
        methodName as keyof AgreementsController
      ] as object;
      const meta = Reflect.getMetadata(PERMISSION_KEY, handler);
      expect(meta).toBeDefined();
      expect(meta.resource).toBe('billing');
      expect(meta.action).toBe('manage');
      expect(meta.schoolIdParam).toBe('schoolId');
    },
  );

  it('StudentAgreementsController.listForStudent requires billing:manage with schoolId from the query', () => {
    const meta = Reflect.getMetadata(
      PERMISSION_KEY,
      StudentAgreementsController.prototype.listForStudent,
    );
    expect(meta).toEqual({ resource: 'billing', action: 'manage', schoolIdParam: 'schoolId' });
  });

  it('no agreements route uses billing:view / create / edit / delete (guard against a well-meant "fix")', () => {
    const handlers: object[] = [
      ...agreementRoutes.map(
        (m) => AgreementsController.prototype[m as keyof AgreementsController] as object,
      ),
      StudentAgreementsController.prototype.listForStudent,
    ];
    for (const handler of handlers) {
      const meta = Reflect.getMetadata(PERMISSION_KEY, handler);
      expect(meta.action).toBe('manage');
    }
  });

  it.each([...agreementRoutes])(
    'AgreementsController.%s mounts PermissionGuard at method level',
    (methodName) => {
      const handler = AgreementsController.prototype[
        methodName as keyof AgreementsController
      ] as object;
      const guards = Reflect.getMetadata('__guards__', handler);
      expect(guards).toBeDefined();
      const guardNames = guards.map((g: { name: string }) => g.name);
      expect(guardNames).toContain('PermissionGuard');
    },
  );

  it('StudentAgreementsController.listForStudent mounts PermissionGuard at method level', () => {
    const guards = Reflect.getMetadata(
      '__guards__',
      StudentAgreementsController.prototype.listForStudent,
    );
    const guardNames = guards.map((g: { name: string }) => g.name);
    expect(guardNames).toContain('PermissionGuard');
  });
});
