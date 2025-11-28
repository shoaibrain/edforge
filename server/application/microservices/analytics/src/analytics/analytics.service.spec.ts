/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Unit tests for AnalyticsService
 */

import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { AnalyticsService } from './analytics.service';
import { ClientFactoryService } from '@app/client-factory';
import { AthenaQueryService } from '../common/services/athena-query.service';

describe('AnalyticsService', () => {
  let service: AnalyticsService;
  let mockAthenaQueryService: jest.Mocked<AthenaQueryService>;
  let mockClientFactory: jest.Mocked<ClientFactoryService>;
  let mockConfigService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    mockAthenaQueryService = {
      executeQuery: jest.fn(),
      executeQueryWithMonitoring: jest.fn().mockImplementation(async (sql: string, params?: any) => {
        // Delegate to executeQuery for consistency
        return mockAthenaQueryService.executeQuery(sql, params);
      }),
      buildDateRangeFilters: jest.fn(),
      formatQueryResults: jest.fn()
    } as any;

    mockClientFactory = {
      getClient: jest.fn()
    } as any;

    mockConfigService = {
      get: jest.fn((key: string) => {
        if (key === 'DATA_LAKE_BUCKET_NAME') return 'edforge-data-lake-test';
        return undefined;
      }),
      getOrThrow: jest.fn(),
      has: jest.fn(),
      set: jest.fn()
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: ClientFactoryService,
          useValue: mockClientFactory
        },
        {
          provide: ConfigService,
          useValue: mockConfigService
        },
        {
          provide: AthenaQueryService,
          useValue: mockAthenaQueryService
        },
        {
          provide: AnalyticsService,
          useFactory: (
            clientFactory: ClientFactoryService,
            configService: ConfigService,
            athenaQueryService: AthenaQueryService
          ) => {
            return new AnalyticsService(clientFactory, configService, athenaQueryService);
          },
          inject: [ClientFactoryService, ConfigService, AthenaQueryService]
        }
      ]
    }).compile();

    service = module.get<AnalyticsService>(AnalyticsService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getPrincipalDashboard', () => {
    it('should aggregate dashboard data from multiple queries', async () => {
      const mockClient = {} as any;
      mockClientFactory.getClient.mockResolvedValue(mockClient);

      // Mock enrollment stats
      mockAthenaQueryService.executeQueryWithMonitoring.mockResolvedValueOnce({
        queryExecutionId: 'test-execution-id-1',
        rows: [
          { gradeLevel: '9', totalStudents: 50, activeEnrollments: 48, enrollmentCount: 50 }
        ],
        columnInfo: []
      });

      // Mock attendance stats
      mockAthenaQueryService.buildDateRangeFilters.mockReturnValue({
        yearFilter: "year = '2025'",
        monthFilter: "month = '01'",
        dayFilter: "day >= '01' AND day <= '31'"
      });
      mockAthenaQueryService.executeQueryWithMonitoring.mockResolvedValueOnce({
        queryExecutionId: 'test-execution-id-2',
        rows: [{
          totalDays: 20,
          present: 800,
          absent: 50,
          tardy: 10,
          avgAttendanceRate: 95.5
        }],
        columnInfo: []
      });

      // Mock grade stats
      mockAthenaQueryService.executeQueryWithMonitoring.mockResolvedValueOnce({
        queryExecutionId: 'test-execution-id-3',
        rows: [
          { letterGrade: 'A', avgPercentage: 92.5, gradeCount: 100 }
        ],
        columnInfo: []
      });

      // Mock at-risk count
      mockAthenaQueryService.executeQueryWithMonitoring.mockResolvedValueOnce({
        queryExecutionId: 'test-execution-id-4',
        rows: [{ atRiskCount: '5' }],
        columnInfo: []
      });

      const result = await service.getPrincipalDashboard(
        'tenant-1',
        'school-1',
        'year-1',
        { startDate: '2025-01-01', endDate: '2025-01-31' },
        'jwt-token'
      );

      expect(result.schoolId).toBe('school-1');
      expect(result.academicYearId).toBe('year-1');
      expect(result.enrollment).toBeDefined();
      expect(result.attendance).toBeDefined();
      expect(result.grades).toBeDefined();
      expect(result.atRiskStudents).toBeDefined();
    });
  });

  describe('getStudentPerformance', () => {
    it('should calculate GPA, attendance rate, and completion rate', async () => {
      const mockClient = {} as any;
      mockClientFactory.getClient.mockResolvedValue(mockClient);

      // Mock grades
      mockAthenaQueryService.executeQueryWithMonitoring.mockResolvedValueOnce({
        queryExecutionId: 'test-exec-id-1',
        rows: [
          { assignmentId: 'a1', score: 90, maxScore: 100, percentage: 90, letterGrade: 'A', date: '2025-01-15' },
          { assignmentId: 'a2', score: 85, maxScore: 100, percentage: 85, letterGrade: 'B', date: '2025-01-20' }
        ],
        columnInfo: []
      });

      // Mock attendance
      mockAthenaQueryService.executeQueryWithMonitoring.mockResolvedValueOnce({
        queryExecutionId: 'test-exec-id-2',
        rows: [
          { date: '2025-01-15', status: 'PRESENT' },
          { date: '2025-01-16', status: 'PRESENT' },
          { date: '2025-01-17', status: 'ABSENT' }
        ],
        columnInfo: []
      });

      // Mock assignments
      mockAthenaQueryService.executeQueryWithMonitoring.mockResolvedValueOnce({
        queryExecutionId: 'test-exec-id-3',
        rows: [
          { assignmentId: 'a1', title: 'Assignment 1', status: 'completed', dueDate: '2025-01-15' },
          { assignmentId: 'a2', title: 'Assignment 2', status: 'assigned', dueDate: '2025-01-20' }
        ],
        columnInfo: []
      });

      const result = await service.getStudentPerformance(
        'tenant-1',
        'student-1',
        'year-1',
        'jwt-token'
      );

      expect(result.studentId).toBe('student-1');
      expect(result.gpa).toBeGreaterThan(0);
      expect(result.attendanceRate).toBeGreaterThan(0);
      expect(result.completionRate).toBeGreaterThan(0);
      expect(result.grades).toHaveLength(2);
    });
  });

  describe('getAtRiskStudents', () => {
    it('should return at-risk students with risk factors', async () => {
      const mockClient = {} as any;
      mockClientFactory.getClient.mockResolvedValue(mockClient);

      mockAthenaQueryService.executeQueryWithMonitoring.mockResolvedValueOnce({
        queryExecutionId: 'test-exec-id-4',
        rows: [
          {
            studentId: 'student-1',
            avgScore: 55.0,
            attendanceRate: 70.0,
            isAtRisk: true
          },
          {
            studentId: 'student-2',
            avgScore: 65.0,
            attendanceRate: 50.0,
            isAtRisk: true
          }
        ],
        columnInfo: []
      });

      const result = await service.getAtRiskStudents(
        'tenant-1',
        'school-1',
        'year-1',
        60, // threshold
        'jwt-token'
      );

      expect(result.count).toBe(2);
      expect(result.students).toHaveLength(2);
      expect(result.students[0].riskFactors).toContain('Low GPA');
      expect(result.students[1].riskFactors).toContain('Low Attendance');
    });
  });

  describe('calculateGPA', () => {
    it('should calculate GPA correctly', () => {
      const grades = [
        { percentage: 95 }, // 4.0
        { percentage: 85 }, // 3.0
        { percentage: 75 }, // 2.0
        { percentage: 65 }  // 1.0
      ];

      const gpa = service['calculateGPA'](grades);
      expect(gpa).toBe(2.5); // (4.0 + 3.0 + 2.0 + 1.0) / 4
    });

    it('should return 0 for empty grades array', () => {
      const gpa = service['calculateGPA']([]);
      expect(gpa).toBe(0);
    });
  });

  describe('calculateAttendanceRate', () => {
    it('should calculate attendance rate correctly', () => {
      const attendance = [
        { status: 'PRESENT' },
        { status: 'PRESENT' },
        { status: 'ABSENT' },
        { status: 'PRESENT' }
      ];

      const rate = service['calculateAttendanceRate'](attendance);
      expect(rate).toBe(75); // 3 present out of 4
    });

    it('should return 0 for empty attendance array', () => {
      const rate = service['calculateAttendanceRate']([]);
      expect(rate).toBe(0);
    });
  });
});

