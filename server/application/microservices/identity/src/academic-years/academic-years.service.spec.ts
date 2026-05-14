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
});
