import {
  isSystemAdmin,
  requireOwnTenantOrSystemAdmin,
  requireSystemAdmin,
  ForbiddenError,
} from './authz';
import type { JwtClaims } from './jwt-claims';

function mk(overrides: Partial<JwtClaims> = {}): JwtClaims {
  return {
    userId: 'user-a',
    tenantId: 'tenant-A',
    email: 'user-a@example.com',
    globalRole: 'TenantAdmin',
    tenantTier: 'BASIC',
    ...overrides,
  };
}

beforeEach(() => {
  process.env.SYSTEM_ADMIN_EMAILS = 'sysadmin@example.com,ops@example.com';
});

afterEach(() => {
  delete process.env.SYSTEM_ADMIN_EMAILS;
});

describe('isSystemAdmin', () => {
  it('true when email is in SYSTEM_ADMIN_EMAILS', () => {
    expect(isSystemAdmin(mk({ email: 'sysadmin@example.com' }))).toBe(true);
  });
  it('false otherwise', () => {
    expect(isSystemAdmin(mk())).toBe(false);
  });
  it('lowercases for comparison', () => {
    expect(isSystemAdmin(mk({ email: 'OPS@EXAMPLE.COM' }))).toBe(true);
  });
  it('empty SYSTEM_ADMIN_EMAILS → nobody is admin', () => {
    process.env.SYSTEM_ADMIN_EMAILS = '';
    expect(isSystemAdmin(mk({ email: 'sysadmin@example.com' }))).toBe(false);
  });
});

describe('requireOwnTenantOrSystemAdmin', () => {
  it('allows same-tenant read', () => {
    expect(() => requireOwnTenantOrSystemAdmin(mk(), 'tenant-A')).not.toThrow();
  });
  it('blocks cross-tenant TenantAdmin', () => {
    expect(() =>
      requireOwnTenantOrSystemAdmin(mk({ tenantId: 'tenant-B' }), 'tenant-A'),
    ).toThrow(ForbiddenError);
  });
  it('SystemAdmin bypasses tenant check', () => {
    expect(() =>
      requireOwnTenantOrSystemAdmin(
        mk({ email: 'sysadmin@example.com', tenantId: 'tenant-B' }),
        'tenant-A',
      ),
    ).not.toThrow();
  });
});

describe('requireSystemAdmin', () => {
  it('blocks non-SystemAdmin', () => {
    expect(() => requireSystemAdmin(mk())).toThrow(ForbiddenError);
  });
  it('allows SystemAdmin', () => {
    expect(() =>
      requireSystemAdmin(mk({ email: 'sysadmin@example.com' })),
    ).not.toThrow();
  });
});
