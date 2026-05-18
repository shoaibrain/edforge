/**
 * AcademicSessionService — Sprint C4-followup (Saraswati activation block)
 *
 * Pinned behavior: `createSession` MUST auto-create a paired `GradingPeriod`
 * with matching name/dates and the back-reference `academicSessionId` set.
 *
 * Why this exists: the V1 PABSON archetype counts GradingPeriods (not Sessions)
 * in the school activation gate. Pre-fix, the operator UI's Sessions wizard
 * step wrote SESSION rows but no TERM rows, leaving the school un-activatable
 * regardless of how many Sessions were created. The Saraswati pilot hit this
 * on 2026-05-18 — 4 sessions, 0 GPs, `canActivate: false`. Fixed by
 * auto-pairing on create. Full retro: docs/saraswati-session-pair-fix.md.
 *
 * If a future refactor splits these into independent operations or drops the
 * auto-pair, the activation gate will silently break again for every new
 * operator — these tests are the load-bearing guard.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { AcademicSessionService } from './academic-session.service';
import { AcademicYearsService } from '../academic-years/academic-years.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { RequestContext, GlobalRole } from '../common/entities/base.entity';

describe('AcademicSessionService', () => {
  let service: AcademicSessionService;
  let mockDynamoDBClient: any;
  let mockAcademicYearsService: any;

  const mockContext: RequestContext = {
    userId: 'admin-user',
    tenantId: 'tenant-1',
    email: 'admin@test.com',
    globalRole: 'TenantAdmin' as GlobalRole,
    jwtToken: 'mock-jwt',
  };

  // The base AY all session-create tests check against — disjoint from the
  // test date ranges so the AY service's getAcademicYear/range checks pass.
  const mockYear = {
    yearId: 'year-2083',
    name: 'AY 2083',
    startDate: '2026-04-15',
    endDate: '2027-04-13',
    schoolId: 'school-1',
  };

  beforeEach(async () => {
    mockDynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
      getItem: jest.fn().mockResolvedValue(null),
      putItem: jest.fn().mockResolvedValue(undefined),
      query: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
    };

    mockAcademicYearsService = {
      getAcademicYear: jest.fn().mockResolvedValue(mockYear),
      createGradingPeriod: jest.fn().mockResolvedValue({
        termId: 'term-paired-1',
        name: 'First Term',
        sequence: 1,
        termType: 'quarter',
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: AcademicYearsService, useValue: mockAcademicYearsService },
        AcademicSessionService,
      ],
    }).compile();

    service = module.get<AcademicSessionService>(AcademicSessionService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================
  // Saraswati-followup — createSession auto-pairs GradingPeriod
  // ===========================================================
  describe('createSession — auto-pair GradingPeriod (Saraswati-followup)', () => {
    const baseSessionDto: any = {
      academicYearId: 'year-2083',
      sessionName: 'First Term (Baisakh-Asar)',
      beginDate: '2026-04-15',
      endDate: '2026-07-14',
      termDescriptor: 'first_quarter',
    };

    it('writes the Session row AND auto-creates a paired GradingPeriod', async () => {
      const result = await service.createSession('school-1', baseSessionDto, mockContext);

      // Session got persisted.
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
      const putSession = mockDynamoDBClient.putItem.mock.calls[0][1];
      expect(putSession.entityType).toBe('ACADEMIC_SESSION');
      expect(putSession.sessionName).toBe('First Term (Baisakh-Asar)');

      // Paired GradingPeriod was created via the AcademicYearsService.
      expect(mockAcademicYearsService.createGradingPeriod).toHaveBeenCalledTimes(1);
      expect(result.academicSessionId).toBeDefined();
    });

    it('passes the session sessionName as the GradingPeriod.name', async () => {
      await service.createSession('school-1', baseSessionDto, mockContext);

      const gpCall = mockAcademicYearsService.createGradingPeriod.mock.calls[0];
      const gpDto = gpCall[2];
      expect(gpDto.name).toBe('First Term (Baisakh-Asar)');
    });

    it('passes matching beginDate/endDate to the GradingPeriod', async () => {
      await service.createSession('school-1', baseSessionDto, mockContext);

      const gpDto = mockAcademicYearsService.createGradingPeriod.mock.calls[0][2];
      expect(gpDto.startDate).toBe('2026-04-15');
      expect(gpDto.endDate).toBe('2026-07-14');
    });

    it('maps first_quarter → termType=quarter, sequence=1', async () => {
      await service.createSession('school-1', baseSessionDto, mockContext);

      const gpDto = mockAcademicYearsService.createGradingPeriod.mock.calls[0][2];
      expect(gpDto.termType).toBe('quarter');
      expect(gpDto.sequence).toBe(1);
    });

    it.each([
      ['first_quarter', 'quarter', 1],
      ['second_quarter', 'quarter', 2],
      ['third_quarter', 'quarter', 3],
      ['fourth_quarter', 'quarter', 4],
      ['fall_semester', 'semester', 1],
      ['spring_semester', 'semester', 2],
      ['summer', 'semester', 3],
      ['year_round', 'year', 1],
    ])(
      'maps termDescriptor=%s → termType=%s, sequence=%i',
      async (descriptor, expectedTermType, expectedSequence) => {
        // Reset between iterations to avoid cumulative call-count pollution.
        jest.clearAllMocks();
        mockAcademicYearsService.getAcademicYear.mockResolvedValue(mockYear);
        mockAcademicYearsService.createGradingPeriod.mockResolvedValue({
          termId: 'term-x',
        });

        await service.createSession(
          'school-1',
          { ...baseSessionDto, termDescriptor: descriptor },
          mockContext,
        );

        const gpDto = mockAcademicYearsService.createGradingPeriod.mock.calls[0][2];
        expect(gpDto.termType).toBe(expectedTermType);
        expect(gpDto.sequence).toBe(expectedSequence);
      },
    );

    it('sets the back-reference academicSessionId on the GradingPeriod', async () => {
      const result = await service.createSession('school-1', baseSessionDto, mockContext);

      const gpDto = mockAcademicYearsService.createGradingPeriod.mock.calls[0][2];
      expect(gpDto.academicSessionId).toBe(result.academicSessionId);
    });

    it('intentionally OMITS examStartDate/examEndDate on the GradingPeriod', async () => {
      // The operator picks exam dates later via the "Edit exam window" UI.
      // If we set defaults here, the GP's S1.3 auto-sync would create wrong
      // exam_window CalendarDate rows that the operator would have to undo.
      await service.createSession('school-1', baseSessionDto, mockContext);

      const gpDto = mockAcademicYearsService.createGradingPeriod.mock.calls[0][2];
      expect(gpDto.examStartDate).toBeUndefined();
      expect(gpDto.examEndDate).toBeUndefined();
    });

    it('returns the session successfully even if GradingPeriod create fails (best-effort pair)', async () => {
      // Failure mode: rare (same DDB, same tenant). The Session exists; the
      // activation gate will surface the missing GP via the existing
      // `grading_periods < 4` requirement check. Better than half-state.
      mockAcademicYearsService.createGradingPeriod.mockRejectedValue(
        new Error('DDB write throttled'),
      );

      const result = await service.createSession('school-1', baseSessionDto, mockContext);

      expect(result.academicSessionId).toBeDefined();
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    });
  });
});
