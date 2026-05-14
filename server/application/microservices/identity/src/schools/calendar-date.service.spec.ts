/**
 * CalendarDateService — Sprint S0 fix
 *
 * Covers S0.5: getCalendarStats defaults to the school's current AY when
 * the `academicYearId` query param is omitted. The prior behavior returned
 * a misleading "Academic year not found" 404 in that case (F8 in evidence).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { CalendarDateService } from './calendar-date.service';
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
          ) => new CalendarDateService(db, ay, sess, cal),
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
