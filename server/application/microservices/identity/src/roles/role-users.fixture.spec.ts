import {
  buildRoleUser,
  buildRoleUserPopulation,
  fixtureUserId,
  FIXTURE_SCHOOL_ROLES,
  FIXTURE_TENANT_A,
  FIXTURE_TENANT_B,
} from './role-users.fixture';

describe('role-users fixture (AUD.4a/4b)', () => {
  it('builds exactly one active assignment per SchoolRole', () => {
    const { singleRole } = buildRoleUserPopulation();
    expect(singleRole).toHaveLength(FIXTURE_SCHOOL_ROLES.length);
    for (const u of singleRole) {
      expect(u.roles).toEqual([u.role]);
      expect(u.assignment.role).toBe(u.role);
      expect(u.assignment.roles).toEqual([u.role]);
      expect(u.assignment.isActive).toBe(true);
      expect(u.assignment.tenantId).toBe(FIXTURE_TENANT_A);
    }
    // no duplicate userIds
    const ids = singleRole.map((u) => u.userId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('builds a multi-role user with Principal primary + [Principal, Teacher]', () => {
    const { multiRole } = buildRoleUserPopulation();
    expect(multiRole.role).toBe('Principal');
    expect(multiRole.roles).toEqual(['Principal', 'Teacher']);
    expect(multiRole.assignment.roles).toEqual(['Principal', 'Teacher']);
  });

  it('builds a second-tenant user for cross-tenant isolation tests', () => {
    const { crossTenant } = buildRoleUserPopulation();
    expect(crossTenant.tenantId).toBe(FIXTURE_TENANT_B);
    expect(crossTenant.role).toBe('Teacher');
    expect(crossTenant.assignment.tenantId).toBe(FIXTURE_TENANT_B);
  });

  it('links the Parent user to their (and only their) students', () => {
    const { parentStudentLinks } = buildRoleUserPopulation();
    const parentId = fixtureUserId('Parent');
    expect(parentStudentLinks[parentId]).toEqual([
      `student-${FIXTURE_TENANT_A}-1`,
      `student-${FIXTURE_TENANT_A}-2`,
    ]);
    // no other user has links
    expect(Object.keys(parentStudentLinks)).toEqual([parentId]);
  });

  it('is idempotent by construction — re-running yields identical userIds/roles', () => {
    const a = buildRoleUserPopulation();
    const b = buildRoleUserPopulation();
    const key = (p: ReturnType<typeof buildRoleUserPopulation>) =>
      p.singleRole.map((u) => `${u.userId}:${u.roles.join('+')}`).join(',') +
      `|multi=${b.multiRole.userId}|cross=${b.crossTenant.userId}`;
    expect(key(a)).toBe(key(b));
  });

  it('scopes deterministic userIds by tenant', () => {
    expect(fixtureUserId('Teacher', FIXTURE_TENANT_A)).toBe('user-tenant-a-teacher');
    expect(fixtureUserId('Teacher', FIXTURE_TENANT_B)).toBe('user-tenant-b-teacher');
  });

  it('lets callers override tenant/school for bespoke scenarios', () => {
    const u = buildRoleUser({ role: 'Teacher', tenantId: 't9', schoolId: 's9' });
    expect(u.assignment.tenantId).toBe('t9');
    expect(u.assignment.schoolId).toBe('s9');
  });
});
