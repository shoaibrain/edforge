/**
 * GPA Calculator Service Unit Tests
 *
 * Tests GPA computation: single/multiple courses, weighted/unweighted,
 * edge cases (no grades, perfect, zero, partial).
 */

import { Test, TestingModule } from '@nestjs/testing';
import { GpaCalculatorService } from './gpa-calculator.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { Grade } from '../common/entities/grade.entity';
import { Course } from '../common/entities/course.entity';
import { RequestContext } from '../common/entities/base.entity';

// ============================================
// Mocks
// ============================================

const mockDynamoDBClient = {
  getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
  queryGSI: jest.fn(),
  batchGetItems: jest.fn(),
};

// ============================================
// Fixtures
// ============================================

const mockContext: RequestContext = {
  userId: 'admin-001',
  tenantId: 'tenant-001',
  email: 'admin@school.edu',
  role: 'TenantAdmin',
  jwtToken: 'mock-jwt-token',
};

function makeGrade(overrides: Partial<Grade> = {}): Grade {
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
    numericGrade: 90,
    letterGrade: 'A',
    gpaPoints: 4.0,
    credits: 3,
    isFinal: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
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

function makeCourse(overrides: Partial<Course> = {}): Course {
  return {
    tenantId: 'tenant-001',
    entityKey: 'COURSE#school-001#course-001',
    entityType: 'COURSE',
    courseId: 'course-001',
    schoolId: 'school-001',
    courseCode: 'MATH101',
    courseName: 'Algebra 1',
    credits: 3,
    isActive: true,
    createdAt: '2025-01-01T00:00:00.000Z',
    updatedAt: '2025-01-01T00:00:00.000Z',
    createdBy: 'admin-001',
    updatedBy: 'admin-001',
    version: 1,
    gsi1pk: 'TENANT#tenant-001#SCHOOL#school-001',
    gsi1sk: 'COURSE#general#ALGEBRA 1',
    ...overrides,
  } as Course;
}

// ============================================
// Tests
// ============================================

describe('GpaCalculatorService', () => {
  let service: GpaCalculatorService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GpaCalculatorService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
      ],
    }).compile();

    service = module.get<GpaCalculatorService>(GpaCalculatorService);
  });

  // ------------------------------------------
  // No finalized grades
  // ------------------------------------------
  it('should return null GPA when no finalized grades exist', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({
      items: [makeGrade({ isFinal: false })], // not finalized
      hasMore: false,
    });

    const result = await service.calculateGpa('student-001', 'year-001', mockContext);

    expect(result.cumulativeGpa).toBeNull();
    expect(result.weightedGpa).toBeNull();
    expect(result.totalCredits).toBe(0);
    expect(result.termGpas).toHaveLength(0);
  });

  // ------------------------------------------
  // Single course
  // ------------------------------------------
  it('should calculate GPA for a single course', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({
      items: [makeGrade({ gpaPoints: 4.0, credits: 3 })],
      hasMore: false,
    });
    mockDynamoDBClient.batchGetItems.mockResolvedValue([
      makeCourse({ credits: 3 }),
    ]);

    const result = await service.calculateGpa('student-001', 'year-001', mockContext);

    expect(result.cumulativeGpa).toBe(4.0);
    expect(result.totalCredits).toBe(3);
    expect(result.termGpas).toHaveLength(1);
    expect(result.termGpas[0].gpa).toBe(4.0);
  });

  // ------------------------------------------
  // Multiple courses with different credits
  // ------------------------------------------
  it('should calculate weighted GPA across multiple courses', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({
      items: [
        makeGrade({ courseId: 'course-001', gpaPoints: 4.0, credits: 3 }),
        makeGrade({ courseId: 'course-002', gpaPoints: 3.0, credits: 4, entityKey: 'GRADE#student-001#course-002#term-Q1' }),
      ],
      hasMore: false,
    });
    mockDynamoDBClient.batchGetItems.mockResolvedValue([
      makeCourse({ courseId: 'course-001', credits: 3 }),
      makeCourse({ courseId: 'course-002', credits: 4 }),
    ]);

    const result = await service.calculateGpa('student-001', 'year-001', mockContext);

    // (4.0*3 + 3.0*4) / (3+4) = (12+12)/7 = 24/7 = 3.43
    expect(result.cumulativeGpa).toBe(3.43);
    expect(result.totalCredits).toBe(7);
  });

  // ------------------------------------------
  // Perfect 4.0 GPA
  // ------------------------------------------
  it('should return perfect 4.0 when all grades are A', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({
      items: [
        makeGrade({ courseId: 'c1', gpaPoints: 4.0, credits: 3 }),
        makeGrade({ courseId: 'c2', gpaPoints: 4.0, credits: 4, entityKey: 'GRADE#student-001#c2#term-Q1' }),
        makeGrade({ courseId: 'c3', gpaPoints: 4.0, credits: 2, entityKey: 'GRADE#student-001#c3#term-Q1' }),
      ],
      hasMore: false,
    });
    mockDynamoDBClient.batchGetItems.mockResolvedValue([
      makeCourse({ courseId: 'c1', credits: 3 }),
      makeCourse({ courseId: 'c2', credits: 4 }),
      makeCourse({ courseId: 'c3', credits: 2 }),
    ]);

    const result = await service.calculateGpa('student-001', 'year-001', mockContext);

    expect(result.cumulativeGpa).toBe(4.0);
  });

  // ------------------------------------------
  // Zero GPA (all F)
  // ------------------------------------------
  it('should return 0.0 GPA when all grades are F', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({
      items: [
        makeGrade({ courseId: 'c1', gpaPoints: 0.0, credits: 3 }),
        makeGrade({ courseId: 'c2', gpaPoints: 0.0, credits: 3, entityKey: 'GRADE#student-001#c2#term-Q1' }),
      ],
      hasMore: false,
    });
    mockDynamoDBClient.batchGetItems.mockResolvedValue([
      makeCourse({ courseId: 'c1', credits: 3 }),
      makeCourse({ courseId: 'c2', credits: 3 }),
    ]);

    const result = await service.calculateGpa('student-001', 'year-001', mockContext);

    expect(result.cumulativeGpa).toBe(0);
  });

  // ------------------------------------------
  // Weighted GPA with AP course
  // ------------------------------------------
  it('should calculate weighted GPA with AP bonus (+1.0)', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({
      items: [
        makeGrade({ courseId: 'ap-course', gpaPoints: 4.0, credits: 4 }),
      ],
      hasMore: false,
    });
    mockDynamoDBClient.batchGetItems.mockResolvedValue([
      makeCourse({ courseId: 'ap-course', credits: 4, creditType: 'ap' }),
    ]);

    const result = await service.calculateGpa('student-001', 'year-001', mockContext);

    // Unweighted: 4.0, Weighted: min(4.0+1.0, 5.0) = 5.0
    expect(result.cumulativeGpa).toBe(4.0);
    expect(result.weightedGpa).toBe(5.0);
  });

  // ------------------------------------------
  // Weighted GPA with Honors course
  // ------------------------------------------
  it('should calculate weighted GPA with honors bonus (+0.5)', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({
      items: [
        makeGrade({ courseId: 'honors-course', gpaPoints: 3.0, credits: 3 }),
      ],
      hasMore: false,
    });
    mockDynamoDBClient.batchGetItems.mockResolvedValue([
      makeCourse({ courseId: 'honors-course', credits: 3, creditType: 'honors' }),
    ]);

    const result = await service.calculateGpa('student-001', 'year-001', mockContext);

    // Unweighted: 3.0, Weighted: min(3.0+0.5, 4.5) = 3.5
    expect(result.cumulativeGpa).toBe(3.0);
    expect(result.weightedGpa).toBe(3.5);
  });

  // ------------------------------------------
  // Multiple terms
  // ------------------------------------------
  it('should calculate per-term GPAs and cumulative', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({
      items: [
        makeGrade({ courseId: 'c1', termId: 'term-Q1', gpaPoints: 4.0, credits: 3 }),
        makeGrade({ courseId: 'c1', termId: 'term-Q2', gpaPoints: 3.0, credits: 3, entityKey: 'GRADE#student-001#c1#term-Q2' }),
      ],
      hasMore: false,
    });
    mockDynamoDBClient.batchGetItems.mockResolvedValue([
      makeCourse({ courseId: 'c1', credits: 3 }),
    ]);

    const result = await service.calculateGpa('student-001', 'year-001', mockContext);

    expect(result.termGpas).toHaveLength(2);
    expect(result.termGpas.find(t => t.termId === 'term-Q1')?.gpa).toBe(4.0);
    expect(result.termGpas.find(t => t.termId === 'term-Q2')?.gpa).toBe(3.0);
    // Cumulative: (4.0*3 + 3.0*3) / (3+3) = 21/6 = 3.5
    expect(result.cumulativeGpa).toBe(3.5);
    expect(result.totalCredits).toBe(6);
  });

  // ------------------------------------------
  // No grades at all
  // ------------------------------------------
  it('should return null GPA when no grades exist', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({
      items: [],
      hasMore: false,
    });

    const result = await service.calculateGpa('student-001', 'year-001', mockContext);

    expect(result.cumulativeGpa).toBeNull();
    expect(result.weightedGpa).toBeNull();
    expect(result.totalCredits).toBe(0);
  });

  // ------------------------------------------
  // Use grade credits if course lookup fails
  // ------------------------------------------
  it('should fall back to grade credits when course not found', async () => {
    mockDynamoDBClient.queryGSI.mockResolvedValue({
      items: [makeGrade({ gpaPoints: 3.5, credits: 4 })],
      hasMore: false,
    });
    mockDynamoDBClient.batchGetItems.mockResolvedValue([]); // no courses found

    const result = await service.calculateGpa('student-001', 'year-001', mockContext);

    expect(result.cumulativeGpa).toBe(3.5);
    expect(result.totalCredits).toBe(4);
  });
});
