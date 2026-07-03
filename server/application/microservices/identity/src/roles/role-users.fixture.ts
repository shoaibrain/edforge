/**
 * Role-user fixture (RBAC epic AUD.4a/4b) — the deterministic, reusable set of
 * role assignments the RBAC/ABAC test suite asserts against.
 *
 * Produces, for a tenant + school:
 *   - one single-role user per `SchoolRole` (Principal … Parent),
 *   - a multi-role user (Principal + Teacher — the union-of-permissions case),
 *   - a second-tenant user (the cross-tenant isolation case),
 *   - a parent → student linkage map (plain data, service-agnostic) so
 *     ownership/data-scope tests can resolve "this parent's children".
 *
 * Pure builders (no I/O), so unit tests consume the rows directly against mocked
 * DDB. A live seeder (SEED.2) can layer `putItem` on top of the same rows. IDs
 * are deterministic → re-running yields identical rows (idempotent by construction).
 *
 * Reuses `createRoleAssignment` so the row shape never drifts from production.
 */
import {
  RoleAssignment,
  createRoleAssignment,
} from '../common/entities/role-assignment.entity';
import { SchoolRole } from '../common/entities/base.entity';

export const FIXTURE_TENANT_A = 'tenant-a';
export const FIXTURE_TENANT_B = 'tenant-b';
export const FIXTURE_SCHOOL_A = 'school-a';
export const FIXTURE_ASSIGNED_BY = 'admin-fixture';

/** Every school role, in seniority order (Principal highest → Parent lowest). */
export const FIXTURE_SCHOOL_ROLES: readonly SchoolRole[] = [
  'Principal',
  'VicePrincipal',
  'Teacher',
  'Accountant',
  'Staff',
  'Counselor',
  'Nurse',
  'Student',
  'Parent',
];

/** Deterministic userId for a role within a tenant, so fixtures are stable + idempotent. */
export function fixtureUserId(role: SchoolRole, tenantId: string = FIXTURE_TENANT_A): string {
  return `user-${tenantId}-${role.toLowerCase()}`;
}

export interface RoleUser {
  userId: string;
  tenantId: string;
  schoolId: string;
  /** Primary (highest-seniority) role — mirrors production's `role` field. */
  role: SchoolRole;
  /** Full role set (>1 for the multi-role user). */
  roles: SchoolRole[];
  assignment: RoleAssignment;
}

/**
 * Build a single role-user. `role` is the primary; `extraRoles` (optional) makes
 * it multi-role — the caller passes the highest-seniority role as `role`.
 */
export function buildRoleUser(params: {
  role: SchoolRole;
  extraRoles?: SchoolRole[];
  tenantId?: string;
  schoolId?: string;
  userId?: string;
}): RoleUser {
  const tenantId = params.tenantId ?? FIXTURE_TENANT_A;
  const schoolId = params.schoolId ?? FIXTURE_SCHOOL_A;
  const roles = [params.role, ...(params.extraRoles ?? [])];
  const userId = params.userId ?? fixtureUserId(params.role, tenantId);

  const assignment: RoleAssignment = {
    ...createRoleAssignment(tenantId, userId, schoolId, params.role, FIXTURE_ASSIGNED_BY),
    roles,
  };

  return { userId, tenantId, schoolId, role: params.role, roles, assignment };
}

export interface RoleUserPopulation {
  /** One user per SchoolRole, tenant A / school A. */
  singleRole: RoleUser[];
  /** A Principal + Teacher user (permission-union case), tenant A / school A. */
  multiRole: RoleUser;
  /** A Teacher in tenant B (cross-tenant isolation case). */
  crossTenant: RoleUser;
  /** parentUserId → studentIds they may see (AUD.4b linkage, service-agnostic). */
  parentStudentLinks: Record<string, string[]>;
}

/**
 * Build the full fixture population. Deterministic: same inputs → identical rows.
 */
export function buildRoleUserPopulation(params?: {
  tenantId?: string;
  schoolId?: string;
  secondTenantId?: string;
}): RoleUserPopulation {
  const tenantId = params?.tenantId ?? FIXTURE_TENANT_A;
  const schoolId = params?.schoolId ?? FIXTURE_SCHOOL_A;
  const secondTenantId = params?.secondTenantId ?? FIXTURE_TENANT_B;

  const singleRole = FIXTURE_SCHOOL_ROLES.map((role) => buildRoleUser({ role, tenantId, schoolId }));

  const multiRole = buildRoleUser({
    role: 'Principal',
    extraRoles: ['Teacher'],
    tenantId,
    schoolId,
    userId: `user-${tenantId}-principal-teacher`,
  });

  const crossTenant = buildRoleUser({ role: 'Teacher', tenantId: secondTenantId, schoolId });

  const parentUserId = fixtureUserId('Parent', tenantId);
  const parentStudentLinks: Record<string, string[]> = {
    [parentUserId]: [`student-${tenantId}-1`, `student-${tenantId}-2`],
  };

  return { singleRole, multiRole, crossTenant, parentStudentLinks };
}
