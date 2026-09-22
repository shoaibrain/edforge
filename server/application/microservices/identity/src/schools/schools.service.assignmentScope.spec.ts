/**
 * `SchoolsService` — #484 role-assignment scoping on school reads.
 *
 * `GET /schools`, `GET /schools/:schoolId` and `.../configuration` were
 * tenant-scoped only. In a multi-school tenant that meant any authenticated
 * principal — verified on production with a Parent and a Student account —
 * received every school in the tenant, including each one's government IEMIS
 * school code, address, phone and contact email.
 *
 * Settled rule: `TenantAdmin` is tenant-wide; every other principal sees only
 * schools they hold an active role assignment at. Deliberately narrow — if a
 * business case for cross-school non-admin visibility appears, it gets built
 * then, against a real requirement.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { BellScheduleService } from './bell-schedule.service';
import { RolesService } from '../roles/roles.service';

const TENANT = 'tenant-1';
const ASSIGNED = 'school-assigned';
const OTHER_A = 'school-other-a';
const OTHER_B = 'school-other-b';

function school(schoolId: string, name: string) {
  return {
    schoolId,
    name,
    entityType: 'SCHOOL',
    tenantId: TENANT,
    // The field that made this a disclosure rather than a nuisance.
    emisSchoolCode: `${schoolId}-emis`,
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

const ALL_SCHOOLS = [school(ASSIGNED, 'Assigned School'), school(OTHER_A, 'Other A'), school(OTHER_B, 'Other B')];

function ctx(globalRole: 'TenantAdmin' | 'TenantUser', userId = 'user-1') {
  return { userId, tenantId: TENANT, email: 'u@example.test', globalRole, jwtToken: 'jwt' } as any;
}

async function buildService(schoolRoles: Array<{ schoolId: string }>) {
  const mockDynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    query: jest.fn().mockResolvedValue({ items: ALL_SCHOOLS, lastEvaluatedKey: undefined }),
    getItem: jest.fn(async (_c: any, _t: string, key: string) => {
      const match = ALL_SCHOOLS.find(s => key.includes(s.schoolId));
      if (key.includes('CONFIG')) return match ? { schoolId: match.schoolId, entityType: 'SCHOOL_CONFIG' } : null;
      return match ?? null;
    }),
    putItem: jest.fn().mockResolvedValue(undefined),
  };
  const mockRolesService: any = {
    getUserRoles: jest.fn().mockResolvedValue({ userId: 'user-1', globalRole: 'TenantUser', schoolRoles }),
  };

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
      { provide: IdentityEventsService, useValue: { publishSchoolCreated: jest.fn(), publishSchoolUpdated: jest.fn() } },
      { provide: AuditedWriteService, useValue: { write: jest.fn() } },
      { provide: BellScheduleService, useValue: { applyPreset: jest.fn() } },
      { provide: RolesService, useValue: mockRolesService },
      {
        provide: SchoolsService,
        useFactory: (
          db: DynamoDBClientService,
          ev: IdentityEventsService,
          aw: AuditedWriteService,
          bs: BellScheduleService,
          rs: RolesService,
        ) => new SchoolsService(db, ev, aw, bs, rs),
        inject: [DynamoDBClientService, IdentityEventsService, AuditedWriteService, BellScheduleService, RolesService],
      },
    ],
  }).compile();

  return {
    service: module.get<SchoolsService>(SchoolsService),
    mockRolesService,
    mockDynamoDBClient,
  };
}

describe('SchoolsService — assignment scoping on reads (#484)', () => {
  describe('listSchools', () => {
    it('returns only the schools a non-admin principal is assigned to', async () => {
      const { service } = await buildService([{ schoolId: ASSIGNED }]);
      const result = await service.listSchools(ctx('TenantUser'), 50);

      expect(result.items.map(s => s.schoolId)).toEqual([ASSIGNED]);
    });

    it('never leaks another school\'s government IEMIS code to a non-admin', async () => {
      // The concrete disclosure this issue was filed on.
      const { service } = await buildService([{ schoolId: ASSIGNED }]);
      const result = await service.listSchools(ctx('TenantUser'), 50);

      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(`${OTHER_A}-emis`);
      expect(serialized).not.toContain(`${OTHER_B}-emis`);
    });

    it('returns every school for a TenantAdmin', async () => {
      const { service, mockRolesService } = await buildService([]);
      const result = await service.listSchools(ctx('TenantAdmin'), 50);

      expect(result.items).toHaveLength(3);
      // Tenant-wide short-circuits: no assignment lookup is even issued.
      expect(mockRolesService.getUserRoles).not.toHaveBeenCalled();
    });

    it('returns nothing for a principal with no assignments', async () => {
      const { service } = await buildService([]);
      const result = await service.listSchools(ctx('TenantUser'), 50);

      expect(result.items).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it('scopes before paginating, so hasMore describes only visible rows', async () => {
      // With limit 2 over 3 tenant schools, an unscoped list reports
      // hasMore:true. Scoped to one assignment it must not — otherwise the
      // count itself discloses that other schools exist.
      const { service } = await buildService([{ schoolId: ASSIGNED }]);
      const result = await service.listSchools(ctx('TenantUser'), 2);

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });

    it('honours multiple assignments', async () => {
      const { service } = await buildService([{ schoolId: ASSIGNED }, { schoolId: OTHER_B }]);
      const result = await service.listSchools(ctx('TenantUser'), 50);

      expect(result.items.map(s => s.schoolId).sort()).toEqual([ASSIGNED, OTHER_B].sort());
    });
  });

  describe('getSchool', () => {
    it('allows a school the principal is assigned to', async () => {
      const { service } = await buildService([{ schoolId: ASSIGNED }]);
      await expect(service.getSchool(ASSIGNED, ctx('TenantUser'))).resolves.toMatchObject({
        schoolId: ASSIGNED,
      });
    });

    it('refuses a school the principal is not assigned to', async () => {
      // Scoping the listing alone would leave this open, and an id is not a
      // secret — anyone who called the old listing kept them permanently.
      const { service } = await buildService([{ schoolId: ASSIGNED }]);
      await expect(service.getSchool(OTHER_A, ctx('TenantUser'))).rejects.toThrow(ForbiddenException);
    });

    it('allows a TenantAdmin any school', async () => {
      const { service } = await buildService([]);
      await expect(service.getSchool(OTHER_A, ctx('TenantAdmin'))).resolves.toMatchObject({
        schoolId: OTHER_A,
      });
    });
  });

  describe('getConfiguration', () => {
    it('refuses configuration for an unassigned school', async () => {
      const { service } = await buildService([{ schoolId: ASSIGNED }]);
      await expect(service.getConfiguration(OTHER_A, ctx('TenantUser'))).rejects.toThrow(ForbiddenException);
    });

    it('allows configuration for an assigned school', async () => {
      const { service } = await buildService([{ schoolId: ASSIGNED }]);
      await expect(service.getConfiguration(ASSIGNED, ctx('TenantUser'))).resolves.toBeDefined();
    });
  });

  describe('denial happens before the read', () => {
    it('does not fetch the school row when access is refused', async () => {
      // A denial that still reads the row would put the record into logs and
      // traces it has no business in.
      const { service, mockDynamoDBClient } = await buildService([{ schoolId: ASSIGNED }]);
      await expect(service.getSchool(OTHER_A, ctx('TenantUser'))).rejects.toThrow(ForbiddenException);

      const fetchedOther = mockDynamoDBClient.getItem.mock.calls.some((c: any[]) =>
        String(c[2]).includes(OTHER_A),
      );
      expect(fetchedOther).toBe(false);
    });
  });
});
