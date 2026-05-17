/**
 * CalendarDateService — Sprint S0 fix
 *
 * Covers S0.5: getCalendarStats defaults to the school's current AY when
 * the `academicYearId` query param is omitted. The prior behavior returned
 * a misleading "Academic year not found" 404 in that case (F8 in evidence).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CalendarDateService, partitionRowsBySource } from './calendar-date.service';
import type { CalendarDate } from '../common/entities/calendar-date.entity';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicYearsService } from '../academic-years/academic-years.service';
import { AcademicSessionService } from './academic-session.service';
import { CalendarService } from './calendar.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';

describe('CalendarDateService.getCalendarStats — S0.5', () => {
  let service: CalendarDateService;
  let mockDynamoDBClient: any;
  let mockAcademicYearsService: any;
  let mockAcademicSessionService: any;
  let mockCalendarService: any;

  const mockContext: RequestContext = {
    userId: 'admin-user',
    tenantId: 'tenant-1',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt',
  };

  const currentYearResponse = {
    yearId: 'y-2083',
    schoolId: 'school-1',
    name: 'AY 2083',
    startDate: '2026-04-15',
    endDate: '2027-04-13',
    status: 'active',
    isCurrent: true,
    calendarType: 'semester',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt: '2026-05-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
      // `queryGSI` was added to listCalendarDates after this spec was written;
      // the missing mock made the 4 stats tests crash at runtime. Defaulting
      // to empty so the "no data" path keeps working.
      queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };
    mockAcademicYearsService = {
      getAcademicYear: jest.fn().mockResolvedValue(currentYearResponse),
      getCurrentAcademicYear: jest.fn().mockResolvedValue(currentYearResponse),
    };
    mockAcademicSessionService = {};
    mockCalendarService = {};

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: AcademicYearsService, useValue: mockAcademicYearsService },
        { provide: AcademicSessionService, useValue: mockAcademicSessionService },
        { provide: CalendarService, useValue: mockCalendarService },
        {
          provide: CalendarDateService,
          useFactory: (
            db: DynamoDBClientService,
            ay: AcademicYearsService,
            sess: AcademicSessionService,
            cal: CalendarService,
          ) => new CalendarDateService(
            db, ay, sess, cal,
            // getCalendarStats path doesn't reach auditedWrite — but the
            // constructor signature requires it. Pre-existing latent bug
            // in this spec that ts-jest now catches.
            { emit: jest.fn() } as any,
          ),
          inject: [
            DynamoDBClientService,
            AcademicYearsService,
            AcademicSessionService,
            CalendarService,
          ],
        },
      ],
    }).compile();

    service = module.get<CalendarDateService>(CalendarDateService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('uses the explicit academicYearId when supplied', async () => {
    await service.getCalendarStats('school-1', 'y-2083', mockContext);

    expect(mockAcademicYearsService.getCurrentAcademicYear).not.toHaveBeenCalled();
    expect(mockAcademicYearsService.getAcademicYear).toHaveBeenCalledWith(
      'school-1',
      'y-2083',
      mockContext,
    );
  });

  it('resolves current AY when academicYearId is omitted', async () => {
    const result = await service.getCalendarStats('school-1', undefined, mockContext);

    expect(mockAcademicYearsService.getCurrentAcademicYear).toHaveBeenCalledWith(
      'school-1',
      mockContext,
    );
    // Resolved year flows into the response academicYearId
    expect(result.academicYearId).toBe('y-2083');
  });

  it('returns the academicYearId (resolved) on the response payload, not the original query param', async () => {
    const result = await service.getCalendarStats('school-1', undefined, mockContext);
    expect(result.academicYearId).toBe('y-2083');
    expect(result.academicYearName).toBe('AY 2083');
  });

  it('propagates NO_CURRENT_AY from the AY service when no current year exists', async () => {
    mockAcademicYearsService.getCurrentAcademicYear.mockRejectedValue(
      new NotFoundException({
        message: 'No academic year is marked as current.',
        errorCode: 'NO_CURRENT_AY',
        details: { schoolId: 'school-1' },
      }),
    );

    await expect(
      service.getCalendarStats('school-1', undefined, mockContext),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ errorCode: 'NO_CURRENT_AY' }),
    });
  });

  it('uses an empty stats payload when zero CalendarDate rows exist for the AY', async () => {
    mockDynamoDBClient.query.mockResolvedValue({ items: [], hasMore: false });

    const result = await service.getCalendarStats('school-1', 'y-2083', mockContext);

    expect(result.totalDays).toBe(0);
    expect(result.instructionalDays).toBe(0);
    expect(result.holidays).toBe(0);
    expect(result.upcomingEvents).toEqual([]);
  });
});

// ============================================================================
// C3.8: partitionRowsBySource — pure helper that decides which CalendarDate
// rows are safe to delete on merge-mode regenerate (both audit fields stay
// 'SYSTEM') vs. which dates must be preserved because an operator has either
// created the row from scratch or edited it post-generation.
// ============================================================================

describe('partitionRowsBySource (C3.8 merge mode)', () => {
  const row = (
    date: string,
    createdBy: string,
    updatedBy: string,
  ): CalendarDate =>
    ({
      entityKey: `SCHOOL#s1#DATE#${date}`,
      date,
      createdBy,
      updatedBy,
    } as CalendarDate);

  it('treats rows where both createdBy and updatedBy are SYSTEM as deletable', () => {
    const rows = [row('2026-04-14', 'SYSTEM', 'SYSTEM'), row('2026-04-15', 'SYSTEM', 'SYSTEM')];
    const { systemRowKeys, preservedDates } = partitionRowsBySource(rows);
    expect(systemRowKeys).toEqual([
      'SCHOOL#s1#DATE#2026-04-14',
      'SCHOOL#s1#DATE#2026-04-15',
    ]);
    expect(preservedDates.size).toBe(0);
  });

  it('preserves operator-created rows (createdBy !== SYSTEM)', () => {
    const rows = [row('2026-04-14', 'user-1', 'user-1')];
    const { systemRowKeys, preservedDates } = partitionRowsBySource(rows);
    expect(systemRowKeys).toEqual([]);
    expect(preservedDates.has('2026-04-14')).toBe(true);
  });

  it('preserves rows an operator EDITED on top of a SYSTEM-generated row (updatedBy !== SYSTEM)', () => {
    const rows = [row('2026-04-14', 'SYSTEM', 'user-1')];
    const { systemRowKeys, preservedDates } = partitionRowsBySource(rows);
    expect(systemRowKeys).toEqual([]);
    expect(preservedDates.has('2026-04-14')).toBe(true);
  });

  it('correctly splits a mixed batch', () => {
    const rows = [
      row('2026-04-14', 'SYSTEM', 'SYSTEM'),       // system → delete
      row('2026-04-15', 'SYSTEM', 'user-1'),       // operator edited → preserve
      row('2026-04-16', 'user-2', 'user-2'),       // operator created → preserve
      row('2026-04-17', 'SYSTEM', 'SYSTEM'),       // system → delete
    ];
    const { systemRowKeys, preservedDates } = partitionRowsBySource(rows);
    expect(systemRowKeys.sort()).toEqual([
      'SCHOOL#s1#DATE#2026-04-14',
      'SCHOOL#s1#DATE#2026-04-17',
    ]);
    expect([...preservedDates].sort()).toEqual(['2026-04-15', '2026-04-16']);
  });

  it('handles an empty input', () => {
    const { systemRowKeys, preservedDates } = partitionRowsBySource([]);
    expect(systemRowKeys).toEqual([]);
    expect(preservedDates.size).toBe(0);
  });
});
