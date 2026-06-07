/**
 * Grades Service Unit Tests
 *
 * Tests assignment grade recording, bulk recording, grade calculation,
 * finalization, and retrieval.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { GradesService } from './grades.service';
import { GradingPolicyService } from './grading-policy.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { DataScopeService } from '../common/services/data-scope.service';
import { Grade, AssignmentGrade } from '../common/entities/grade.entity';
import { GradingPolicyEntity } from '../common/entities/grading-policy.entity';
import { RequestContext } from '../common/entities/base.entity';

// ============================================
// Mocks
// ============================================

const mockDynamoDBClient = {
  getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  queryGSI: jest.fn().mockResolvedValue({ items: [] }),
};

const mockEventsService = {
  publishEvent: jest.fn().mockResolvedValue(undefined),
  publishGradeRecorded: jest.fn().mockResolvedValue(undefined),
  publishGradeBulkRecorded: jest.fn().mockResolvedValue(undefined),
  publishGradeFinalized: jest.fn().mockResolvedValue(undefined),
  publishGradeBulkFinalized: jest.fn().mockResolvedValue(undefined),
};

const mockGradingPolicyService = {
  getDefaultPolicyEntity: jest.fn(),
};

const mockDataScopeService = {
  resolveScope: jest.fn().mockResolvedValue({ type: 'school', schoolId: 'school-001' }),
  isStudentInScope: jest.fn().mockReturnValue(true),
  isSectionInScope: jest.fn().mockReturnValue(true),
};

// ============================================
// Fixtures
// ============================================

const mockContext: RequestContext = {
  userId: 'teacher-001',
  tenantId: 'tenant-001',
  email: 'teacher@school.edu',
  role: 'Teacher',
  jwtToken: 'mock-jwt-token',
};

const mockPolicy: GradingPolicyEntity = {
  tenantId: 'tenant-001',
  entityKey: 'GRADEPOLICY#school-001#policy-001',
  entityType: 'GRADEPOLICY',
  policyId: 'policy-001',
  schoolId: 'school-001',
  policyName: 'Standard',
  gpaScale: '4.0',
  letterGrades: [
    { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0, isPassing: true },
    { letter: 'B', minPercentage: 80, maxPercentage: 89, gpaPoints: 3.0, isPassing: true },
    { letter: 'C', minPercentage: 70, maxPercentage: 79, gpaPoints: 2.0, isPassing: true },
    { letter: 'D', minPercentage: 60, maxPercentage: 69, gpaPoints: 1.0, isPassing: true },
    { letter: 'F', minPercentage: 0, maxPercentage: 59, gpaPoints: 0.0, isPassing: false },
  ],
  categoryWeights: [
    { categoryId: 'hw', categoryName: 'Homework', weight: 30 },
    { categoryId: 'test', categoryName: 'Tests', weight: 70 },
  ],
  roundingRule: 'nearest',
  minimumPassingGrade: 60,
  isDefault: true,
  isActive: true,
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
  createdBy: 'admin-001',
  updatedBy: 'admin-001',
  version: 1,
  gsi1pk: 'TENANT#tenant-001#SCHOOL#school-001',
  gsi1sk: 'GRADEPOLICY#STANDARD',
};

function makeMockGrade(overrides: Partial<Grade> = {}): Grade {
  return {
    tenantId: 'tenant-001',
    entityKey: 'GRADE#student-001#course-001#term-Q1',
    entityType: 'GRADE',
    gradeId: 'grade-001',
    studentId: 'student-001',
    schoolId: 'school-001',
    courseId: 'course-001',
    teacherId: 'teacher-001',
    academicYearId: 'year-001',
    termId: 'term-Q1',
    numericGrade: 85,
    letterGrade: 'B',
    gpaPoints: 3.0,
    assignments: [],
    categoryGrades: [],
    isFinal: false,
    isPassing: true,
    createdAt: '2025-01-15T00:00:00.000Z',
    updatedAt: '2025-01-15T00:00:00.000Z',
    createdBy: 'teacher-001',
    updatedBy: 'teacher-001',
    version: 1,
    gsi1pk: 'TENANT#tenant-001#SCHOOL#school-001',
    gsi1sk: 'GRADE#course-001#term-Q1',
    gsi2pk: 'student-001',
    gsi2sk: 'GRADE#year-001#term-Q1',
    ...overrides,
  };
}

const baseRecordDto = {
  studentId: 'student-001',
  schoolId: 'school-001',
  courseId: 'course-001',
  termId: 'term-Q1',
  academicYearId: 'year-001',
  teacherId: 'teacher-001',
  assignment: {
    assignmentName: 'Homework 1',
    assignmentType: 'homework' as const,
    categoryId: 'hw',
    possiblePoints: 100,
    earnedPoints: 90,
  },
};

// ============================================
// Tests
// ============================================

describe('GradesService', () => {
  let service: GradesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradesService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: AcademicsEventsService, useValue: mockEventsService },
        { provide: GradingPolicyService, useValue: mockGradingPolicyService },
        { provide: DataScopeService, useValue: mockDataScopeService },
      ],
    }).compile();

    service = module.get<GradesService>(GradesService);
  });

  // ------------------------------------------
  // recordAssignmentGrade - new Grade doc
  // ------------------------------------------
  describe('recordAssignmentGrade (new)', () => {
    beforeEach(() => {
      mockDynamoDBClient.getItem.mockResolvedValue(null); // no existing grade
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);
      mockGradingPolicyService.getDefaultPolicyEntity.mockResolvedValue(mockPolicy);
    });

    it('should create a new grade document with one assignment', async () => {
      const result = await service.recordAssignmentGrade(baseRecordDto, mockContext);

      expect(result).toBeDefined();
      expect(result.studentId).toBe('student-001');
      expect(result.courseId).toBe('course-001');
      expect(result.assignments).toHaveLength(1);
      expect(result.assignments![0].assignmentName).toBe('Homework 1');
      expect(result.assignments![0].earnedPoints).toBe(90);
      expect(result.isFinal).toBe(false);
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    });

    it('should calculate numeric grade from assignment', async () => {
      const result = await service.recordAssignmentGrade(baseRecordDto, mockContext);

      // 90/100 = 90% → should be A with 4.0 GPA
      expect(result.numericGrade).toBeDefined();
      expect(result.assignments![0].percentage).toBe(90);
    });

    it('should throw BadRequestException if earned > possible (non-extra-credit)', async () => {
      await expect(
        service.recordAssignmentGrade(
          {
            ...baseRecordDto,
            assignment: {
              ...baseRecordDto.assignment,
              earnedPoints: 110,
              possiblePoints: 100,
            },
          },
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should allow earned > possible for extra credit assignments', async () => {
      const result = await service.recordAssignmentGrade(
        {
          ...baseRecordDto,
          assignment: {
            ...baseRecordDto.assignment,
            earnedPoints: 110,
            possiblePoints: 100,
            isExtraCredit: true,
          },
        },
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.assignments![0].earnedPoints).toBe(110);
    });

    it('should publish GradeRecorded event', async () => {
      await service.recordAssignmentGrade(baseRecordDto, mockContext);

      expect(mockEventsService.publishGradeRecorded).toHaveBeenCalledWith(
        'tenant-001',
        'student-001',
        'course-001',
        'school-001',
        'term-Q1',
        expect.any(String),
      );
    });
  });

  // ------------------------------------------
  // recordAssignmentGrade - update existing
  // ------------------------------------------
  describe('recordAssignmentGrade (update existing)', () => {
    beforeEach(() => {
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(
          makeMockGrade({
            assignments: [
              {
                assignmentId: 'asgn-001',
                assignmentName: 'Homework 1',
                assignmentType: 'homework',
                categoryId: 'hw',
                possiblePoints: 100,
                earnedPoints: 80,
                percentage: 80,
                gradedAt: '2025-01-10T00:00:00.000Z',
                gradedBy: 'teacher-001',
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          makeMockGrade({
            assignments: [
              {
                assignmentId: 'asgn-001',
                assignmentName: 'Homework 1',
                assignmentType: 'homework',
                categoryId: 'hw',
                possiblePoints: 100,
                earnedPoints: 80,
                percentage: 80,
                gradedAt: '2025-01-10T00:00:00.000Z',
                gradedBy: 'teacher-001',
              },
              {
                assignmentId: 'asgn-002',
                assignmentName: 'Homework 2',
                assignmentType: 'homework',
                categoryId: 'hw',
                possiblePoints: 50,
                earnedPoints: 45,
                percentage: 90,
                gradedAt: '2025-01-15T00:00:00.000Z',
                gradedBy: 'teacher-001',
              },
            ],
          }),
        );
      mockDynamoDBClient.updateItem.mockResolvedValue(undefined);
      mockGradingPolicyService.getDefaultPolicyEntity.mockResolvedValue(mockPolicy);
    });

    it('should add a second assignment to existing grade document', async () => {
      const result = await service.recordAssignmentGrade(
        {
          ...baseRecordDto,
          assignment: {
            assignmentName: 'Homework 2',
            assignmentType: 'homework',
            categoryId: 'hw',
            possiblePoints: 50,
            earnedPoints: 45,
          },
        },
        mockContext,
      );

      expect(result).toBeDefined();
      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
    });

    it('should throw ConflictException if grade is finalized', async () => {
      mockDynamoDBClient.getItem.mockReset();
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockGrade({ isFinal: true }));

      await expect(
        service.recordAssignmentGrade(baseRecordDto, mockContext),
      ).rejects.toThrow(ConflictException);
    });
  });

  // ------------------------------------------
  // recordBulkGrades
  // ------------------------------------------
  describe('recordBulkGrades', () => {
    beforeEach(() => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);
      mockGradingPolicyService.getDefaultPolicyEntity.mockResolvedValue(mockPolicy);
    });

    it('should record grades for multiple students', async () => {
      const result = await service.recordBulkGrades(
        {
          schoolId: 'school-001',
          sectionId: 'section-001',
          courseId: 'course-001',
          termId: 'term-Q1',
          academicYearId: 'year-001',
          teacherId: 'teacher-001',
          assignment: {
            assignmentName: 'Quiz 1',
            assignmentType: 'quiz',
            categoryId: 'test',
            possiblePoints: 20,
          },
          grades: [
            { studentId: 'student-001', earnedPoints: 18 },
            { studentId: 'student-002', earnedPoints: 15 },
            { studentId: 'student-003', earnedPoints: 20 },
          ],
        },
        mockContext,
      );

      expect(result.recorded).toBe(3);
      expect(result.errors).toHaveLength(0);
    });

    it('should report errors for individual failures without stopping', async () => {
      // First student succeeds, second throws (already finalized)
      mockDynamoDBClient.getItem
        .mockResolvedValueOnce(null) // student-001 no existing grade
        .mockResolvedValueOnce(makeMockGrade({ isFinal: true, studentId: 'student-002' })); // student-002 finalized

      const result = await service.recordBulkGrades(
        {
          schoolId: 'school-001',
          sectionId: 'section-001',
          courseId: 'course-001',
          termId: 'term-Q1',
          academicYearId: 'year-001',
          teacherId: 'teacher-001',
          assignment: {
            assignmentName: 'Quiz 1',
            assignmentType: 'quiz',
            possiblePoints: 20,
          },
          grades: [
            { studentId: 'student-001', earnedPoints: 18 },
            { studentId: 'student-002', earnedPoints: 15 },
          ],
        },
        mockContext,
      );

      expect(result.recorded).toBe(1);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].studentId).toBe('student-002');
    });
  });

  // ------------------------------------------
  // getGrade
  // ------------------------------------------
  describe('getGrade', () => {
    it('should return a grade document', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockGrade());

      const result = await service.getGrade('student-001', 'course-001', 'term-Q1', mockContext);

      expect(result.studentId).toBe('student-001');
      expect(result.courseId).toBe('course-001');
    });

    it('should throw NotFoundException if grade does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.getGrade('student-001', 'course-001', 'term-Q1', mockContext),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ------------------------------------------
  // getSectionGrades
  // ------------------------------------------
  describe('getSectionGrades', () => {
    it('should return grades for a section filtered by term', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [
          makeMockGrade({ studentId: 'student-001', termId: 'term-Q1' }),
          makeMockGrade({ studentId: 'student-002', termId: 'term-Q1' }),
          makeMockGrade({ studentId: 'student-003', termId: 'term-Q2' }), // different term
        ],
        hasMore: false,
      });

      const result = await service.getSectionGrades('section-001', 'school-001', mockContext, 'term-Q1');

      expect(result).toHaveLength(2);
    });
  });

  // ------------------------------------------
  // finalizeGrade
  // ------------------------------------------
  describe('finalizeGrade', () => {
    it('should finalize a grade', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockGrade());
      mockDynamoDBClient.updateItem.mockResolvedValue(makeMockGrade({ isFinal: true }));

      const result = await service.finalizeGrade('student-001', 'course-001', 'term-Q1', mockContext);

      expect(result.isFinal).toBe(true);
      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledWith(
        expect.anything(),
        'tenant-001',
        'GRADE#student-001#course-001#term-Q1',
        expect.stringContaining('isFinal = :isFinal'),
        expect.objectContaining({ ':isFinal': true }),
      );
    });

    it('should throw NotFoundException if grade does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.finalizeGrade('student-001', 'course-001', 'term-Q1', mockContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw ConflictException if already finalized', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockGrade({ isFinal: true }));

      await expect(
        service.finalizeGrade('student-001', 'course-001', 'term-Q1', mockContext),
      ).rejects.toThrow(ConflictException);
    });

    it('should publish GradeFinalized event', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockGrade());
      mockDynamoDBClient.updateItem.mockResolvedValue(makeMockGrade({ isFinal: true }));

      await service.finalizeGrade('student-001', 'course-001', 'term-Q1', mockContext);

      expect(mockEventsService.publishGradeFinalized).toHaveBeenCalledWith(
        'tenant-001',
        'student-001',
        'course-001',
        'school-001',
        'term-Q1',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // ------------------------------------------
  // calculateGrade (unit tests for calculation engine)
  // ------------------------------------------
  describe('calculateGrade', () => {
    it('should return zero grade for empty assignments', () => {
      const result = service.calculateGrade([], mockPolicy);

      expect(result.numericGrade).toBe(0);
      expect(result.categoryGrades).toHaveLength(0);
    });

    it('should calculate simple average when no policy', () => {
      const assignments: AssignmentGrade[] = [
        {
          assignmentId: 'a1', assignmentName: 'HW1', assignmentType: 'homework',
          possiblePoints: 100, earnedPoints: 80, percentage: 80,
        },
        {
          assignmentId: 'a2', assignmentName: 'HW2', assignmentType: 'homework',
          possiblePoints: 100, earnedPoints: 90, percentage: 90,
        },
      ];

      const result = service.calculateGrade(assignments, null);

      // (80 + 90) / 200 * 100 = 85
      expect(result.numericGrade).toBe(85);
    });

    it('should calculate weighted grade with category weights', () => {
      const assignments: AssignmentGrade[] = [
        {
          assignmentId: 'a1', assignmentName: 'HW1', assignmentType: 'homework',
          categoryId: 'hw', possiblePoints: 100, earnedPoints: 100, percentage: 100,
        },
        {
          assignmentId: 'a2', assignmentName: 'Test1', assignmentType: 'test',
          categoryId: 'test', possiblePoints: 100, earnedPoints: 80, percentage: 80,
        },
      ];

      const result = service.calculateGrade(assignments, mockPolicy);

      // hw: 100% * 30% = 30, test: 80% * 70% = 56, total = 86%
      expect(result.numericGrade).toBe(86);
      expect(result.letterGrade).toBe('B');
      expect(result.gpaPoints).toBe(3.0);
      expect(result.isPassing).toBe(true);
      expect(result.categoryGrades).toHaveLength(2);
    });

    it('should handle missing assignments (count as 0)', () => {
      const assignments: AssignmentGrade[] = [
        {
          assignmentId: 'a1', assignmentName: 'HW1', assignmentType: 'homework',
          categoryId: 'hw', possiblePoints: 100, earnedPoints: 100, percentage: 100,
        },
        {
          assignmentId: 'a2', assignmentName: 'HW2', assignmentType: 'homework',
          categoryId: 'hw', possiblePoints: 100, isMissing: true,
        },
      ];

      const result = service.calculateGrade(assignments, mockPolicy);

      // hw: 100/(100+100) = 50% * 30% = 15
      // No test category scores, so normalized
      expect(result.categoryGrades.find(c => c.categoryId === 'hw')?.percentage).toBe(50);
    });

    it('should exclude excused assignments from calculation', () => {
      const assignments: AssignmentGrade[] = [
        {
          assignmentId: 'a1', assignmentName: 'HW1', assignmentType: 'homework',
          categoryId: 'hw', possiblePoints: 100, earnedPoints: 90, percentage: 90,
        },
        {
          assignmentId: 'a2', assignmentName: 'HW2', assignmentType: 'homework',
          categoryId: 'hw', possiblePoints: 100, isExcused: true,
        },
      ];

      const result = service.calculateGrade(assignments, mockPolicy);

      // Only HW1 counts: 90/100 = 90%
      expect(result.categoryGrades.find(c => c.categoryId === 'hw')?.percentage).toBe(90);
    });
  });
});
