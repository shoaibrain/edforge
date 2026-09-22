/**
 * `SchoolsService.createSchool` — PABSON IEMIS school-code width.
 *
 * CEHRD issues exactly 9 digits, encoding province / district / local level /
 * school. The shared `iemisSchoolCodeSchema` stays a loose 8–10 digit
 * cross-archetype format guard on purpose: Nepal's width is a PABSON rule,
 * and GENERIC — or a future governance body such as CBS or an NGO-run body —
 * must not inherit it. So the exact width is enforced at the service layer,
 * where the archetype is known, beside the existing presence check.
 *
 * Width is load-bearing rather than cosmetic. The 16-digit IEMIS student ID
 * carries the school's 9-digit code, so a school code of any other length
 * cannot produce a well-formed student ID. The field is also immutable, so a
 * bad code can only be undone by deleting the school — which makes create the
 * only place this can be caught.
 *
 * The archetype scoping is the part most likely to be "simplified" later by
 * moving the rule into the shared Zod schema. These cases exist to make that
 * fail loudly.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { BellScheduleService } from './bell-schedule.service';
import { RolesService } from '../roles/roles.service';
import type { CreateSchoolDto, SchoolType } from '@aibrains/shared-types';
import type { RequestContext } from '../common/entities/base.entity';

const ctx = {
  tenantId: 'tenant-1',
  userId: 'user-1',
  jwtToken: 'jwt',
  globalRole: 'TenantAdmin',
  username: 'admin',
} as unknown as RequestContext;

function dto(emisSchoolCode?: string): CreateSchoolDto {
  return {
    schoolCode: 'WID',
    name: 'Width Test School',
    schoolType: 'high' as SchoolType,
    gradeRange: { start: '9', end: '10' },
    address: { street1: '1 Test St', country: 'NPL' },
    timezone: 'Asia/Kathmandu',
    locale: 'ne-NP',
    academicCalendarType: 'annual',
    ...(emisSchoolCode ? { emisSchoolCode } : {}),
  } as CreateSchoolDto;
}

async function build(archetype: string) {
  const mockDynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    // Cross-tenant IEMIS-code collision check runs under the SYSTEM client.
    getSystemClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn().mockResolvedValue({ archetype }),
    putItem: jest.fn().mockResolvedValue(undefined),
    query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    queryGSI: jest.fn().mockResolvedValue({ items: [] }),
  };
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
      {
        // Publishes are fire-and-forget (`.catch()` on the returned value),
        // so these must resolve rather than return undefined — the same
        // Lambda-freeze pattern tracked in #459 / #482.
        provide: IdentityEventsService,
        useValue: {
          publishSchoolCreated: jest.fn().mockResolvedValue(undefined),
          publishSchoolUpdated: jest.fn().mockResolvedValue(undefined),
        },
      },
      { provide: AuditedWriteService, useValue: { write: jest.fn() } },
      { provide: BellScheduleService, useValue: { applyPreset: jest.fn().mockResolvedValue(undefined) } },
      { provide: RolesService, useValue: { getUserRoles: jest.fn().mockResolvedValue({ schoolRoles: [] }) } },
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
  return { service: module.get<SchoolsService>(SchoolsService), mockDynamoDBClient };
}

describe('createSchool — PABSON IEMIS school-code width', () => {
  describe('PABSON', () => {
    it('accepts a 9-digit CEHRD code', async () => {
      const { service } = await build('PABSON');
      await expect(service.createSchool(dto('310123450'), ctx)).resolves.toBeDefined();
    });

    it('refuses 8 digits', async () => {
      const { service } = await build('PABSON');
      await expect(service.createSchool(dto('31012345'), ctx)).rejects.toThrow(BadRequestException);
    });

    it('refuses 10 digits — the shape already sitting in a live tenant', async () => {
      const { service } = await build('PABSON');
      await expect(service.createSchool(dto('1780796330'), ctx)).rejects.toThrow(BadRequestException);
    });

    it('refuses a 9-character code that is not all digits', async () => {
      const { service } = await build('PABSON');
      await expect(service.createSchool(dto('3101234A0'), ctx)).rejects.toThrow(BadRequestException);
    });

    it('rejects before any write — a bad code is immutable once persisted', async () => {
      const { service, mockDynamoDBClient } = await build('PABSON');
      await expect(service.createSchool(dto('31012345'), ctx)).rejects.toThrow(BadRequestException);
      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('reports a distinct error code from the missing-code case', async () => {
      // The wizard highlights a different field state for "absent" vs
      // "present but malformed"; collapsing them would lose that.
      const { service } = await build('PABSON');
      await service.createSchool(dto('31012345'), ctx).catch((e: any) => {
        expect(e.response?.errorCode).toBe('EMIS_CODE_INVALID_WIDTH');
      });
      await service.createSchool(dto(undefined), ctx).catch((e: any) => {
        expect(e.response?.errorCode).toBe('EMIS_CODE_REQUIRED');
      });
      expect.assertions(2);
    });
  });

  describe('archetype scoping — Nepal\'s width must not leak', () => {
    it('GENERIC accepts an 8-digit code', async () => {
      // If this ever fails, the rule has been moved into the shared Zod
      // schema and every non-PABSON archetype has inherited Nepal's format.
      const { service } = await build('GENERIC');
      await expect(service.createSchool(dto('31012345'), ctx)).resolves.toBeDefined();
    });

    it('GENERIC accepts a 10-digit code', async () => {
      const { service } = await build('GENERIC');
      await expect(service.createSchool(dto('1780796330'), ctx)).resolves.toBeDefined();
    });

    it('GENERIC accepts no code at all', async () => {
      const { service } = await build('GENERIC');
      await expect(service.createSchool(dto(undefined), ctx)).resolves.toBeDefined();
    });

    it('an unrecognized archetype falls soft rather than inheriting the PABSON rule', async () => {
      // Matches the existing fail-soft-to-GENERIC behaviour for a typo'd or
      // pre-archetype tenant row: it must not start rejecting school creates.
      const { service } = await build('NOT_A_REAL_ARCHETYPE');
      await expect(service.createSchool(dto('31012345'), ctx)).resolves.toBeDefined();
    });
  });
});
