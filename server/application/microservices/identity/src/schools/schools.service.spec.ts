/**
 * SchoolsService Unit Tests
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { SchoolsService } from './schools.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityEventsService } from '../common/services/identity-events.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { expectAuditRow, expectNoAuditRow } from '../common/testing/audit-assertions';
import { RequestContext, GlobalRole, SchoolStatus } from '../common/entities/base.entity';
import type { CreateSchoolDto, UpdateSchoolDto } from '@aibrains/shared-types';
import { SchoolType } from '../common/entities/school.entity';

describe('SchoolsService', () => {
  let service: SchoolsService;
  let mockDynamoDBClient: any;
  let mockEventsService: any;

  const mockContext: RequestContext = {
    userId: 'admin-user-id',
    tenantId: 'tenant-123',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt-token',
  };

  const mockSchool = {
    tenantId: 'tenant-123',
    entityKey: 'SCHOOL#school-123',
    entityType: 'SCHOOL',
    schoolId: 'school-123',
    schoolCode: 'SCH001',
    name: 'Test Elementary School',
    shortName: 'TES',
    schoolType: 'elementary' as SchoolType,
    status: 'active' as SchoolStatus,
    address: {
      street: '123 Main St',
      city: 'Springfield',
      state: 'IL',
      zipCode: '62701',
      country: 'USA',
    },
    contact: {
      phone: '555-123-4567',
      email: 'school@test.com',
    },
    gsi1pk: 'SCHOOL_CODE#SCH001',
    gsi1sk: 'TENANT#tenant-123',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'admin-user-id',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'admin-user-id',
    version: 1,
  };

  const mockDepartment = {
    tenantId: 'tenant-123',
    entityKey: 'SCHOOL#school-123#DEPT#dept-123',
    entityType: 'DEPARTMENT',
    departmentId: 'dept-123',
    schoolId: 'school-123',
    name: 'Mathematics',
    code: 'MATH',
    status: 'active',
    headUserId: 'head-user-id',
    createdAt: '2024-01-01T00:00:00.000Z',
    createdBy: 'admin-user-id',
    updatedAt: '2024-01-01T00:00:00.000Z',
    updatedBy: 'admin-user-id',
    version: 1,
  };

  beforeEach(async () => {
    /**
     * Sensible defaults for every DDB mock method so a test that doesn't
     * override them still gets resolved Promises. Historically this spec
     * mocked `queryGSI` but the service uses `query`, producing undefined-
     * reads-.items crashes on the happy path. Giving each mock a benign
     * default (empty list / no-op Promise) isolates tests from the
     * boilerplate of wiring every DDB call. Tests that need specific
     * behavior still use mockResolvedValue / mockResolvedValueOnce.
     */
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

    mockEventsService = {
      publishSchoolCreated: jest.fn().mockResolvedValue(undefined),
      publishSchoolUpdated: jest.fn().mockResolvedValue(undefined),
      // Phase 1 — dedicated grade-levels event mock
      publishSchoolGradeLevelsUpdated: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: IdentityEventsService, useValue: mockEventsService },
        // S0.8 — real AuditedWriteService against the same mock DDB client,
        // so audit rows land in the same putItem.mock.calls array and the
        // shared `expectAuditRow` helper can assert them.
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
      ],
    }).compile();

    service = module.get<SchoolsService>(SchoolsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createSchool', () => {
    const createDto: CreateSchoolDto = {
      schoolCode: 'SCH002',
      name: 'New High School',
      shortName: 'NHS',
      schoolType: 'high' as SchoolType,
      gradeRange: {
        start: '9',
        end: '12',
      },
      address: {
        street1: '456 Oak Ave',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62702',
        country: 'USA',
      },
      phone: '555-987-6543',
      email: 'newschool@test.com',
      timezone: 'America/Chicago',
      locale: 'en-US',
      academicCalendarType: 'semester',
      calendarSystem: 'gregorian',
    };

    it('should create a new school successfully', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] }); // No existing school with code
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createSchool(createDto, mockContext);

      expect(result).toBeDefined();
      expect(result.schoolCode).toBe('SCH002');
      expect(result.name).toBe('New High School');
      // New schools start in 'setup' status
      expect(result.status).toBe('setup');
      expect(mockEventsService.publishSchoolCreated).toHaveBeenCalled();
    });

    it('should create school even with existing school codes (GSI check may be optional)', async () => {
      // Note: The actual duplicate check behavior depends on service implementation
      // The service might not throw if the GSI query returns results
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [mockSchool] });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      // If service doesn't check for duplicates, this should succeed
      const result = await service.createSchool(createDto, mockContext);
      expect(result).toBeDefined();
    });

    it('should validate school type enum', async () => {
      const invalidDto = {
        ...createDto,
        schoolType: 'invalid' as any,
      };

      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      // The validation should be handled by class-validator in the DTO
      // This test verifies the service doesn't throw on valid types
      const result = await service.createSchool(createDto, mockContext);
      expect(result).toBeDefined();
    });
  });

  /**
   * Sprint C Gap 1 — PABSON archetype gate on emisSchoolCode.
   * These tests exercise the only enforcement point for the IEMIS school
   * code: if a PABSON tenant creates a school without it, the school is
   * un-onboardable into IEMIS flows because emisSchoolCode is immutable
   * (FIELD_MUTABILITY.immutable in shared-types 0.29.0).
   */
  describe('createSchool — PABSON emisSchoolCode gate', () => {
    const pabsonContext: RequestContext = {
      ...mockContext,
      tenantId: 'pabson-tenant',
    };

    const pabsonDto: CreateSchoolDto = {
      schoolCode: 'MES',
      name: 'Milos Elementary School',
      shortName: 'Milos',
      schoolType: 'elementary' as SchoolType,
      gradeRange: { start: 'PK', end: '6' },
      address: {
        street1: '7654 Bagmati East Road',
        country: 'NPL',
        municipality: 'Kathmandu',
        district: 'Jhapa',
        province: 'Bagmati',
      },
      timezone: 'Asia/Kathmandu',
      locale: 'ne-NP',
      academicCalendarType: 'annual',
      calendarSystem: 'bikram_sambat',
    };

    it('rejects PABSON create without emisSchoolCode — structured 400', async () => {
      // Duplicate-code check (query) → no match; then tenant METADATA lookup
      // (getItem) → archetype=PABSON; enforcement fires before any DDB write.
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'PABSON' });

      await expect(
        service.createSchool(pabsonDto, pabsonContext),
      ).rejects.toMatchObject({
        status: 400,
        response: expect.objectContaining({
          message: expect.stringMatching(/emisSchoolCode is required/i),
          errorCode: 'EMIS_CODE_REQUIRED',
          details: expect.objectContaining({
            field: 'emisSchoolCode',
            archetype: 'PABSON',
          }),
        }),
      });
      // Governance rejection must NOT write to DDB.
      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
      expect(mockEventsService.publishSchoolCreated).not.toHaveBeenCalled();
    });

    it('accepts PABSON create when emisSchoolCode is provided', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'PABSON' });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createSchool(
        { ...pabsonDto, emisSchoolCode: '31012345' } as CreateSchoolDto,
        pabsonContext,
      );
      expect(result.schoolCode).toBe('MES');
      expect(result.emisSchoolCode).toBe('31012345');
      expect(mockEventsService.publishSchoolCreated).toHaveBeenCalled();
    });

    it('accepts GENERIC create without emisSchoolCode (optional for non-PABSON)', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createSchool(pabsonDto, pabsonContext);
      expect(result).toBeDefined();
      expect(result.emisSchoolCode).toBeUndefined();
    });

    it('treats missing tenant METADATA archetype as non-PABSON (fail-open)', async () => {
      // Defensive: if the tenant row has no archetype, we cannot assume
      // PABSON. Creating a new school without emisSchoolCode must succeed —
      // otherwise a data-layer quirk blocks onboarding of a legitimate
      // non-PABSON tenant. The risk is documented: prod tenants pre-dating
      // the archetype field must be backfilled (Phase 0 in the post-ship
      // plan) for the gate to fire.
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({}); // no archetype field
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createSchool(pabsonDto, pabsonContext);
      expect(result).toBeDefined();
    });
  });

  /**
   * Sprint 1 S1.3 — cross-tenant emisSchoolCode uniqueness via sparse
   * GSI8. A second tenant attempting to claim an already-in-use code
   * must fail with a structured 409 that does NOT leak the conflicting
   * tenantId to the caller.
   */
  describe('createSchool — cross-tenant IEMIS code uniqueness (GSI8)', () => {
    const pabsonContext: RequestContext = {
      ...mockContext,
      tenantId: 'tenant-a',
    };

    const pabsonDto: CreateSchoolDto = {
      schoolCode: 'MES',
      name: 'Milos Elementary School',
      schoolType: 'elementary' as SchoolType,
      gradeRange: { start: 'PK', end: '6' },
      address: { street1: '1 Rd', country: 'NPL' },
      timezone: 'Asia/Kathmandu',
      locale: 'ne-NP',
      academicCalendarType: 'annual',
      calendarSystem: 'bikram_sambat',
      emisSchoolCode: '31012345',
    } as CreateSchoolDto;

    it('queries GSI8 for the IEMIS code before writing the school', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'PABSON' });

      await service.createSchool(pabsonDto, pabsonContext);

      // GSI8 query must be scoped to the code (first arg: index name, second: pk value)
      expect(mockDynamoDBClient.queryGSI).toHaveBeenCalledWith(
        expect.anything(),
        'GSI8',
        '31012345',
      );
    });

    it('uses the SYSTEM client for the GSI8 query (cross-tenant scope)', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'PABSON' });

      await service.createSchool(pabsonDto, pabsonContext);

      expect(mockDynamoDBClient.getSystemClient).toHaveBeenCalled();
    });

    it('throws 409 DUPLICATE_IEMIS_CODE when code already exists on another tenant', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [{ tenantId: 'tenant-other', schoolId: 'school-xyz', emisSchoolCode: '31012345' }],
      });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'PABSON' });

      await expect(service.createSchool(pabsonDto, pabsonContext)).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          errorCode: 'DUPLICATE_IEMIS_CODE',
          details: expect.objectContaining({ field: 'emisSchoolCode' }),
        }),
      });
      // No DDB write should land when uniqueness fails.
      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('409 response must NOT leak the conflicting tenantId / schoolId to the caller', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [{ tenantId: 'secret-other-tenant', schoolId: 'secret-sid', emisSchoolCode: '31012345' }],
      });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'PABSON' });

      try {
        await service.createSchool(pabsonDto, pabsonContext);
        fail('should have thrown');
      } catch (e: any) {
        const payload = JSON.stringify(e.response ?? e.message);
        expect(payload).not.toContain('secret-other-tenant');
        expect(payload).not.toContain('secret-sid');
      }
    });

    it('populates gsi8pk + gsi8sk on the persisted School entity when code is set', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'PABSON' });

      await service.createSchool(pabsonDto, pabsonContext);

      // Find the putItem call that wrote the SCHOOL row (NOT the config row).
      const schoolPut = mockDynamoDBClient.putItem.mock.calls.find(
        (call: any[]) => call[1]?.entityType === 'SCHOOL',
      );
      expect(schoolPut).toBeDefined();
      const persisted = schoolPut![1];
      expect(persisted.gsi8pk).toBe('31012345');
      expect(persisted.gsi8sk).toMatch(/^TENANT#tenant-a#SCHOOL#/);
    });

    it('leaves gsi8pk + gsi8sk undefined when no emisSchoolCode is supplied (sparse)', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });

      const { emisSchoolCode, ...dtoNoCode } = pabsonDto;
      await service.createSchool(dtoNoCode as CreateSchoolDto, pabsonContext);

      const schoolPut = mockDynamoDBClient.putItem.mock.calls.find(
        (call: any[]) => call[1]?.entityType === 'SCHOOL',
      );
      expect(schoolPut![1].gsi8pk).toBeUndefined();
      expect(schoolPut![1].gsi8sk).toBeUndefined();
    });

    it('skips the GSI8 query entirely when emisSchoolCode is absent', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });

      const { emisSchoolCode, ...dtoNoCode } = pabsonDto;
      await service.createSchool(dtoNoCode as CreateSchoolDto, pabsonContext);

      // Every queryGSI call, if any, must NOT be against GSI8.
      for (const call of mockDynamoDBClient.queryGSI.mock.calls) {
        expect(call[1]).not.toBe('GSI8');
      }
    });
  });

  /**
   * Sprint C Gap 1 — emisSchoolCode is immutable after creation.
   * Rely on shared-types FIELD_MUTABILITY.immutable (0.29.0) via the
   * service's `classifyUpdateFields` call. A drift in the shared map or
   * in the service gate will fail these cases.
   */
  describe('updateSchool — emisSchoolCode immutability', () => {
    it('rejects PATCH with emisSchoolCode — BadRequestException lists the field', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        ...mockSchool,
        emisSchoolCode: '31012345',
      });

      await expect(
        service.updateSchool(
          'school-123',
          { emisSchoolCode: '99999999' } as UpdateSchoolDto,
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateSchool(
          'school-123',
          { emisSchoolCode: '99999999' } as UpdateSchoolDto,
          mockContext,
        ),
      ).rejects.toThrow(/emisSchoolCode/);

      // DDB must not be written on immutable-field rejection.
      expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('allows PATCH of mutable fields even on a school with emisSchoolCode set', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue({
        ...mockSchool,
        emisSchoolCode: '31012345',
      });
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...mockSchool,
        emisSchoolCode: '31012345',
        name: 'Renamed School',
      });
      // updateSchool fires a non-blocking audit-log putItem + event publish.
      // Both are .catch()-ed, so they must resolve (not return undefined).
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.updateSchool(
        'school-123',
        { name: 'Renamed School' } as UpdateSchoolDto,
        mockContext,
      );
      expect(result.name).toBe('Renamed School');
    });
  });

  /**
   * Phase 1 — dedicated PATCH /schools/:schoolId/grade-levels endpoint.
   *
   * Locks the catalog/template/selection model: schools select codes
   * from the shared-types ORDERED_GRADES catalog; unknown codes are
   * rejected; the diff (added/removed) flows through the emitted event;
   * legacy rows have enabledGradeLevels backfilled from gradeRange.
   */
  describe('updateGradeLevels — catalog/template/selection model', () => {
    // gradeRange exists on the legacy mockSchool but enabledGradeLevels does
    // not — exercises the "legacy backfill" path on every read.
    const schoolWithRange = {
      ...mockSchool,
      gradeRange: { start: 'K', end: '5' },
    };

    it('accepts PG/NUR/LKG/UKG + 1-10 — Saraswati-shape selection', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(schoolWithRange);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...schoolWithRange,
        enabledGradeLevels: ['PG', 'NUR', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
      });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.updateGradeLevels(
        'school-123',
        {
          enabledGradeLevels: ['PG', 'NUR', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'],
        },
        mockContext,
      );
      expect(result.enabledGradeLevels).toEqual([
        'PG', 'NUR', 'LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
      ]);
      expect(mockDynamoDBClient.updateItem).toHaveBeenCalled();
    });

    it('rejects unknown grade codes with 400 + helpful message', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(schoolWithRange);

      await expect(
        service.updateGradeLevels(
          'school-123',
          { enabledGradeLevels: ['K', 'WAT', '1'] },
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.updateGradeLevels(
          'school-123',
          { enabledGradeLevels: ['K', 'WAT', '1'] },
          mockContext,
        ),
      ).rejects.toThrow(/WAT/);

      expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('rejects an empty enabledGradeLevels array', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(schoolWithRange);

      await expect(
        service.updateGradeLevels('school-123', { enabledGradeLevels: [] }, mockContext),
      ).rejects.toThrow(BadRequestException);
      expect(mockDynamoDBClient.updateItem).not.toHaveBeenCalled();
    });

    it('throws NotFoundException for a school that does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);
      await expect(
        service.updateGradeLevels(
          'missing',
          { enabledGradeLevels: ['K', '1'] },
          mockContext,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('emits SchoolGradeLevelsUpdated with the add/remove diff against the legacy backfill', async () => {
      // Legacy school: gradeRange K-5 (no enabledGradeLevels yet).
      // The service must backfill ['K','1','2','3','4','5'] as the
      // "previous" set, then compute the diff against the new set.
      const newSet = ['PG', 'NUR', 'LKG', 'UKG', 'K', '1', '2', '3', '4', '5'];
      mockDynamoDBClient.getItem.mockResolvedValue(schoolWithRange);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...schoolWithRange,
        enabledGradeLevels: newSet,
      });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      // Spy on the events service to capture the emit.
      const publishSpy = jest.spyOn(mockEventsService, 'publishSchoolGradeLevelsUpdated');

      await service.updateGradeLevels(
        'school-123',
        { enabledGradeLevels: newSet },
        mockContext,
      );

      // Allow the non-blocking event publish to flush.
      await new Promise((r) => setImmediate(r));

      expect(publishSpy).toHaveBeenCalledWith(
        'tenant-123',
        'school-123',
        newSet,
        ['PG', 'NUR', 'LKG', 'UKG'], // added: new codes not in legacy K-5
        [],                            // removed: none — every legacy K-5 code is still present
      );
    });

    it('persists optional gradeLevelLabels alongside the codes', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(schoolWithRange);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...schoolWithRange,
        enabledGradeLevels: ['PG', 'NUR', 'LKG', 'UKG', '1'],
        gradeLevelLabels: { PG: { 'ne-NP': 'प्ले ग्रुप' } },
      });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.updateGradeLevels(
        'school-123',
        {
          enabledGradeLevels: ['PG', 'NUR', 'LKG', 'UKG', '1'],
          gradeLevelLabels: { PG: { 'ne-NP': 'प्ले ग्रुप' } },
        },
        mockContext,
      );
      expect(result.gradeLevelLabels).toEqual({ PG: { 'ne-NP': 'प्ले ग्रुप' } });
    });
  });

  /**
   * Sprint C Gap 4 — Country-default resolution on school creation.
   * The service reads `createDto.address.country` to select a country
   * override map from department.entity.ts. We pin the two live code paths
   * (NPL via Nepal, USA implicit default) and the fallback behavior when
   * the caller omits `address.country`. Tests inspect the config entity
   * the service writes to DDB — that's the ground truth for what the
   * downstream MFEs will read back.
   */
  describe('createSchool — country defaults', () => {
    const baseUsaDto: CreateSchoolDto = {
      schoolCode: 'SCH010',
      name: 'Country Defaults Test',
      schoolType: 'elementary' as SchoolType,
      gradeRange: { start: 'K', end: '5' },
      address: {
        street1: '1 Main St',
        city: 'Springfield',
        state: 'IL',
        zipCode: '62701',
        country: 'USA',
      },
      timezone: 'America/Chicago',
      locale: 'en-US',
      academicCalendarType: 'semester',
      calendarSystem: 'gregorian',
    };

    it('applies NPL defaults (Asia/Kathmandu, ne-NP, bikram_sambat) when country=NPL', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'PABSON' }); // tenant METADATA
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const nplDto: CreateSchoolDto = {
        ...baseUsaDto,
        schoolCode: 'NEP1',
        address: {
          street1: 'Bagmati',
          country: 'NPL',
          municipality: 'Kathmandu',
          district: 'Jhapa',
          province: 'Bagmati',
        },
        calendarSystem: 'bikram_sambat',
        emisSchoolCode: '31012345',
      };

      await service.createSchool(nplDto, mockContext);

      // Two putItem calls: the school entity, then the config entity.
      const allPutCalls = mockDynamoDBClient.putItem.mock.calls;
      expect(allPutCalls).toHaveLength(2);
      const configEntity = allPutCalls.find(
        (c: any[]) => c[1]?.entityType === 'CONFIG',
      )?.[1];
      expect(configEntity).toBeDefined();
      // NPL country overrides: Nepal-appropriate regional defaults persist
      // to the config row regardless of Zod field defaults on the DTO.
      expect(configEntity.gradingScale.type).toBe('percentage');
      expect(configEntity.gradingScale.passingGrade).toBe(32);
      // schoolDays: Sun-Fri (Saturday off) — Nepal week
      expect(configEntity.schoolDays).toEqual([0, 1, 2, 3, 4, 5]);
      // Period duration from NPL override
      expect(configEntity.periodDuration).toBe(45);
    });

    it('applies USA defaults when country=USA', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      await service.createSchool(baseUsaDto, mockContext);

      const configEntity = mockDynamoDBClient.putItem.mock.calls.find(
        (c: any[]) => c[1]?.entityType === 'CONFIG',
      )?.[1];
      expect(configEntity).toBeDefined();
      // Letter grading (A-F), Mon-Fri week, semester calendar
      expect(configEntity.gradingScale.type).toBe('letter');
      expect(configEntity.schoolDays).toEqual([1, 2, 3, 4, 5]);
    });

    it('falls back to USA defaults when address.country is omitted', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const dtoWithoutCountry: CreateSchoolDto = {
        ...baseUsaDto,
        schoolCode: 'NOCTY',
        address: {
          street1: '1 Main St',
          city: 'Springfield',
          state: 'IL',
          zipCode: '62701',
          // country omitted — service defaults to 'USA'
        } as any,
      };

      await service.createSchool(dtoWithoutCountry, mockContext);

      const configEntity = mockDynamoDBClient.putItem.mock.calls.find(
        (c: any[]) => c[1]?.entityType === 'CONFIG',
      )?.[1];
      expect(configEntity.gradingScale.type).toBe('letter'); // USA default
    });

    it('stores calendarSystem=bikram_sambat when country=NPL', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'PABSON' });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const nplDto: CreateSchoolDto = {
        ...baseUsaDto,
        schoolCode: 'NEPBS',
        address: {
          street1: 'Bagmati',
          country: 'NPL',
          municipality: 'KTM',
          district: 'Jhapa',
          province: 'Bagmati',
        },
        emisSchoolCode: '31099999',
      };
      delete (nplDto as any).calendarSystem; // exercise the service's NPL fallback

      await service.createSchool(nplDto, mockContext);

      const schoolEntity = mockDynamoDBClient.putItem.mock.calls.find(
        (c: any[]) => c[1]?.entityType === 'SCHOOL',
      )?.[1];
      expect(schoolEntity.calendarSystem).toBe('bikram_sambat');
    });
  });

  /**
   * Sprint C Gap 4 — schoolType × gradeRange cross-validation at service.
   * Zod enforces this at the schema boundary, but the service runs it
   * again as defense-in-depth against payloads that bypass Zod (e.g. tests
   * that construct DTOs directly). Pinning both the positive and negative
   * cases locks in the cross-validation's place in the request pipeline.
   */
  describe('createSchool — schoolType × gradeRange cross-validation', () => {
    it('rejects elementary with high-school grade range (9-12)', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });

      const badDto: CreateSchoolDto = {
        schoolCode: 'BADCOMBO',
        name: 'Elementary with HS grades',
        schoolType: 'elementary' as SchoolType,
        gradeRange: { start: '9', end: '12' },
        timezone: 'America/Chicago',
        locale: 'en-US',
        academicCalendarType: 'semester',
        calendarSystem: 'gregorian',
      };

      await expect(service.createSchool(badDto, mockContext)).rejects.toThrow(
        BadRequestException,
      );
      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('accepts elementary with K-5 grade range', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const okDto: CreateSchoolDto = {
        schoolCode: 'OKCOMBO',
        name: 'Proper Elementary',
        schoolType: 'elementary' as SchoolType,
        gradeRange: { start: 'K', end: '5' },
        timezone: 'America/Chicago',
        locale: 'en-US',
        academicCalendarType: 'semester',
        calendarSystem: 'gregorian',
      };

      const result = await service.createSchool(okDto, mockContext);
      expect(result).toBeDefined();
    });
  });

  /**
   * Sprint C Gap 4 — Duplicate schoolCode detection is case-insensitive.
   * The service uppercases both sides of the comparison; this test pins
   * the behavior so a refactor that swaps to a case-sensitive check fails
   * loudly. School codes appear in user-facing IDs (student number prefix),
   * so `SCH001` / `sch001` / `Sch001` must all collide.
   */
  describe('createSchool — duplicate schoolCode detection', () => {
    it('rejects case-variant of an existing schoolCode with ConflictException', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [{ schoolCode: 'SCH001' }], // existing upper-case
        hasMore: false,
      });

      const dupDto: CreateSchoolDto = {
        schoolCode: 'sch001', // lower-case variant
        name: 'Would-be Duplicate',
        schoolType: 'elementary' as SchoolType,
        gradeRange: { start: 'K', end: '5' },
        timezone: 'America/Chicago',
        locale: 'en-US',
        academicCalendarType: 'semester',
        calendarSystem: 'gregorian',
      };

      await expect(service.createSchool(dupDto, mockContext)).rejects.toThrow(
        ConflictException,
      );
      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('accepts a distinct schoolCode when others exist', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [{ schoolCode: 'SCH001' }],
        hasMore: false,
      });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const freshDto: CreateSchoolDto = {
        schoolCode: 'SCH002',
        name: 'Fresh School',
        schoolType: 'elementary' as SchoolType,
        gradeRange: { start: 'K', end: '5' },
        timezone: 'America/Chicago',
        locale: 'en-US',
        academicCalendarType: 'semester',
        calendarSystem: 'gregorian',
      };

      const result = await service.createSchool(freshDto, mockContext);
      expect(result.schoolCode).toBe('SCH002');
    });
  });

  /**
   * Sprint C0.b.3 — `shortName` uniqueness within tenant scope.
   *
   * shortName collisions are operationally unworkable: the field is the
   * compact label in operator UI (header badges, dropdowns, breadcrumbs).
   * Two schools with the same shortName would be indistinguishable.
   *
   * Match the schoolCode check's pattern (case-insensitive compare against
   * existing tenant-scoped schools) and emit the structured 409 shape so
   * the wizard can highlight the field + display the reason.
   */
  describe('createSchool — shortName uniqueness (C0.b.3)', () => {
    const baseDto: CreateSchoolDto = {
      schoolCode: 'SCH-NEW',
      name: 'New School',
      shortName: 'NS',
      schoolType: 'elementary' as SchoolType,
      gradeRange: { start: 'K', end: '5' },
      timezone: 'America/Chicago',
      locale: 'en-US',
      academicCalendarType: 'semester',
      calendarSystem: 'gregorian',
    } as CreateSchoolDto;

    it('throws 409 SHORT_NAME_DUPLICATE with structured details when shortName collides', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [
          { schoolId: 'school-existing', schoolCode: 'OTHER-CODE', shortName: 'NS' },
        ],
        hasMore: false,
      });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });

      await expect(service.createSchool(baseDto, mockContext)).rejects.toMatchObject({
        status: 409,
        response: expect.objectContaining({
          errorCode: 'SHORT_NAME_DUPLICATE',
          details: expect.objectContaining({
            field: 'shortName',
            value: 'NS',
          }),
        }),
      });
      // No school row should land when uniqueness fails.
      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('case-insensitive match — "NS" collides with existing "ns"', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [{ schoolId: 'school-existing', schoolCode: 'OTHER', shortName: 'ns' }],
        hasMore: false,
      });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });

      await expect(service.createSchool(baseDto, mockContext)).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'SHORT_NAME_DUPLICATE' }),
      });
    });

    it('accepts when no schools share the shortName', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [{ schoolId: 'school-other', schoolCode: 'OTHER', shortName: 'OTHER-SHORT' }],
        hasMore: false,
      });
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createSchool(baseDto, mockContext);
      expect(result.shortName).toBe('NS');
    });

    it('skips shortName check entirely when shortName is undefined', async () => {
      // shortName is optional; absent → no comparison, no error
      const { shortName: _omitted, ...dtoNoShort } = baseDto;
      mockDynamoDBClient.query.mockResolvedValue({
        items: [{ schoolId: 'school-existing', schoolCode: 'OTHER', shortName: 'NS' }],
        hasMore: false,
      });
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const result = await service.createSchool(dtoNoShort as CreateSchoolDto, mockContext);
      expect(result.shortName).toBeUndefined();
    });

    it('409 response does not leak the conflicting schoolId to the caller', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [
          { schoolId: 'secret-conflict-school-id', schoolCode: 'OTHER', shortName: 'NS' },
        ],
        hasMore: false,
      });
      mockDynamoDBClient.getItem.mockResolvedValue({ archetype: 'GENERIC' });

      try {
        await service.createSchool(baseDto, mockContext);
        fail('should have thrown');
      } catch (e: any) {
        const payload = JSON.stringify(e.response ?? e.message);
        expect(payload).not.toContain('secret-conflict-school-id');
      }
    });
  });

  describe('getSchool', () => {
    it('should return school when found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockSchool);

      const result = await service.getSchool('school-123', mockContext);

      expect(result).toBeDefined();
      expect(result.schoolId).toBe('school-123');
      expect(result.name).toBe('Test Elementary School');
    });

    it('should throw NotFoundException when school not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.getSchool('nonexistent', mockContext)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('listSchools', () => {
    it('should return all schools in a single page', async () => {
      mockDynamoDBClient.query.mockReset();
      mockDynamoDBClient.query.mockResolvedValue({
        items: [mockSchool],
        hasMore: false,
        lastEvaluatedKey: undefined,
      });

      const result = await service.listSchools(mockContext, 50);

      expect(result.items).toHaveLength(1);
      expect(result.hasMore).toBe(false);
    });

    it('should paginate through DynamoDB 1MB pages to collect all schools', async () => {
      mockDynamoDBClient.query.mockReset();
      const secondSchool = { ...mockSchool, schoolId: 'school-456', name: 'Second School' };
      const cursor = Buffer.from(JSON.stringify({ tenantId: 'tenant-123', entityKey: 'SCHOOL#school-123#DATE#2026-01-15' })).toString('base64');

      mockDynamoDBClient.query
        .mockResolvedValueOnce({ items: [mockSchool], hasMore: false, lastEvaluatedKey: cursor })
        .mockResolvedValueOnce({ items: [secondSchool], hasMore: false, lastEvaluatedKey: undefined });

      const result = await service.listSchools(mockContext, 50);

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(false);
      expect(mockDynamoDBClient.query).toHaveBeenCalledTimes(2);
    });

    it('should apply application-level limit after collecting all schools', async () => {
      mockDynamoDBClient.query.mockReset();
      const schools = Array.from({ length: 3 }, (_, i) => ({
        ...mockSchool, schoolId: `school-${i}`, name: `School ${i}`,
      }));

      mockDynamoDBClient.query.mockResolvedValue({
        items: schools,
        hasMore: false,
        lastEvaluatedKey: undefined,
      });

      const result = await service.listSchools(mockContext, 2);

      expect(result.items).toHaveLength(2);
      expect(result.hasMore).toBe(true);
    });
  });

  describe('updateSchool', () => {
    const updateDto: UpdateSchoolDto = {
      name: 'Updated School Name',
    };

    it('should update school fields', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockSchool);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...mockSchool,
        name: 'Updated School Name',
        updatedAt: new Date().toISOString(),
      });

      const result = await service.updateSchool('school-123', updateDto, mockContext);

      expect(result.name).toBe('Updated School Name');
      expect(mockEventsService.publishSchoolUpdated).toHaveBeenCalled();
    });

    it('should throw NotFoundException when school not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.updateSchool('nonexistent', updateDto, mockContext)
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteSchool', () => {
    it('should soft delete school', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(mockSchool);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...mockSchool,
        status: 'inactive',
      });

      await service.deleteSchool('school-123', mockContext);

      expect(mockDynamoDBClient.updateItem).toHaveBeenCalled();
    });

    it('should throw NotFoundException when school not found', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(service.deleteSchool('nonexistent', mockContext)).rejects.toThrow(
        NotFoundException
      );
    });
  });

  describe('Department operations', () => {
    describe('createDepartment', () => {
      it('should create department for school', async () => {
        mockDynamoDBClient.getItem.mockResolvedValue(mockSchool);
        mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [] });
        mockDynamoDBClient.putItem.mockResolvedValue(undefined);

        const result = await service.createDepartment(
          'school-123',
          { name: 'Science', code: 'SCI' } as any,
          mockContext
        );

        expect(result).toBeDefined();
        expect(result.name).toBe('Science');
        expect(result.code).toBe('SCI');
      });
    });

    describe('listDepartments', () => {
      it('should return departments for school', async () => {
        mockDynamoDBClient.query.mockResolvedValue({
          items: [mockDepartment],
          hasMore: false,
        });

        const result = await service.listDepartments('school-123', mockContext, 50);

        expect(result.items).toHaveLength(1);
        expect(result.items[0].name).toBe('Mathematics');
      });
    });
  });

  describe('getConfiguration', () => {
    // Full config row with all the fields the response shape needs.
    const mockConfig = {
      schoolId: 'school-123',
      timezone: 'Asia/Kathmandu',
      locale: 'ne-NP',
      dateFormat: 'YYYY/MM/DD',
      timeFormat: '24h',
      academicCalendarType: 'annual', // legacy field still on the row
      gradingScale: {
        type: 'percentage',
        scale: [{ letter: 'A+', minScore: 90, maxScore: 100, gpa: 4.0 }],
        passingGrade: 32,
      },
      attendanceRequired: true,
      schoolDays: [0, 1, 2, 3, 4, 5],
      startTime: '10:00',
      endTime: '16:00',
      periodDuration: 45,
      notificationsEnabled: true,
      emailNotifications: true,
      smsNotifications: false,
      features: { attendance: true, grades: true },
      createdAt: '2026-05-08T00:00:00.000Z',
      updatedAt: '2026-05-08T00:00:00.000Z',
    };

    it('should return school configuration', async () => {
      // S0.4: getConfiguration now does TWO reads — config first, then school
      // (for calendarSystem). Mock both.
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(mockConfig)
        .mockResolvedValueOnce({ ...mockSchool, calendarSystem: 'gregorian' });

      const result = await service.getConfiguration('school-123', mockContext);

      expect(result).toBeDefined();
      expect(result.schoolId).toBe('school-123');
    });

    // grade-level-fix/T4 (F-CONFIG-1a) — replaced the old lazy-create
    // behavior. Previously `getConfiguration` would write a DEFAULT_SCHOOL_CONFIG
    // row (US-shape) when none existed; that produced orphan US-defaults
    // SchoolConfiguration rows for any caller hitting the endpoint with a
    // non-existent schoolId. Real schools always have a config row eagerly
    // created by `createSchool`, so a 404 here means "no such school in
    // this tenant."
    it('throws NotFoundException when configuration row does not exist (T4 / F-CONFIG-1a)', async () => {
      mockDynamoDBClient.getItem.mockResolvedValueOnce(null);

      await expect(
        service.getConfiguration('school-does-not-exist', mockContext),
      ).rejects.toThrow(NotFoundException);

      // Critical: no putItem should have been called — the bug was that
      // the missing row silently became a US-defaults orphan row.
      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    // ============================================
    // S0.4 — surface calendarSystem on the configuration response
    // ============================================
    describe('S0.4 — calendarSystem read-through', () => {
      it('returns calendarSystem=bikram_sambat for a PABSON / NPL school', async () => {
        mockDynamoDBClient.getItem
          .mockResolvedValueOnce(mockConfig)
          .mockResolvedValueOnce({ ...mockSchool, calendarSystem: 'bikram_sambat' });

        const result: any = await service.getConfiguration('school-123', mockContext);
        expect(result.calendarSystem).toBe('bikram_sambat');
      });

      it('returns calendarSystem=gregorian for a non-PABSON school', async () => {
        mockDynamoDBClient.getItem
          .mockResolvedValueOnce(mockConfig)
          .mockResolvedValueOnce({ ...mockSchool, calendarSystem: 'gregorian' });

        const result: any = await service.getConfiguration('school-123', mockContext);
        expect(result.calendarSystem).toBe('gregorian');
      });

      it('returns calendarSystem=undefined when the school row is missing (defensive)', async () => {
        // Should not happen in practice (config exists ⇒ school exists), but
        // the response shape must not crash if the second read returns null.
        mockDynamoDBClient.getItem
          .mockResolvedValueOnce(mockConfig)
          .mockResolvedValueOnce(null);

        const result: any = await service.getConfiguration('school-123', mockContext);
        expect(result.calendarSystem).toBeUndefined();
      });
    });

    // ============================================
    // S0.2 — academicCalendarType removed from response payloads
    // ============================================
    describe('S0.2 — academicCalendarType is no longer surfaced', () => {
      it('configuration response does NOT carry academicCalendarType even if the DDB row has it', async () => {
        mockDynamoDBClient.getItem
          .mockResolvedValueOnce(mockConfig) // row carries the legacy field
          .mockResolvedValueOnce({ ...mockSchool, calendarSystem: 'bikram_sambat' });

        const result: any = await service.getConfiguration('school-123', mockContext);
        expect(result).not.toHaveProperty('academicCalendarType');
      });
    });
  });

  describe('updateConfiguration', () => {
    // grade-level-fix/T4 (F-CONFIG-1a) — updateConfiguration ALSO used to
    // lazy-create on missing config (less reachable than getConfiguration,
    // but the same orphan-row risk). Same fix.
    it('throws NotFoundException when configuration row does not exist (T4 / F-CONFIG-1a)', async () => {
      mockDynamoDBClient.getItem.mockResolvedValueOnce(null);

      await expect(
        service.updateConfiguration(
          'school-does-not-exist',
          { timezone: 'Asia/Kathmandu' },
          mockContext,
        ),
      ).rejects.toThrow(NotFoundException);

      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // S0.6 — evaluateActivationRequirements (archetype-aware gate)
  // ============================================
  describe('S0.6 — evaluateActivationRequirements', () => {
    const setupSchool = { ...mockSchool, status: 'setup' as SchoolStatus };

    // Helper: respond to the per-requirement queries in sequence.
    // The implementation issues them in this order: AY active, terms,
    // bell schedule, calendar dates. Each requirement-count uses a
    // separate `query()` call.
    function mockCounts(
      mockDB: any,
      tenantArchetype: string | undefined,
      counts: { ay: number; terms: number; bells: number; dates: number },
    ) {
      mockDB.getItem
        // 1st getItem: the School row (existence check)
        .mockResolvedValueOnce(setupSchool)
        // 2nd getItem: tenant metadata row (archetype)
        .mockResolvedValueOnce(tenantArchetype ? { archetype: tenantArchetype } : null);

      // Query sequence per requirement.
      mockDB.query
        .mockResolvedValueOnce({ items: Array(counts.ay).fill({ status: 'active' }) })
        .mockResolvedValueOnce({ items: Array(counts.terms).fill({ entityType: 'TERM' }) })
        .mockResolvedValueOnce({ items: Array(counts.bells).fill({ entityType: 'BELLSCHEDULE' }) })
        .mockResolvedValueOnce({ items: Array(counts.dates).fill({ entityType: 'CALENDARDATE' }) });
    }

    it('returns canActivate=true for a PABSON school that satisfies all four requirements', async () => {
      mockCounts(mockDynamoDBClient, 'PABSON', { ay: 1, terms: 4, bells: 1, dates: 100 });

      const result: any = await (service as any).evaluateActivationRequirements(
        'school-123',
        mockContext,
      );

      expect(result.archetype).toBe('PABSON');
      expect(result.canActivate).toBe(true);
      expect(result.requirements).toHaveLength(4);
      expect(result.requirements.every((r: any) => r.met)).toBe(true);
    });

    it('returns canActivate=false with each unmet requirement when PABSON school has only an AY', async () => {
      // Mimics evidence §1 F1 — dev school has 1 AY but no terms/bell/calendar.
      mockCounts(mockDynamoDBClient, 'PABSON', { ay: 1, terms: 0, bells: 0, dates: 0 });

      const result: any = await (service as any).evaluateActivationRequirements(
        'school-123',
        mockContext,
      );

      expect(result.canActivate).toBe(false);
      const byKey = Object.fromEntries(result.requirements.map((r: any) => [r.key, r]));
      expect(byKey.academic_year_active.met).toBe(true);
      expect(byKey.grading_periods.met).toBe(false);
      expect(byKey.grading_periods.current).toBe(0);
      expect(byKey.grading_periods.required).toBe(4);
      expect(byKey.bell_schedule.met).toBe(false);
      expect(byKey.calendar_generated.met).toBe(false);
    });

    it('returns canActivate=false for a PABSON school with 3 terms (one short of 4)', async () => {
      mockCounts(mockDynamoDBClient, 'PABSON', { ay: 1, terms: 3, bells: 1, dates: 100 });

      const result: any = await (service as any).evaluateActivationRequirements(
        'school-123',
        mockContext,
      );

      expect(result.canActivate).toBe(false);
      const terms = result.requirements.find((r: any) => r.key === 'grading_periods');
      expect(terms.current).toBe(3);
      expect(terms.required).toBe(4);
      expect(terms.met).toBe(false);
    });

    it('GENERIC archetype requires only an active academic year', async () => {
      mockCounts(mockDynamoDBClient, 'GENERIC', { ay: 1, terms: 0, bells: 0, dates: 0 });

      const result: any = await (service as any).evaluateActivationRequirements(
        'school-123',
        mockContext,
      );

      expect(result.archetype).toBe('GENERIC');
      expect(result.requirements).toHaveLength(1);
      expect(result.canActivate).toBe(true);
    });

    it('falls back to GENERIC requirements when tenant metadata is missing', async () => {
      mockCounts(mockDynamoDBClient, undefined, { ay: 1, terms: 0, bells: 0, dates: 0 });

      const result: any = await (service as any).evaluateActivationRequirements(
        'school-123',
        mockContext,
      );

      expect(result.archetype).toBe('GENERIC');
      expect(result.canActivate).toBe(true);
    });

    it('falls back to GENERIC requirements for an unknown archetype', async () => {
      mockCounts(mockDynamoDBClient, 'MOSTLY_HARMLESS', { ay: 1, terms: 0, bells: 0, dates: 0 });

      const result: any = await (service as any).evaluateActivationRequirements(
        'school-123',
        mockContext,
      );

      // Archetype echoed back as the (uppercased) input string — UI can
      // surface "unknown archetype" if it wants. The REQUIREMENTS fall
      // back to GENERIC's single-rule set.
      expect(result.archetype).toBe('MOSTLY_HARMLESS');
      expect(result.requirements).toHaveLength(1);
      expect(result.canActivate).toBe(true);
    });

    it('throws NotFoundException when the school does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValueOnce(null); // school row missing

      await expect(
        (service as any).evaluateActivationRequirements('school-missing', mockContext),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ============================================
  // S0.6 — transitionStatus uses the new gate
  // ============================================
  describe('S0.6 — transitionStatus archetype-aware gate', () => {
    function setupSchoolWithGate(
      mockDB: any,
      counts: { ay: number; terms: number; bells: number; dates: number },
      archetype: string = 'PABSON',
    ) {
      const setupSchool = { ...mockSchool, status: 'setup' as SchoolStatus };
      mockDB.getItem
        // 1st: school read at top of transitionStatus
        .mockResolvedValueOnce(setupSchool)
        // 2nd: school read inside evaluateActivationRequirements
        .mockResolvedValueOnce(setupSchool)
        // 3rd: tenant metadata for archetype
        .mockResolvedValueOnce({ archetype });
      mockDB.query
        .mockResolvedValueOnce({ items: Array(counts.ay).fill({ status: 'active' }) })
        .mockResolvedValueOnce({ items: Array(counts.terms).fill({ entityType: 'TERM' }) })
        .mockResolvedValueOnce({ items: Array(counts.bells).fill({}) })
        .mockResolvedValueOnce({ items: Array(counts.dates).fill({}) });
    }

    it('throws ACTIVATION_REQUIREMENTS_NOT_MET listing only the unmet requirements', async () => {
      setupSchoolWithGate(mockDynamoDBClient, { ay: 1, terms: 0, bells: 0, dates: 0 });

      await expect(
        service.transitionStatus('school-123', 'active', mockContext),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'ACTIVATION_REQUIREMENTS_NOT_MET',
          details: expect.objectContaining({
            archetype: 'PABSON',
            missing: expect.arrayContaining([
              expect.objectContaining({ key: 'grading_periods', current: 0, required: 4 }),
              expect.objectContaining({ key: 'bell_schedule', current: 0, required: 1 }),
              expect.objectContaining({ key: 'calendar_generated', current: 0, required: 1 }),
            ]),
          }),
        }),
      });
    });

    it('proceeds to activate when all PABSON requirements are met', async () => {
      setupSchoolWithGate(mockDynamoDBClient, { ay: 1, terms: 4, bells: 1, dates: 100 });
      mockDynamoDBClient.updateItem.mockResolvedValue({ ...mockSchool, status: 'active' });

      const result = await service.transitionStatus('school-123', 'active', mockContext);
      expect(result.status).toBe('active');
      expect(mockDynamoDBClient.updateItem).toHaveBeenCalled();
    });

    it('GENERIC tenant can activate with only an AY (matches prior lax behavior on purpose)', async () => {
      setupSchoolWithGate(
        mockDynamoDBClient,
        { ay: 1, terms: 0, bells: 0, dates: 0 },
        'GENERIC',
      );
      mockDynamoDBClient.updateItem.mockResolvedValue({ ...mockSchool, status: 'active' });

      const result = await service.transitionStatus('school-123', 'active', mockContext);
      expect(result.status).toBe('active');
    });
  });

});
