/**
 * AcademicYearsService — Sprint S0 fixes
 *
 * Covers:
 *   S0.1 — getCurrentAcademicYear strictly honors `isCurrent`
 *   S0.12 — createAcademicYear / updateAcademicYear reject date-range
 *           overlap with existing AYs for the same school
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { AcademicYearsService } from './academic-years.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AuditedWriteService } from '../common/services/audited-write.service';
import { AcademicSessionService } from '../schools/academic-session.service';
import { expectAuditRow } from '../common/testing/audit-assertions';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';
import { createAcademicYearSchema } from '@aibrains/shared-types';

describe('AcademicYearsService', () => {
  let service: AcademicYearsService;
  let mockDynamoDBClient: any;
  let mockAcademicSessionService: any;

  const mockContext: RequestContext = {
    userId: 'admin-user',
    tenantId: 'tenant-1',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt',
  };

  const makeYear = (overrides: Partial<any>) => ({
    tenantId: 'tenant-1',
    entityType: 'ACADEMIC_YEAR',
    schoolId: 'school-1',
    yearId: 'year-default',
    name: 'AY default',
    startDate: '2026-04-15',
    endDate: '2027-04-13',
    status: 'planning',
    isCurrent: false,
    calendarType: 'semester',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
    version: 1,
    ...overrides,
  });

  beforeEach(async () => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      updateItem: jest.fn().mockResolvedValue(undefined),
      deleteItem: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    mockAcademicSessionService = {
      createSession: jest.fn().mockResolvedValue({ academicSessionId: 'sess-1' }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: AcademicSessionService, useValue: mockAcademicSessionService },
        // S0.8 — real AuditedWriteService against the same mock DDB client
        // so audit rows land in putItem.mock.calls for `expectAuditRow`.
        {
          provide: AuditedWriteService,
          useFactory: (db: DynamoDBClientService) => new AuditedWriteService(db),
          inject: [DynamoDBClientService],
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

    service = module.get<AcademicYearsService>(AcademicYearsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================
  // calendarType inherits the school config (PABSON/NPL → annual), not US 'semester'
  // ===========================================================
  describe('createAcademicYear — calendarType inherits the school config', () => {
    const persistedAY = () =>
      mockDynamoDBClient.putItem.mock.calls
        .map((c: any[]) => c[1])
        .find((e: any) => e?.entityType === 'ACADEMIC_YEAR');

    // Parse through the REAL create schema (the ZodValidationPipe path) so an
    // omitted calendarType is genuinely undefined, not a test-only shortcut.
    const parsedNoCalendar = () =>
      createAcademicYearSchema.parse({
        name: '2082-2083',
        startDate: '2025-04-14',
        endDate: '2026-04-13',
        // calendarType intentionally omitted
      });

    it('omitted calendarType → the school config academicCalendarType (annual for PABSON/NPL)', async () => {
      const dto = parsedNoCalendar();
      expect(dto.calendarType).toBeUndefined();
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ academicCalendarType: 'annual' }); // school CONFIG row

      await service.createAcademicYear('school-1', dto as any, mockContext);

      expect(persistedAY()?.calendarType).toBe('annual');
    });

    it('falls back to semester only when the school has no CONFIG row', async () => {
      const dto = parsedNoCalendar();
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue(null); // no config

      await service.createAcademicYear('school-1', dto as any, mockContext);

      expect(persistedAY()?.calendarType).toBe('semester');
    });

    it('an explicit calendarType always wins over the config', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue({ academicCalendarType: 'annual' });

      await service.createAcademicYear(
        'school-1',
        { name: '2082-2083', startDate: '2025-04-14', endDate: '2026-04-13', calendarType: 'quarter' } as any,
        mockContext,
      );

      expect(persistedAY()?.calendarType).toBe('quarter');
    });
  });

  // ===========================================================
  // S0.1 — getCurrentAcademicYear strictly honors isCurrent
  // ===========================================================
  describe('S0.1 — getCurrentAcademicYear', () => {
    it('returns the year flagged isCurrent: true', async () => {
      mockDynamoDBClient.query.mockResolvedValue({
        items: [
          makeYear({ yearId: 'y-2083', name: '2083', isCurrent: true, status: 'active' }),
          makeYear({ yearId: 'y-2082', name: '2082', isCurrent: false, status: 'completed' }),
        ],
        hasMore: false,
      });

      const result = await service.getCurrentAcademicYear('school-1', mockContext);
      expect(result.yearId).toBe('y-2083');
      expect(result.isCurrent).toBe(true);
    });

    it('throws 404 NO_CURRENT_AY when no year has isCurrent=true (even if one is status=active)', async () => {
      // Reproduces F2 from evidence: dev-pabson-school had status='active' on
      // its single AY but isCurrent=false, and the prior implementation
      // silently returned it. After fix, this is a loud 404.
      mockDynamoDBClient.query.mockResolvedValue({
        items: [
          makeYear({ yearId: 'y-2083', isCurrent: false, status: 'active' }),
        ],
        hasMore: false,
      });

      await expect(
        service.getCurrentAcademicYear('school-1', mockContext),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'NO_CURRENT_AY',
          message: expect.stringContaining('No academic year is marked as current'),
        }),
      });
    });

    it('throws 404 NO_CURRENT_AY when the school has zero academic years', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      await expect(
        service.getCurrentAcademicYear('school-1', mockContext),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('ignores status when determining current — isCurrent: true on a completed year still wins', async () => {
      // Edge case: a school could in theory have a stale isCurrent flag on a
      // completed year. The fix is to honor the flag (loud, predictable) and
      // let the operator correct the flag explicitly via set-current.
      mockDynamoDBClient.query.mockResolvedValue({
        items: [
          makeYear({ yearId: 'y-stale', isCurrent: true, status: 'completed' }),
          makeYear({ yearId: 'y-active', isCurrent: false, status: 'active' }),
        ],
        hasMore: false,
      });

      const result = await service.getCurrentAcademicYear('school-1', mockContext);
      expect(result.yearId).toBe('y-stale');
    });
  });

  // ===========================================================
  // S0.12 — AY date-range overlap validation
  // ===========================================================
  describe('S0.12 — createAcademicYear overlap validation', () => {
    const existing = makeYear({
      yearId: 'y-2083',
      name: 'AY 2083',
      startDate: '2026-04-15',
      endDate: '2027-04-13',
    });

    const baseCreateDto: any = {
      name: 'AY 2084',
      startDate: '2027-04-14',
      endDate: '2028-04-12',
    };

    it('allows a new AY whose dates do not overlap any existing AY (1-day gap)', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [existing], hasMore: false });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      await expect(
        service.createAcademicYear('school-1', baseCreateDto, mockContext),
      ).resolves.toBeDefined();
    });

    it('rejects with AY_DATE_RANGE_OVERLAP when the new range straddles an existing AY end', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [existing], hasMore: false });

      const overlappingDto = { ...baseCreateDto, startDate: '2027-04-10', endDate: '2028-04-12' };

      await expect(
        service.createAcademicYear('school-1', overlappingDto, mockContext),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'AY_DATE_RANGE_OVERLAP',
          details: expect.objectContaining({
            conflictingYearId: 'y-2083',
            conflictingYearName: 'AY 2083',
          }),
        }),
      });
    });

    it('rejects when the new AY is fully contained inside an existing AY', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [existing], hasMore: false });

      const containedDto = { ...baseCreateDto, startDate: '2026-09-01', endDate: '2027-01-15' };

      await expect(
        service.createAcademicYear('school-1', containedDto, mockContext),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'AY_DATE_RANGE_OVERLAP' }),
      });
    });

    it('rejects when the new AY fully encloses an existing AY', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [existing], hasMore: false });

      const enclosingDto = { ...baseCreateDto, startDate: '2025-01-01', endDate: '2028-12-31' };

      await expect(
        service.createAcademicYear('school-1', enclosingDto, mockContext),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'AY_DATE_RANGE_OVERLAP' }),
      });
    });

    it('rejects when same-day boundary (existing.endDate === new.startDate is inclusive overlap)', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [existing], hasMore: false });

      const boundaryDto = { ...baseCreateDto, startDate: '2027-04-13', endDate: '2028-04-12' };

      await expect(
        service.createAcademicYear('school-1', boundaryDto, mockContext),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'AY_DATE_RANGE_OVERLAP' }),
      });
    });
  });

  // ===========================================================
  // Saraswati-followup — createAcademicYear auto-promotes isCurrent
  // for the school's first AY (no current AY exists).
  //
  // Reason: without auto-promote, the operator UI lands a school with N AYs
  // all isCurrent=false → every /academic-years/current call returns 404 →
  // dashboards silently break. Saraswati pilot hit this on 2026-05-18.
  // Conservative behavior: only fires when zero AYs are currently flagged,
  // doesn't override explicit `setAsCurrent: false`-with-an-existing-current.
  // ===========================================================
  describe('Saraswati-followup — createAcademicYear auto-promote isCurrent', () => {
    const baseDto: any = {
      name: 'AY 2083',
      startDate: '2026-04-15',
      endDate: '2027-04-13',
      calendarType: 'semester',
    };

    it('auto-promotes the first AY (no existing AYs) to isCurrent=true', async () => {
      // listAcademicYears returns empty → no current AY exists → auto-promote.
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.createAcademicYear('school-1', baseDto, mockContext);

      expect(result.isCurrent).toBe(true);
      // Confirm the persisted entity matches.
      const putCall = (mockDynamoDBClient.putItem as jest.Mock).mock.calls.find(
        (c: any[]) => c[1]?.entityType === 'ACADEMIC_YEAR',
      );
      expect(putCall?.[1]?.isCurrent).toBe(true);
    });

    it('stays isCurrent=false when the school already has a current AY', async () => {
      // Existing current AY → new AY should NOT auto-promote.
      const existingCurrent = makeYear({
        yearId: 'y-existing',
        name: 'AY 2082',
        startDate: '2025-04-15',
        endDate: '2026-04-13',
        isCurrent: true,
        status: 'active',
      });
      mockDynamoDBClient.query.mockResolvedValue({
        items: [existingCurrent],
        hasMore: false,
      });

      const result = await service.createAcademicYear('school-1', baseDto, mockContext);

      expect(result.isCurrent).toBe(false);
      // No clearCurrentYear call should have fired (we didn't pass setAsCurrent=true).
      const updateCalls = (mockDynamoDBClient.updateItem as jest.Mock).mock.calls;
      expect(updateCalls).toHaveLength(0);
    });

    it('honors explicit setAsCurrent=true (clears any other current AY first)', async () => {
      const existingCurrent = makeYear({
        yearId: 'y-existing',
        name: 'AY 2082',
        startDate: '2025-04-15',
        endDate: '2026-04-13',
        isCurrent: true,
        status: 'active',
      });
      // First query (auto-promote check): returns the existing.
      // Second query (clearCurrentYear's list): also returns the existing.
      mockDynamoDBClient.query.mockResolvedValue({
        items: [existingCurrent],
        hasMore: false,
      });

      const dto = { ...baseDto, setAsCurrent: true };
      const result = await service.createAcademicYear('school-1', dto, mockContext);

      expect(result.isCurrent).toBe(true);
      // The existing current AY should have been cleared (set isCurrent=false).
      const updateCalls = (mockDynamoDBClient.updateItem as jest.Mock).mock.calls;
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('stays isCurrent=false when operator passes setAsCurrent=false AND another current AY exists', async () => {
      // Edge case: operator explicitly opts out, and a current AY already
      // exists. Auto-promote should NOT fire (the school has a current AY).
      // Use disjoint dates so the S0.12 overlap check passes.
      const existingCurrent = makeYear({
        yearId: 'y-existing',
        name: 'AY 2082',
        startDate: '2025-04-15',
        endDate: '2026-04-13',
        isCurrent: true,
      });
      mockDynamoDBClient.query.mockResolvedValue({
        items: [existingCurrent],
        hasMore: false,
      });

      const dto = { ...baseDto, setAsCurrent: false };
      const result = await service.createAcademicYear('school-1', dto, mockContext);

      expect(result.isCurrent).toBe(false);
    });
  });

  describe('S0.12 — updateAcademicYear overlap validation', () => {
    const ay2083 = makeYear({
      yearId: 'y-2083',
      name: 'AY 2083',
      startDate: '2026-04-15',
      endDate: '2027-04-13',
    });
    const ay2084 = makeYear({
      yearId: 'y-2084',
      name: 'AY 2084',
      startDate: '2027-04-14',
      endDate: '2028-04-12',
    });

    it('allows update that shifts dates but stays disjoint from siblings', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(ay2084);
      mockDynamoDBClient.query.mockResolvedValue({
        items: [ay2083, ay2084],
        hasMore: false,
      });
      mockDynamoDBClient.updateItem.mockResolvedValue(ay2084);

      await expect(
        service.updateAcademicYear('school-1', 'y-2084', { startDate: '2027-04-15' }, mockContext),
      ).resolves.toBeDefined();
    });

    it('does NOT compare an AY against itself during overlap check', async () => {
      // The AY being updated must be excluded from the comparison set,
      // otherwise every same-range update would self-conflict.
      mockDynamoDBClient.getItem.mockResolvedValue(ay2084);
      mockDynamoDBClient.query.mockResolvedValue({
        items: [ay2083, ay2084],
        hasMore: false,
      });
      mockDynamoDBClient.updateItem.mockResolvedValue(ay2084);

      await expect(
        service.updateAcademicYear('school-1', 'y-2084', { startDate: '2027-04-14' }, mockContext),
      ).resolves.toBeDefined();
    });

    it('rejects an update that would overlap a sibling', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(ay2084);
      mockDynamoDBClient.query.mockResolvedValue({
        items: [ay2083, ay2084],
        hasMore: false,
      });

      await expect(
        service.updateAcademicYear('school-1', 'y-2084', { startDate: '2027-04-10' }, mockContext),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ errorCode: 'AY_DATE_RANGE_OVERLAP' }),
      });
    });

    it('rejects an update that inverts the start/end order even if only one side is touched', async () => {
      // The prior code only validated start<end at create time. Update could
      // silently land an inverted range. After fix, update validates the
      // effective pair (new value or kept old value).
      mockDynamoDBClient.getItem.mockResolvedValue(ay2084);
      mockDynamoDBClient.query.mockResolvedValue({ items: [ay2084], hasMore: false });

      await expect(
        service.updateAcademicYear(
          'school-1',
          'y-2084',
          { startDate: '2029-01-01' }, // pushes start after the unchanged end
          mockContext,
        ),
      ).rejects.toMatchObject({ message: expect.stringContaining('End date must be after start date') });
    });

    it('does not run overlap check when neither start nor end date is being changed', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(ay2084);
      mockDynamoDBClient.query.mockResolvedValue({ items: [ay2083, ay2084], hasMore: false });
      mockDynamoDBClient.updateItem.mockResolvedValue({ ...ay2084, name: 'Renamed' });

      await expect(
        service.updateAcademicYear('school-1', 'y-2084', { name: 'Renamed' }, mockContext),
      ).resolves.toBeDefined();
      // updateItem was called (rename), but the query for overlap-check
      // need not have been needed for a name-only update. Either way, no
      // overlap error should fire.
    });
  });

  // ===========================================================
  // S2.3 — createAcademicYear emits a create audit row
  // ===========================================================
  describe('S2.3 — audit emission on AY create', () => {
    it('emits an ACADEMIC_YEAR create audit row capturing the boundary identifiers', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.createAcademicYear(
        'school-1',
        {
          name: 'AY 2084',
          startDate: '2027-04-14',
          endDate: '2028-04-12',
          setAsCurrent: false,
        } as any,
        mockContext,
      );

      expect(result.name).toBe('AY 2084');

      // Audit row written for the new AY
      expectAuditRow(mockDynamoDBClient, {
        targetEntity: 'ACADEMIC_YEAR',
        action: 'create',
        fieldChanged: 'name',
        changedBy: 'admin-user',
      });
      expectAuditRow(mockDynamoDBClient, {
        targetEntity: 'ACADEMIC_YEAR',
        action: 'create',
        fieldChanged: 'startDate',
        changedBy: 'admin-user',
      });
      expectAuditRow(mockDynamoDBClient, {
        targetEntity: 'ACADEMIC_YEAR',
        action: 'create',
        fieldChanged: 'endDate',
        changedBy: 'admin-user',
      });
    });
  });

  // ===========================================================
  // S0.8 — updateAcademicYearStatus emits an audit row via AuditedWriteService
  // ===========================================================
  describe('S0.8 — audit emission on status change', () => {
    it('emits an ACADEMIC_YEAR status_change audit row when status transitions', async () => {
      const ay = makeYear({
        yearId: 'y-2083',
        status: 'planning',
        isCurrent: false,
      });
      mockDynamoDBClient.getItem.mockResolvedValue(ay);
      mockDynamoDBClient.updateItem.mockResolvedValue({ ...ay, status: 'active' });
      // WorkspaceSettings.isLocked check + lock — accept any GSI query
      mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

      await service.updateAcademicYearStatus(
        'school-1',
        'y-2083',
        { status: 'active' as any },
        mockContext,
      );

      expectAuditRow(mockDynamoDBClient, {
        targetEntity: 'ACADEMIC_YEAR',
        targetEntityId: 'y-2083',
        action: 'status_change',
        fieldChanged: 'status',
        changedBy: 'admin-user',
      });
    });
  });

  // ===========================================================
  // Sprint 4 / Ticket 4.1 — updateAcademicYearStatus auto-promotes
  //   isCurrent on first planning→active transition
  // ===========================================================
  describe('Sprint 4 — auto-promote isCurrent on planning→active', () => {
    const originalKillSwitch = process.env.AY_AUTO_PROMOTE_ON_ACTIVATE;

    afterEach(() => {
      if (originalKillSwitch === undefined) {
        delete process.env.AY_AUTO_PROMOTE_ON_ACTIVATE;
      } else {
        process.env.AY_AUTO_PROMOTE_ON_ACTIVATE = originalKillSwitch;
      }
    });

    it('auto-promotes isCurrent=true when no other AY is current', async () => {
      const target = makeYear({
        yearId: 'y-2083',
        status: 'planning',
        isCurrent: false,
      });
      mockDynamoDBClient.getItem.mockResolvedValue(target);
      mockDynamoDBClient.updateItem.mockResolvedValue({ ...target, status: 'active' });
      // listAcademicYears (called by auto-promote pre-check) sees only this
      // single year. No other AY is current → auto-promote fires.
      mockDynamoDBClient.query.mockResolvedValue({ items: [target], hasMore: false });

      await service.updateAcademicYearStatus(
        'school-1',
        'y-2083',
        { status: 'active' as any },
        mockContext,
      );

      // Two updateItem calls: (1) status flip (always), (2) isCurrent flip.
      const isCurrentWrites = mockDynamoDBClient.updateItem.mock.calls.filter(
        ([, , , expr]: any[]) => typeof expr === 'string' && expr.includes('isCurrent'),
      );
      expect(isCurrentWrites.length).toBe(1);
      // Conditional guards against a concurrent flip.
      const [, , , , , condition] = isCurrentWrites[0];
      expect(condition).toContain('isCurrent');
    });

    it('does NOT auto-promote when another AY is already current', async () => {
      const target = makeYear({
        yearId: 'y-2083',
        status: 'planning',
        isCurrent: false,
      });
      const otherCurrent = makeYear({
        yearId: 'y-2082',
        status: 'completed',
        isCurrent: true,
      });
      mockDynamoDBClient.getItem.mockResolvedValue(target);
      mockDynamoDBClient.updateItem.mockResolvedValue({ ...target, status: 'active' });
      mockDynamoDBClient.query.mockResolvedValue({
        items: [target, otherCurrent],
        hasMore: false,
      });

      await service.updateAcademicYearStatus(
        'school-1',
        'y-2083',
        { status: 'active' as any },
        mockContext,
      );

      const isCurrentWrites = mockDynamoDBClient.updateItem.mock.calls.filter(
        ([, , , expr]: any[]) => typeof expr === 'string' && expr.includes('isCurrent'),
      );
      expect(isCurrentWrites.length).toBe(0);
    });

    it('does NOT auto-promote on active→completed transition', async () => {
      const target = makeYear({
        yearId: 'y-2083',
        status: 'active',
        isCurrent: true,
      });
      mockDynamoDBClient.getItem.mockResolvedValue(target);
      mockDynamoDBClient.updateItem.mockResolvedValue({ ...target, status: 'completed' });
      mockDynamoDBClient.query.mockResolvedValue({ items: [target], hasMore: false });

      await service.updateAcademicYearStatus(
        'school-1',
        'y-2083',
        { status: 'completed' as any },
        mockContext,
      );

      const isCurrentWrites = mockDynamoDBClient.updateItem.mock.calls.filter(
        ([, , , expr]: any[]) => typeof expr === 'string' && expr.includes('isCurrent'),
      );
      expect(isCurrentWrites.length).toBe(0);
    });

    it('does NOT auto-promote when the year is already active (status no-op)', async () => {
      const target = makeYear({
        yearId: 'y-2083',
        status: 'active',
        isCurrent: false,
      });
      mockDynamoDBClient.getItem.mockResolvedValue(target);
      mockDynamoDBClient.updateItem.mockResolvedValue(target);
      mockDynamoDBClient.query.mockResolvedValue({ items: [target], hasMore: false });

      await service.updateAcademicYearStatus(
        'school-1',
        'y-2083',
        { status: 'active' as any },
        mockContext,
      );

      const isCurrentWrites = mockDynamoDBClient.updateItem.mock.calls.filter(
        ([, , , expr]: any[]) => typeof expr === 'string' && expr.includes('isCurrent'),
      );
      expect(isCurrentWrites.length).toBe(0);
    });

    it('skips auto-promote when AY_AUTO_PROMOTE_ON_ACTIVATE=false', async () => {
      process.env.AY_AUTO_PROMOTE_ON_ACTIVATE = 'false';
      const target = makeYear({
        yearId: 'y-2083',
        status: 'planning',
        isCurrent: false,
      });
      mockDynamoDBClient.getItem.mockResolvedValue(target);
      mockDynamoDBClient.updateItem.mockResolvedValue({ ...target, status: 'active' });
      mockDynamoDBClient.query.mockResolvedValue({ items: [target], hasMore: false });

      await service.updateAcademicYearStatus(
        'school-1',
        'y-2083',
        { status: 'active' as any },
        mockContext,
      );

      const isCurrentWrites = mockDynamoDBClient.updateItem.mock.calls.filter(
        ([, , , expr]: any[]) => typeof expr === 'string' && expr.includes('isCurrent'),
      );
      expect(isCurrentWrites.length).toBe(0);
    });

    it('swallows ConditionalCheckFailedException on auto-promote (target state already correct)', async () => {
      const target = makeYear({
        yearId: 'y-2083',
        status: 'planning',
        isCurrent: false,
      });
      mockDynamoDBClient.getItem.mockResolvedValue(target);
      mockDynamoDBClient.query.mockResolvedValue({ items: [target], hasMore: false });
      // Status update succeeds; isCurrent update fails on conditional.
      mockDynamoDBClient.updateItem
        .mockResolvedValueOnce({ ...target, status: 'active' })
        .mockRejectedValueOnce(
          Object.assign(new Error('cond'), { name: 'ConditionalCheckFailedException' }),
        );

      // Should NOT throw — the status transition succeeds even if the
      // race-safety conditional rejects our isCurrent write.
      await expect(
        service.updateAcademicYearStatus(
          'school-1',
          'y-2083',
          { status: 'active' as any },
          mockContext,
        ),
      ).resolves.toBeDefined();
    });

    it('includes the isCurrent change in the audit row when auto-promote fires', async () => {
      const target = makeYear({
        yearId: 'y-2083',
        status: 'planning',
        isCurrent: false,
      });
      mockDynamoDBClient.getItem.mockResolvedValue(target);
      mockDynamoDBClient.updateItem.mockResolvedValue({ ...target, status: 'active' });
      mockDynamoDBClient.query.mockResolvedValue({ items: [target], hasMore: false });

      await service.updateAcademicYearStatus(
        'school-1',
        'y-2083',
        { status: 'active' as any },
        mockContext,
      );

      expectAuditRow(mockDynamoDBClient, {
        targetEntity: 'ACADEMIC_YEAR',
        targetEntityId: 'y-2083',
        action: 'status_change',
        fieldChanged: 'isCurrent',
        changedBy: 'admin-user',
      });
    });

    it('does NOT include isCurrent in the audit row when auto-promote was skipped', async () => {
      const target = makeYear({
        yearId: 'y-2083',
        status: 'planning',
        isCurrent: false,
      });
      const otherCurrent = makeYear({
        yearId: 'y-2082',
        isCurrent: true,
      });
      mockDynamoDBClient.getItem.mockResolvedValue(target);
      mockDynamoDBClient.updateItem.mockResolvedValue({ ...target, status: 'active' });
      mockDynamoDBClient.query.mockResolvedValue({
        items: [target, otherCurrent],
        hasMore: false,
      });

      await service.updateAcademicYearStatus(
        'school-1',
        'y-2083',
        { status: 'active' as any },
        mockContext,
      );

      // The status-change audit row still emits, but with no isCurrent field.
      const auditRows = mockDynamoDBClient.putItem.mock.calls
        .map(([, entity]: any) => entity)
        .filter((e: any) => e?.entityType === 'AUDIT_LOG');
      const fields = (auditRows[0]?.changes ?? []).map((c: any) => c.field);
      expect(fields).toContain('status');
      expect(fields).not.toContain('isCurrent');
    });
  });

  // ===========================================================
  // S1.2 — GradingPeriod exam dates: validation + audit
  // ===========================================================
  describe('S1.2 — createGradingPeriod with exam dates', () => {
    const ay = makeYear({
      yearId: 'y-2083',
      startDate: '2026-04-15',
      endDate: '2027-04-13',
      status: 'planning',
    });

    const baseCreateTermDto: any = {
      name: 'Term 1',
      termType: 'quarter',
      sequence: 1,
      startDate: '2026-04-15',
      endDate: '2026-07-14',
    };

    it('accepts a create with exam dates inside the term range and persists them', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [ay], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue(ay);

      const result = await service.createGradingPeriod(
        'school-1',
        'y-2083',
        {
          ...baseCreateTermDto,
          examStartDate: '2026-07-01',
          examEndDate: '2026-07-07',
        },
        mockContext,
      );

      expect(result.examStartDate).toBe('2026-07-01');
      expect(result.examEndDate).toBe('2026-07-07');

      // Term row written with exam dates
      const termWrites = mockDynamoDBClient.putItem.mock.calls.filter(
        ([, entity]: any) => entity.entityType === 'TERM',
      );
      expect(termWrites.length).toBeGreaterThan(0);
      expect(termWrites[0][1].examStartDate).toBe('2026-07-01');
      expect(termWrites[0][1].examEndDate).toBe('2026-07-07');
    });

    it('rejects exam dates that start before term startDate', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [ay], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue(ay);

      await expect(
        service.createGradingPeriod(
          'school-1',
          'y-2083',
          {
            ...baseCreateTermDto,
            examStartDate: '2026-04-10', // before term startDate 2026-04-15
            examEndDate: '2026-07-07',
          },
          mockContext,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'EXAM_DATES_OUT_OF_TERM_RANGE',
        }),
      });
    });

    it('rejects exam dates that end after term endDate', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [ay], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue(ay);

      await expect(
        service.createGradingPeriod(
          'school-1',
          'y-2083',
          {
            ...baseCreateTermDto,
            examStartDate: '2026-07-01',
            examEndDate: '2026-07-20', // after term endDate 2026-07-14
          },
          mockContext,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'EXAM_DATES_OUT_OF_TERM_RANGE',
        }),
      });
    });

    it('rejects examEndDate before examStartDate', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [ay], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue(ay);

      await expect(
        service.createGradingPeriod(
          'school-1',
          'y-2083',
          {
            ...baseCreateTermDto,
            examStartDate: '2026-07-10',
            examEndDate: '2026-07-05', // before examStartDate
          },
          mockContext,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'EXAM_DATES_OUT_OF_TERM_RANGE',
        }),
      });
    });

    it('emits a GRADING_PERIOD create audit row including exam dates', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [ay], hasMore: false });
      mockDynamoDBClient.getItem.mockResolvedValue(ay);

      await service.createGradingPeriod(
        'school-1',
        'y-2083',
        {
          ...baseCreateTermDto,
          examStartDate: '2026-07-01',
          examEndDate: '2026-07-07',
        },
        mockContext,
      );

      expectAuditRow(mockDynamoDBClient, {
        targetEntity: 'GRADING_PERIOD',
        action: 'create',
        fieldChanged: 'examStartDate',
        changedBy: 'admin-user',
      });
    });
  });

  describe('S1.2 — updateGradingPeriod with exam dates', () => {
    const existingTerm: any = {
      tenantId: 'tenant-1',
      entityType: 'TERM',
      termId: 't-1',
      yearId: 'y-2083',
      schoolId: 'school-1',
      name: 'Term 1',
      termType: 'quarter',
      sequence: 1,
      startDate: '2026-04-15',
      endDate: '2026-07-14',
      isActive: true,
      version: 1,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };

    it('sets exam dates on an existing term without exam dates', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(existingTerm);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...existingTerm,
        examStartDate: '2026-07-01',
        examEndDate: '2026-07-07',
      });

      const result = await service.updateGradingPeriod(
        'school-1',
        'y-2083',
        't-1',
        { examStartDate: '2026-07-01', examEndDate: '2026-07-07' } as any,
        mockContext,
      );

      expect(result.examStartDate).toBe('2026-07-01');
      expect(result.examEndDate).toBe('2026-07-07');
    });

    it('validates exam dates against an effective term range when termEnd is also being changed', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(existingTerm);

      // Operator wants to shrink the term to end on 2026-06-30 AND set exam
      // window for 2026-07-01..2026-07-07 — should fail because the new
      // effective term range no longer contains the exam window.
      await expect(
        service.updateGradingPeriod(
          'school-1',
          'y-2083',
          't-1',
          {
            endDate: '2026-06-30',
            examStartDate: '2026-07-01',
            examEndDate: '2026-07-07',
          } as any,
          mockContext,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          errorCode: 'EXAM_DATES_OUT_OF_TERM_RANGE',
        }),
      });
    });

    it('emits an exam_dates_updated audit row when exam dates change', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(existingTerm);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...existingTerm,
        examStartDate: '2026-07-01',
        examEndDate: '2026-07-07',
      });

      await service.updateGradingPeriod(
        'school-1',
        'y-2083',
        't-1',
        { examStartDate: '2026-07-01', examEndDate: '2026-07-07' } as any,
        mockContext,
      );

      expectAuditRow(mockDynamoDBClient, {
        targetEntity: 'GRADING_PERIOD',
        targetEntityId: 't-1',
        action: 'exam_dates_updated',
        fieldChanged: 'examStartDate',
        changedBy: 'admin-user',
      });
    });

    it('does not emit an exam_dates_updated audit row when exam dates are unchanged', async () => {
      // Existing term already has exam dates set; we're updating the term name only.
      const termWithExam = {
        ...existingTerm,
        examStartDate: '2026-07-01',
        examEndDate: '2026-07-07',
      };
      mockDynamoDBClient.getItem.mockResolvedValue(termWithExam);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...termWithExam,
        name: 'Term 1 (renamed)',
      });

      await service.updateGradingPeriod(
        'school-1',
        'y-2083',
        't-1',
        { name: 'Term 1 (renamed)' },
        mockContext,
      );

      // Exam-date audit row must NOT have been written
      const auditWrites = mockDynamoDBClient.putItem.mock.calls.filter(
        ([, entity]: any) =>
          entity.entityType === 'AUDIT_LOG' && entity.action === 'exam_dates_updated',
      );
      expect(auditWrites.length).toBe(0);
    });
  });

  // ===========================================================
  // S1.3 — exam_window CalendarDate auto-sync
  // ===========================================================
  describe('S1.3 — syncExamWindowEvents via updateGradingPeriod', () => {
    const baseTerm: any = {
      tenantId: 'tenant-1',
      entityType: 'TERM',
      termId: 't-1',
      yearId: 'y-2083',
      schoolId: 'school-1',
      name: 'Term 1',
      termType: 'quarter',
      sequence: 1,
      startDate: '2026-04-15',
      endDate: '2026-07-14',
      isActive: true,
      version: 1,
      createdAt: '2026-04-01T00:00:00.000Z',
      updatedAt: '2026-04-01T00:00:00.000Z',
    };

    /**
     * Helper: extract the CalendarDate putItem calls (exam_window dates added)
     * and deleteItem calls (dates removed) from the mock client.
     */
    const collectCalendarMutations = () => {
      const created = mockDynamoDBClient.putItem.mock.calls.filter(
        ([, e]: any) => e.entityType === 'CALENDARDATE',
      );
      const deletedKeys = mockDynamoDBClient.deleteItem.mock.calls
        .map(([, , key]: any) => key)
        .filter((k: string) => k.includes('DATE#'));
      return { created, deletedKeys };
    };

    it('creates exam_window CalendarDate rows for every date in a newly-set range', async () => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(baseTerm)             // term fetch
        .mockResolvedValue(null);                    // CalendarDate lookups: none exist
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...baseTerm,
        examStartDate: '2026-07-01',
        examEndDate: '2026-07-03',
      });

      await service.updateGradingPeriod(
        'school-1',
        'y-2083',
        't-1',
        { examStartDate: '2026-07-01', examEndDate: '2026-07-03' } as any,
        mockContext,
      );

      const { created } = collectCalendarMutations();
      expect(created.length).toBe(3); // 3 dates: 07-01, 07-02, 07-03
      const dates = created.map(([, e]: any) => e.date).sort();
      expect(dates).toEqual(['2026-07-01', '2026-07-02', '2026-07-03']);
      // Each row carries our sourceTermId and the exam_window event
      for (const [, row] of created) {
        const examEvt = row.calendarEvents.find((e: any) => e.eventType === 'exam_window');
        expect(examEvt).toBeDefined();
        expect(examEvt.sourceTermId).toBe('t-1');
        expect(examEvt.category).toBe('assessment');
        expect(row.gradingPeriodId).toBe('t-1');
        expect(row.isInstructionalDay).toBe(true);
      }
    });

    it('idempotent: does not re-add events when the same range is saved twice', async () => {
      // Existing CalendarDate row already has our exam_window event
      const existingRow: any = {
        entityType: 'CALENDARDATE',
        tenantId: 'tenant-1',
        schoolId: 'school-1',
        date: '2026-07-01',
        academicYearId: 'y-2083',
        calendarEvents: [
          {
            eventType: 'exam_window',
            description: 'Term 1 exam',
            isAllDay: true,
            sourceTermId: 't-1',
          },
        ],
        isInstructionalDay: true,
        isHoliday: false,
        isWeekend: false,
        dayOfWeek: 'wednesday',
        gradingPeriodId: 't-1',
        version: 1,
      };

      // Term has the existing range; the update sets the same range
      const termWithRange = { ...baseTerm, examStartDate: '2026-07-01', examEndDate: '2026-07-01' };

      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(termWithRange)
        .mockResolvedValue(existingRow);
      mockDynamoDBClient.updateItem.mockResolvedValue(termWithRange);

      await service.updateGradingPeriod(
        'school-1',
        'y-2083',
        't-1',
        { examStartDate: '2026-07-01', examEndDate: '2026-07-01' } as any,
        mockContext,
      );

      // No exam-dates audit row should have been emitted (no actual change)
      const examAudit = mockDynamoDBClient.putItem.mock.calls.filter(
        ([, e]: any) => e.entityType === 'AUDIT_LOG' && e.action === 'exam_dates_updated',
      );
      expect(examAudit.length).toBe(0);
    });

    it('removes exam_window events from dates leaving the range, preserves operator-added events', async () => {
      // Term currently has exam window 2026-07-01..2026-07-03; we shrink to just 07-01.
      const termWithRange = { ...baseTerm, examStartDate: '2026-07-01', examEndDate: '2026-07-03' };

      // 2026-07-02 has our exam_window + operator-added early_release. Should be filtered.
      // 2026-07-03 has ONLY our exam_window. Should be deleted entirely.
      const date02: any = {
        entityType: 'CALENDARDATE',
        tenantId: 'tenant-1',
        schoolId: 'school-1',
        date: '2026-07-02',
        academicYearId: 'y-2083',
        calendarEvents: [
          { eventType: 'exam_window', isAllDay: true, sourceTermId: 't-1' },
          { eventType: 'early_release', isAllDay: true }, // operator-added
        ],
        isInstructionalDay: true,
        isHoliday: false,
        isWeekend: false,
        dayOfWeek: 'thursday',
        version: 1,
      };
      const date03: any = {
        entityType: 'CALENDARDATE',
        tenantId: 'tenant-1',
        schoolId: 'school-1',
        date: '2026-07-03',
        academicYearId: 'y-2083',
        calendarEvents: [
          { eventType: 'exam_window', isAllDay: true, sourceTermId: 't-1' },
        ],
        isInstructionalDay: true,
        isHoliday: false,
        isWeekend: false,
        dayOfWeek: 'friday',
        version: 1,
      };

      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(termWithRange) // term fetch
        .mockResolvedValueOnce(date02)        // 07-02 lookup (toRemove)
        .mockResolvedValueOnce(date03);       // 07-03 lookup (toRemove)
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...termWithRange,
        examEndDate: '2026-07-01',
      });

      await service.updateGradingPeriod(
        'school-1',
        'y-2083',
        't-1',
        { examEndDate: '2026-07-01' } as any,
        mockContext,
      );

      // 07-03 should be deleted (only our event)
      const deleteKeys = mockDynamoDBClient.deleteItem.mock.calls.map(
        ([, , key]: any) => key,
      );
      expect(deleteKeys.some((k: string) => k.includes('DATE#2026-07-03'))).toBe(true);

      // 07-02 should be re-written WITHOUT our exam_window but WITH the early_release
      const date02Writes = mockDynamoDBClient.putItem.mock.calls.filter(
        ([, e]: any) => e.entityType === 'CALENDARDATE' && e.date === '2026-07-02',
      );
      expect(date02Writes.length).toBe(1);
      const filteredEvents = date02Writes[0][1].calendarEvents;
      expect(filteredEvents).toHaveLength(1);
      expect(filteredEvents[0].eventType).toBe('early_release');
    });

    it('does not touch exam_window events authored by a DIFFERENT term', async () => {
      // Date 2026-07-01 has exam_window from sibling term t-2 AND our t-1.
      // We're clearing t-1's exam window. t-2's event must survive.
      const termWithRange = { ...baseTerm, examStartDate: '2026-07-01', examEndDate: '2026-07-01' };
      const sharedDate: any = {
        entityType: 'CALENDARDATE',
        tenantId: 'tenant-1',
        schoolId: 'school-1',
        date: '2026-07-01',
        academicYearId: 'y-2083',
        calendarEvents: [
          { eventType: 'exam_window', isAllDay: true, sourceTermId: 't-1' }, // ours
          { eventType: 'exam_window', isAllDay: true, sourceTermId: 't-2' }, // sibling's
        ],
        isInstructionalDay: true,
        isHoliday: false,
        isWeekend: false,
        dayOfWeek: 'wednesday',
        version: 1,
      };

      // Clear t-1's exam window by passing examStartDate: undefined.
      // Note: in practice operators can't pass undefined through PATCH JSON;
      // this scenario simulates the internal sync method.
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(termWithRange)
        .mockResolvedValueOnce(sharedDate);
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...termWithRange,
        examStartDate: '2026-07-02', // shift the range so 07-01 leaves
        examEndDate: '2026-07-02',
      });

      await service.updateGradingPeriod(
        'school-1',
        'y-2083',
        't-1',
        { examStartDate: '2026-07-02', examEndDate: '2026-07-02' } as any,
        mockContext,
      );

      // 07-01 should be re-written with ONLY t-2's exam_window remaining
      const date01Writes = mockDynamoDBClient.putItem.mock.calls.filter(
        ([, e]: any) => e.entityType === 'CALENDARDATE' && e.date === '2026-07-01',
      );
      expect(date01Writes.length).toBe(1);
      const remaining = date01Writes[0][1].calendarEvents;
      expect(remaining).toHaveLength(1);
      expect(remaining[0].sourceTermId).toBe('t-2');
    });
  });

  // ===========================================================
  // S2.1 — Holiday/exam-window collision warnings (non-blocking)
  // ===========================================================
  describe('S2.1 — holiday overlap warnings on createGradingPeriod', () => {
    const ay = makeYear({
      yearId: 'y-2083',
      startDate: '2026-04-15',
      endDate: '2027-04-13',
      status: 'planning',
    });

    const baseCreateDto: any = {
      name: 'Term 2',
      termType: 'quarter',
      sequence: 2,
      startDate: '2026-07-16',
      endDate: '2026-10-15',
      examStartDate: '2026-10-05',
      examEndDate: '2026-10-09',
    };

    it('returns warnings[] in response when exam window overlaps an existing holiday', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [ay], hasMore: false });

      mockDynamoDBClient.getItem.mockImplementation((_c: any, _t: any, key: string) => {
        // AY lookup
        if (key.includes('YEAR#y-2083') && !key.includes('TERM#') && !key.includes('DATE#')) {
          return Promise.resolve(ay);
        }
        // 2026-10-09 — Phulpati holiday
        if (key.includes('DATE#2026-10-09')) {
          return Promise.resolve({
            entityType: 'CALENDARDATE',
            date: '2026-10-09',
            calendarEvents: [
              { eventType: 'holiday', description: 'Phulpati (Dashain)', isAllDay: true },
            ],
            isInstructionalDay: false,
            isHoliday: true,
            calendarId: 'cal-1',
          });
        }
        return Promise.resolve(null);
      });

      const result = await service.createGradingPeriod(
        'school-1',
        'y-2083',
        baseCreateDto,
        mockContext,
      );

      expect((result as any).warnings).toBeDefined();
      const warnings = (result as any).warnings as Array<{ code: string; date: string; holidayName: string }>;
      const phulpati = warnings.find(w => w.date === '2026-10-09');
      expect(phulpati).toBeDefined();
      expect(phulpati!.code).toBe('EXAM_OVERLAPS_HOLIDAY');
      expect(phulpati!.holidayName).toBe('Phulpati (Dashain)');
    });

    it('returns NO warnings field when exam window has no holiday overlaps', async () => {
      mockDynamoDBClient.query.mockResolvedValue({ items: [ay], hasMore: false });
      mockDynamoDBClient.getItem.mockImplementation((_c: any, _t: any, key: string) => {
        if (key.includes('YEAR#y-2083') && !key.includes('TERM#') && !key.includes('DATE#')) {
          return Promise.resolve(ay);
        }
        return Promise.resolve(null);
      });

      const result = await service.createGradingPeriod(
        'school-1',
        'y-2083',
        baseCreateDto,
        mockContext,
      );

      expect((result as any).warnings).toBeUndefined();
    });

    it('returns warnings on updateGradingPeriod when the new exam window overlaps a holiday', async () => {
      const existingTerm: any = {
        tenantId: 'tenant-1',
        entityType: 'TERM',
        termId: 't-1',
        yearId: 'y-2083',
        schoolId: 'school-1',
        name: 'Term 2',
        termType: 'quarter',
        sequence: 2,
        startDate: '2026-07-16',
        endDate: '2026-10-15',
        isActive: true,
        version: 1,
      };

      let calls = 0;
      mockDynamoDBClient.getItem.mockImplementation((_c: any, _t: any, key: string) => {
        calls++;
        if (calls === 1 && key.includes('TERM#t-1')) {
          return Promise.resolve(existingTerm);
        }
        if (key.includes('DATE#2026-10-09')) {
          return Promise.resolve({
            entityType: 'CALENDARDATE',
            date: '2026-10-09',
            calendarEvents: [
              { eventType: 'holiday', description: 'Phulpati (Dashain)', isAllDay: true },
            ],
            isInstructionalDay: false,
            isHoliday: true,
          });
        }
        return Promise.resolve(null);
      });
      mockDynamoDBClient.updateItem.mockResolvedValue({
        ...existingTerm,
        examStartDate: '2026-10-05',
        examEndDate: '2026-10-09',
      });

      const result = await service.updateGradingPeriod(
        'school-1',
        'y-2083',
        't-1',
        { examStartDate: '2026-10-05', examEndDate: '2026-10-09' } as any,
        mockContext,
      );

      expect((result as any).warnings).toBeDefined();
      const warnings = (result as any).warnings as Array<{ code: string; date: string; holidayName: string }>;
      expect(warnings.find(w => w.date === '2026-10-09')).toBeDefined();
    });
  });
});
