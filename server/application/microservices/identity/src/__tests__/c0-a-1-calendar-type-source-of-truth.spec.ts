/**
 * C0.a.1 — Cross-entity verification: `calendarType` source-of-truth.
 *
 * Locks the S0.2 contract end-to-end across both services that touch
 * the calendar-type concept:
 *
 *   - `SchoolsService.getSchool(...)` response MUST NOT carry
 *     `academicCalendarType`, even when the legacy DDB row does.
 *   - `SchoolsService.getConfiguration(...)` response MUST NOT carry
 *     `academicCalendarType`, even when the legacy config row does.
 *   - `AcademicYearsService.getAcademicYear(...)` response MUST carry
 *     `calendarType` — this is the authoritative source.
 *
 * The per-service spec files already cover the individual mapper drops
 * (see schools.mapper.spec.ts and schools.service.spec.ts §S0.2). This
 * spec is the cross-service handshake: a single test setup proves the
 * two services agree on which entity owns the field.
 *
 * Pilot-agnostic per invariant 13: no pilot-specific names, archetypes,
 * or school identities anywhere in this file.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { SchoolsService } from '../schools/schools.service';
import { AcademicYearsService } from '../academic-years/academic-years.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { AcademicSessionService } from '../schools/academic-session.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';

describe('C0.a.1 — calendarType source-of-truth (cross-service)', () => {
  let schoolsService: SchoolsService;
  let academicYearsService: AcademicYearsService;
  let mockDynamoDBClient: any;

  const ctx: RequestContext = {
    userId: 'admin-user',
    tenantId: 'tenant-c0a1',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt',
  };

  // A legacy School row that STILL carries `academicCalendarType` on disk.
  // Per S0.2 the field is no longer surfaced on responses; the mapper
  // simply stops emitting it. We assert that contract here.
  const legacySchoolRow = {
    tenantId: ctx.tenantId,
    entityKey: 'SCHOOL#school-c0a1',
    entityType: 'SCHOOL',
    schoolId: 'school-c0a1',
    schoolCode: 'SCHC0A1',
    name: 'School Under Test',
    shortName: 'SUT',
    schoolType: 'elementary',
    status: 'active',
    timezone: 'America/Chicago',
    locale: 'en-US',
    academicCalendarType: 'annual', // legacy field still on the row
    calendarSystem: 'gregorian',
    address: { street1: '1 Test Ave', country: 'USA' },
    gsi1pk: 'SCHOOL_CODE#SCHC0A1',
    gsi1sk: `TENANT#${ctx.tenantId}`,
    createdAt: '2026-05-01T00:00:00.000Z',
    createdBy: ctx.userId,
    updatedAt: '2026-05-01T00:00:00.000Z',
    updatedBy: ctx.userId,
    version: 1,
  };

  // A legacy SchoolConfiguration row that ALSO carries the legacy field.
  // S0.2's response strip applies to getConfiguration too.
  const legacyConfigRow = {
    tenantId: ctx.tenantId,
    entityKey: 'SCHOOL#school-c0a1#CONFIG',
    entityType: 'SCHOOL_CONFIG',
    schoolId: 'school-c0a1',
    timezone: 'America/Chicago',
    locale: 'en-US',
    dateFormat: 'YYYY-MM-DD',
    timeFormat: '24h',
    academicCalendarType: 'annual', // legacy field still on the config row
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
  };

  // The authoritative AY row carrying `calendarType: 'semester'`.
  const ayRow = {
    tenantId: ctx.tenantId,
    entityKey: 'SCHOOL#school-c0a1#YEAR#year-c0a1',
    entityType: 'ACADEMIC_YEAR',
    schoolId: 'school-c0a1',
    yearId: 'year-c0a1',
    name: 'AY 2026-2027',
    startDate: '2026-08-01',
    endDate: '2027-05-31',
    status: 'planning',
    isCurrent: false,
    calendarType: 'semester',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    version: 1,
  };

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

    const mockAcademicSessionService = {
      createSession: jest.fn().mockResolvedValue({ academicSessionId: 'sess-c0a1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: IdentityEventsService, useValue: mockEventsService },
        { provide: AcademicSessionService, useValue: mockAcademicSessionService },
        {
          provide: AuditedWriteService,
          useFactory: (db: DynamoDBClientService) => new AuditedWriteService(db),
          inject: [DynamoDBClientService],
        },
        {
          provide: SchoolsService,
          useFactory: (
            db: DynamoDBClientService,
            events: IdentityEventsService,
            audited: AuditedWriteService,
          ) => new SchoolsService(db, events, audited),
          inject: [DynamoDBClientService, IdentityEventsService, AuditedWriteService],
        },
        {
          provide: AcademicYearsService,
          useFactory: (
            db: DynamoDBClientService,
            audited: AuditedWriteService,
            sess: AcademicSessionService,
          ) => new AcademicYearsService(db, audited, sess),
          inject: [DynamoDBClientService, AuditedWriteService, AcademicSessionService],
        },
      ],
    }).compile();

    schoolsService = module.get<SchoolsService>(SchoolsService);
    academicYearsService = module.get<AcademicYearsService>(AcademicYearsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('School response strips academicCalendarType even when the legacy row carries it', async () => {
    mockDynamoDBClient.getItem.mockResolvedValueOnce(legacySchoolRow);

    const response: any = await schoolsService.getSchool('school-c0a1', ctx);

    expect(response).toBeDefined();
    expect(response.schoolId).toBe('school-c0a1');
    expect(response).not.toHaveProperty('academicCalendarType');
  });

  it('SchoolConfiguration response strips academicCalendarType even when the legacy config row carries it', async () => {
    mockDynamoDBClient.getItem
      .mockResolvedValueOnce(legacyConfigRow) // config read
      .mockResolvedValueOnce(legacySchoolRow); // school read (S0.4 calendarSystem read-through)

    const response: any = await schoolsService.getConfiguration('school-c0a1', ctx);

    expect(response).toBeDefined();
    expect(response.schoolId).toBe('school-c0a1');
    expect(response).not.toHaveProperty('academicCalendarType');
  });

  it('AcademicYear response surfaces calendarType — the authoritative source', async () => {
    mockDynamoDBClient.getItem.mockResolvedValueOnce(ayRow);

    const response = await academicYearsService.getAcademicYear(
      'school-c0a1',
      'year-c0a1',
      ctx,
    );

    expect(response).toBeDefined();
    expect(response.yearId).toBe('year-c0a1');
    expect(response.calendarType).toBe('semester');
  });

  it('Cross-service handshake: School strips the field; AY of the same school carries it', async () => {
    // Same tenant, same school, one read of each entity. Asserts both
    // contracts in a single setup so a future regression that flips the
    // ownership (e.g., starts emitting `academicCalendarType` on School
    // responses again) trips this test.
    mockDynamoDBClient.getItem
      .mockResolvedValueOnce(legacySchoolRow) // getSchool
      .mockResolvedValueOnce(ayRow); // getAcademicYear

    const schoolResp: any = await schoolsService.getSchool('school-c0a1', ctx);
    const ayResp = await academicYearsService.getAcademicYear(
      'school-c0a1',
      'year-c0a1',
      ctx,
    );

    expect(schoolResp).not.toHaveProperty('academicCalendarType');
    expect(ayResp.calendarType).toBe('semester');
  });
});
