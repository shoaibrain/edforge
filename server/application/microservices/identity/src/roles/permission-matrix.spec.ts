/**
 * Permission-matrix characterization + security invariants.
 *
 * Drives the REAL `RolesService.checkPermission` decision engine across every
 * SchoolRole × every registry resource × every registry action, with a mocked
 * DDB returning a single active role assignment. Two purposes:
 *
 *   1. SNAPSHOT — the full backend-ENFORCED matrix is snapshotted so any drift
 *      in DEFAULT_ROLE_PERMISSIONS or the engine is caught + consciously
 *      reviewed. This snapshot is the ground-truth map to compare against the
 *      Security Policies UI / product intent (they are NOT guaranteed equal —
 *      see the Principal grades:delete invariant below).
 *
 *   2. SECURITY INVARIANTS — explicit allow/deny assertions that encode product
 *      intent independent of the matrix data, so a dangerous loosening (e.g.
 *      Teacher gains billing, Parent gains grade-edit) fails the build.
 *
 * NOTE: global role TenantAdmin BYPASSES this engine entirely (returns allow
 * before any matrix check). Every test here uses a TenantUser context so the
 * school-role matrix is actually exercised — the path that, prior to this spec,
 * had no exhaustive coverage.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { RolesService } from './roles.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { PERMISSION_REGISTRY } from '../common/constants/permission-registry';
import type { RequestContext, SchoolRole } from '../common/entities/base.entity';
import type { CheckPermissionDto } from '@aibrains/shared-types';

const SCHOOL_ROLES: SchoolRole[] = [
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

const mockClient = { send: jest.fn() };
const mockDynamoDBClient = {
  getClient: jest.fn().mockResolvedValue(mockClient),
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  query: jest.fn(),
};

const userContext: RequestContext = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  globalRole: 'TenantUser',
  jwtToken: 'mock-jwt',
  email: 'user@test.edu',
};

function roleRow(role: SchoolRole) {
  return {
    tenantId: 'tenant-1',
    userId: 'user-1',
    schoolId: 'school-1',
    role,
    roles: [role],
    isActive: true,
    entityType: 'ROLE_ASSIGNMENT',
    entityKey: 'USER#user-1#ROLE#school-1',
    assignedAt: '2024-01-01T00:00:00.000Z',
    assignedBy: 'admin-user',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'admin-user',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'admin-user',
    version: 1,
  };
}

describe('RolesService — permission matrix', () => {
  let service: RolesService;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockDynamoDBClient.getClient.mockResolvedValue(mockClient);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RolesService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: IdentityEventsService, useValue: {} },
      ],
    }).compile();

    service = module.get<RolesService>(RolesService);
  });

  /** Run the real engine for a single (role, resource, action) cell. */
  async function permits(role: SchoolRole, resource: string, action: string): Promise<boolean> {
    mockDynamoDBClient.getItem.mockResolvedValue(roleRow(role));
    // The runtime engine is string-based (matchesPermission). CheckPermissionDto's
    // `action` is a narrow 8-value union that can't express the registry's broader
    // vocabulary (portal `grades`, `school`, `finance`, `configure`, …) — itself a
    // finding — so we assert to the DTO's action type to exercise every cell.
    const res = await service.checkPermission(
      { resource, action: action as CheckPermissionDto['action'], schoolId: 'school-1' },
      userContext,
    );
    return res.allowed === true;
  }

  /** Assert every role in `roles` is DENIED (resource, action). */
  async function expectAllDenied(roles: SchoolRole[], resource: string, action: string) {
    for (const role of roles) {
      expect([role, resource, action, await permits(role, resource, action)]).toEqual([
        role,
        resource,
        action,
        false,
      ]);
    }
  }

  // ---------------------------------------------------------------------------
  // 1. Full backend-enforced matrix — snapshot (the ground-truth map)
  // ---------------------------------------------------------------------------
  it('snapshots the full backend-enforced matrix (compare vs Security Policies UI / intent)', async () => {
    const header = ['resource:action', ...SCHOOL_ROLES].join(' | ');
    const rows: string[] = [header, '---'];
    for (const def of PERMISSION_REGISTRY) {
      for (const action of def.actions) {
        const cells: string[] = [`${def.resource}:${action}`];
        for (const role of SCHOOL_ROLES) {
          cells.push((await permits(role, def.resource, action)) ? '✓' : '✗');
        }
        rows.push(cells.join(' | '));
      }
    }
    expect(rows.join('\n')).toMatchSnapshot();
  });

  // ---------------------------------------------------------------------------
  // 2. Security invariants — explicit intent, independent of the matrix data
  // ---------------------------------------------------------------------------
  describe('security invariants', () => {
    it('TenantAdmin bypasses the engine entirely (allow regardless of school role)', async () => {
      const res = await service.checkPermission(
        { resource: 'students', action: 'delete', schoolId: 'school-1' },
        { ...userContext, globalRole: 'TenantAdmin' },
      );
      expect(res.allowed).toBe(true);
    });

    it('Student and Parent cannot write (create/edit/delete) academic records', async () => {
      const academic = ['grades', 'attendance', 'students', 'courses', 'enrollment'];
      for (const resource of academic) {
        for (const action of ['create', 'edit', 'delete']) {
          // only assert against actions the registry actually defines for the resource
          const def = PERMISSION_REGISTRY.find((d) => d.resource === resource);
          if (!def?.actions.includes(action)) continue;
          await expectAllDenied(['Student', 'Parent'], resource, action);
        }
      }
    });

    it('Teacher has no finance access at all', async () => {
      for (const def of PERMISSION_REGISTRY.filter((d) => d.category === 'finance')) {
        for (const action of def.actions) {
          await expectAllDenied(['Teacher'], def.resource, action);
        }
      }
    });

    it('Accountant cannot touch academic records (grades/attendance edit, student edit/delete)', async () => {
      expect(await permits('Accountant', 'grades', 'edit')).toBe(false);
      expect(await permits('Accountant', 'attendance', 'edit')).toBe(false);
      expect(await permits('Accountant', 'students', 'edit')).toBe(false);
      expect(await permits('Accountant', 'students', 'delete')).toBe(false);
    });

    it('only Principal may delete a student (destructive)', async () => {
      for (const role of SCHOOL_ROLES) {
        expect([role, await permits(role, 'students', 'delete')]).toEqual([role, role === 'Principal']);
      }
    });

    it('no school role may manage system settings (TenantAdmin-only)', async () => {
      await expectAllDenied(SCHOOL_ROLES, 'settings', 'manage');
    });

    it("Parent's only write capability is billing:create", async () => {
      expect(await permits('Parent', 'billing', 'create')).toBe(true);
      expect(await permits('Parent', 'billing', 'edit')).toBe(false);
      expect(await permits('Parent', 'billing', 'delete')).toBe(false);
      expect(await permits('Parent', 'billing', 'manage')).toBe(false);
      expect(await permits('Parent', 'grades', 'edit')).toBe(false);
    });

    it('Teacher write scope is limited to grades + attendance', async () => {
      expect(await permits('Teacher', 'grades', 'edit')).toBe(true);
      expect(await permits('Teacher', 'attendance', 'create')).toBe(true);
      expect(await permits('Teacher', 'students', 'edit')).toBe(false);
      expect(await permits('Teacher', 'courses', 'edit')).toBe(false);
      expect(await permits('Teacher', 'enrollment', 'create')).toBe(false);
    });

    it('Nurse is confined to health-records (full) + student view', async () => {
      expect(await permits('Nurse', 'health-records', 'manage')).toBe(true);
      expect(await permits('Nurse', 'students', 'view')).toBe(true);
      expect(await permits('Nurse', 'grades', 'view')).toBe(false);
      expect(await permits('Nurse', 'attendance', 'view')).toBe(false);
      expect(await permits('Nurse', 'billing', 'view')).toBe(false);
    });

    it('Counselor is confined to special-programs (full) + student/schedule view', async () => {
      expect(await permits('Counselor', 'special-programs', 'manage')).toBe(true);
      expect(await permits('Counselor', 'students', 'view')).toBe(true);
      expect(await permits('Counselor', 'scheduling', 'view')).toBe(true);
      expect(await permits('Counselor', 'grades', 'edit')).toBe(false);
      expect(await permits('Counselor', 'billing', 'view')).toBe(false);
    });

    // -------------------------------------------------------------------------
    // KNOWN DISCREPANCY (finding, not a desired state):
    // The Security Policies UI screenshot shows Principal → Grades → Delete ✗
    // and Attendance → Delete ✗. The BACKEND grants Principal `grades:*` and
    // `attendance:*`, so the engine ALLOWS those deletes. This pins the actual
    // backend behavior and flags the UI/backend matrix mismatch to reconcile
    // (frontend packages/abac vs backend DEFAULT_ROLE_PERMISSIONS).
    // -------------------------------------------------------------------------
    it('FINDING: backend grants Principal grades/attendance delete (UI shows ✗)', async () => {
      expect(await permits('Principal', 'grades', 'delete')).toBe(true);
      expect(await permits('Principal', 'attendance', 'delete')).toBe(true);
    });
  });
});
