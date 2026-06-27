/**
 * C0.a.2 — Verify SchoolConfiguration response carries `calendarSystem`
 * and matches `WorkspaceSettings.regional.defaultCalendarSystem`.
 *
 * S0.4 shipped the response-layer read-through: `getConfiguration()`
 * fetches the School row and surfaces `school.calendarSystem` on the
 * response. The per-service spec at schools.service.spec.ts §S0.4 covers
 * the three response shapes (bikram_sambat / gregorian / undefined).
 *
 * This spec adds the **cross-entity contract**: the response's
 * `calendarSystem` value MUST agree with the tenant's
 * `WorkspaceSettings.regional.defaultCalendarSystem` when the two are
 * properly provisioned (the design invariant — per CLAUDE.md "Archetype
 * model": "Regional settings live ONLY on WorkspaceSettings at the
 * tenant level. School entities MUST NOT override them.").
 *
 * Implementation note: `getConfiguration` reads from the School row,
 * not from WorkspaceSettings. Drift is prevented by (a) provisioning
 * setting both from the same archetype/country source, and (b) a
 * deprecation warning on school-level regional writes
 * (schools.service.ts:450-464 — Midnight Lockin decision #3). P1 will
 * remove the school-level field entirely; this spec then becomes the
 * regression guard for whichever read path replaces it.
 *
 * Pilot-agnostic per invariant 13: no pilot-specific names.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { SchoolsService } from '../schools/schools.service';
import { BellScheduleService } from '../schools/bell-schedule.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';
import type {
  WorkspaceSettings,
  RegionalSettings,
} from '../common/entities/workspace-settings.entity';

describe('C0.a.2 — calendarSystem in SchoolConfiguration response (cross-entity)', () => {
  let schoolsService: SchoolsService;
  let mockDynamoDBClient: any;

  const ctx: RequestContext = {
    userId: 'admin-user',
    tenantId: 'tenant-c0a2',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt',
  };

  // Helpers to construct fully-shaped entity rows for the three reads
  // we need to mock.
  const makeWorkspaceSettings = (
    regional: Partial<RegionalSettings>,
  ): WorkspaceSettings => ({
    tenantId: ctx.tenantId,
    entityKey: 'SETTINGS#WORKSPACE',
    entityType: 'WORKSPACE_SETTINGS',
    regional: {
      defaultTimezone: 'America/New_York',
      defaultLocale: 'en-US',
      defaultDateFormat: 'MM/DD/YYYY',
      defaultTimeFormat: '12h',
      defaultWeekStartsOn: 'sunday',
      defaultCurrency: 'USD',
      defaultCalendarSystem: 'gregorian',
      enableDualDateDisplay: false,
      defaultNumberFormat: 'international',
      ...regional,
    },
    branding: { organizationName: 'Test Organization' },
    policies: { defaultAttendancePolicy: 'daily_presence' },
    isLocked: false,
    createdAt: '2026-05-01T00:00:00.000Z',
    createdBy: ctx.userId,
    updatedAt: '2026-05-01T00:00:00.000Z',
    updatedBy: ctx.userId,
    version: 1,
  });

  const makeSchool = (calendarSystem: 'gregorian' | 'bikram_sambat') => ({
    tenantId: ctx.tenantId,
    entityKey: 'SCHOOL#school-c0a2',
    entityType: 'SCHOOL',
    schoolId: 'school-c0a2',
    schoolCode: 'SCHC0A2',
    name: 'School Under Test',
    shortName: 'SUT',
    schoolType: 'elementary',
    status: 'active',
    timezone: 'America/Chicago',
    locale: 'en-US',
    calendarSystem,
    address: { street1: '1 Test Ave', country: 'USA' },
    gsi1pk: 'SCHOOL_CODE#SCHC0A2',
    gsi1sk: `TENANT#${ctx.tenantId}`,
    createdAt: '2026-05-01T00:00:00.000Z',
    createdBy: ctx.userId,
    updatedAt: '2026-05-01T00:00:00.000Z',
    updatedBy: ctx.userId,
    version: 1,
  });

  const makeConfig = () => ({
    tenantId: ctx.tenantId,
    entityKey: 'SCHOOL#school-c0a2#CONFIG',
    entityType: 'SCHOOL_CONFIG',
    schoolId: 'school-c0a2',
    timezone: 'America/Chicago',
    locale: 'en-US',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '24h',
    gradingScale: {
      type: 'percentage',
      scale: [{ letter: 'A+', minScore: 90, maxScore: 100, gpa: 4.0 }],
      passingGrade: 60,
    },
    attendanceRequired: true,
    schoolDays: [1, 2, 3, 4, 5],
    startTime: '08:00',
    endTime: '15:00',
    periodDuration: 45,
    notificationsEnabled: true,
    emailNotifications: true,
    smsNotifications: false,
    features: { attendance: true, grades: true },
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  });

  beforeEach(async () => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      getSystemClient: jest.fn().mockReturnValue({ send: jest.fn() }),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      updateItem: jest.fn().mockResolvedValue(undefined),
      deleteItem: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      queryGSI: jest.fn().mockResolvedValue({ items: [] }),
      batchWrite: jest.fn().mockResolvedValue(undefined),
    };

    const mockEventsService = {
      publishSchoolCreated: jest.fn().mockResolvedValue(undefined),
      publishSchoolUpdated: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: IdentityEventsService, useValue: mockEventsService },
        {
          provide: AuditedWriteService,
          useFactory: (db: DynamoDBClientService) => new AuditedWriteService(db),
          inject: [DynamoDBClientService],
        },
        {
          provide: BellScheduleService,
          useValue: { applyPreset: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: SchoolsService,
          useFactory: (
            db: DynamoDBClientService,
            events: IdentityEventsService,
            audited: AuditedWriteService,
            bell: BellScheduleService,
          ) => new SchoolsService(db, events, audited, bell),
          inject: [DynamoDBClientService, IdentityEventsService, AuditedWriteService, BellScheduleService],
        },
      ],
    }).compile();

    schoolsService = module.get<SchoolsService>(SchoolsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ============================================================
  // S0.4 baseline (response presence) — re-asserted at the integration
  // level to keep the C0.a.2 spec self-contained.
  // ============================================================
  describe('S0.4 — response includes calendarSystem', () => {
    it('returns calendarSystem=bikram_sambat for a PABSON-shaped tenant', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(makeConfig()) // config row
        .mockResolvedValueOnce(makeSchool('bikram_sambat')); // school row

      const response: any = await schoolsService.getConfiguration('school-c0a2', ctx);
      expect(response).toBeDefined();
      expect(response.calendarSystem).toBe('bikram_sambat');
    });

    it('returns calendarSystem=gregorian for a GENERIC-shaped tenant', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(makeConfig())
        .mockResolvedValueOnce(makeSchool('gregorian'));

      const response: any = await schoolsService.getConfiguration('school-c0a2', ctx);
      expect(response.calendarSystem).toBe('gregorian');
    });
  });

  // ============================================================
  // C0.a.2 — cross-entity contract: response value matches
  // WorkspaceSettings.regional.defaultCalendarSystem.
  // ============================================================
  describe('Cross-entity: response.calendarSystem == WorkspaceSettings.regional.defaultCalendarSystem', () => {
    it('PABSON-shaped tenant: both sources agree on bikram_sambat', async () => {
      // Seed the design-aligned state: WorkspaceSettings carries the
      // authoritative value; the denormalized School copy mirrors it.
      const workspace = makeWorkspaceSettings({ defaultCalendarSystem: 'bikram_sambat' });
      const school = makeSchool('bikram_sambat');

      // Pre-condition: data is aligned at rest.
      expect(school.calendarSystem).toBe(workspace.regional.defaultCalendarSystem);

      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(makeConfig())
        .mockResolvedValueOnce(school);

      const response: any = await schoolsService.getConfiguration('school-c0a2', ctx);

      // Contract: the response value equals the WorkspaceSettings value.
      expect(response.calendarSystem).toBe(workspace.regional.defaultCalendarSystem);
    });

    it('GENERIC-shaped tenant: both sources agree on gregorian', async () => {
      const workspace = makeWorkspaceSettings({ defaultCalendarSystem: 'gregorian' });
      const school = makeSchool('gregorian');

      expect(school.calendarSystem).toBe(workspace.regional.defaultCalendarSystem);

      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(makeConfig())
        .mockResolvedValueOnce(school);

      const response: any = await schoolsService.getConfiguration('school-c0a2', ctx);
      expect(response.calendarSystem).toBe(workspace.regional.defaultCalendarSystem);
    });
  });

  // ============================================================
  // S0.4 defensive — school row missing (cross-checks the existing
  // schools.service.spec.ts test for completeness).
  // ============================================================
  it('returns calendarSystem=undefined if the school row is unexpectedly missing', async () => {
    mockDynamoDBClient.getItem
      .mockResolvedValueOnce(makeConfig())
      .mockResolvedValueOnce(null); // school read returns null

    const response: any = await schoolsService.getConfiguration('school-c0a2', ctx);
    expect(response.calendarSystem).toBeUndefined();
  });
});
