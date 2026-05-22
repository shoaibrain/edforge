/**
 * Grading Policy Service Unit Tests
 *
 * Tests CRUD operations, validation (weights sum, scale ranges),
 * and default policy management.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { GradingPolicyService } from './grading-policy.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { GradingPolicyEntity } from '../common/entities/grading-policy.entity';
import { GradingScaleEntry, CategoryWeight } from '../common/entities/grade.entity';
import { RequestContext } from '../common/entities/base.entity';

// ============================================
// Mocks
// ============================================

const mockDynamoDBClient = {
  getClient: jest.fn().mockResolvedValue({ send: jest.fn() }),
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  query: jest.fn(),
  queryGSI: jest.fn(),
};

const mockEventsService = {
  publishEvent: jest.fn().mockResolvedValue(undefined),
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

const defaultGradingScale: GradingScaleEntry[] = [
  { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0, isPassing: true },
  { letter: 'B', minPercentage: 80, maxPercentage: 89, gpaPoints: 3.0, isPassing: true },
  { letter: 'C', minPercentage: 70, maxPercentage: 79, gpaPoints: 2.0, isPassing: true },
  { letter: 'D', minPercentage: 60, maxPercentage: 69, gpaPoints: 1.0, isPassing: true },
  { letter: 'F', minPercentage: 0, maxPercentage: 59, gpaPoints: 0.0, isPassing: false },
];

const defaultCategoryWeights: CategoryWeight[] = [
  { categoryId: 'hw', categoryName: 'Homework', weight: 30 },
  { categoryId: 'quiz', categoryName: 'Quizzes', weight: 20 },
  { categoryId: 'test', categoryName: 'Tests', weight: 50 },
];

function makeMockPolicy(overrides: Partial<GradingPolicyEntity> = {}): GradingPolicyEntity {
  return {
    tenantId: 'tenant-001',
    entityKey: 'GRADEPOLICY#school-001#policy-001',
    entityType: 'GRADEPOLICY',
    policyId: 'policy-001',
    schoolId: 'school-001',
    policyName: 'Standard Grading',
    gpaScale: '4.0',
    letterGrades: defaultGradingScale,
    categoryWeights: defaultCategoryWeights,
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
    gsi1sk: 'GRADEPOLICY#STANDARD GRADING',
    ...overrides,
  };
}

// ============================================
// Tests
// ============================================

describe('GradingPolicyService', () => {
  let service: GradingPolicyService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradingPolicyService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: AcademicsEventsService, useValue: mockEventsService },
      ],
    }).compile();

    service = module.get<GradingPolicyService>(GradingPolicyService);
  });

  // ------------------------------------------
  // createGradingPolicy
  // ------------------------------------------
  describe('createGradingPolicy', () => {
    beforeEach(() => {
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
    });

    it('should create a grading policy successfully', async () => {
      const result = await service.createGradingPolicy(
        {
          schoolId: 'school-001',
          policyName: 'Standard Grading',
          gpaScale: '4.0',
          letterGrades: defaultGradingScale,
          categoryWeights: defaultCategoryWeights,
          roundingRule: 'nearest',
          minimumPassingGrade: 60,
          isDefault: true,
        },
        mockContext,
      );

      expect(result).toBeDefined();
      expect(result.policyName).toBe('Standard Grading');
      expect(result.schoolId).toBe('school-001');
      expect(result.isDefault).toBe(true);
      expect(result.letterGrades).toHaveLength(5);
      expect(result.categoryWeights).toHaveLength(3);
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    });

    it('should throw BadRequestException if weights do not sum to 100', async () => {
      await expect(
        service.createGradingPolicy(
          {
            schoolId: 'school-001',
            policyName: 'Bad Weights',
            gpaScale: '4.0',
            letterGrades: defaultGradingScale,
            categoryWeights: [
              { categoryId: 'hw', categoryName: 'Homework', weight: 30 },
              { categoryId: 'test', categoryName: 'Tests', weight: 50 },
              // Missing 20%
            ],
            roundingRule: 'nearest',
            minimumPassingGrade: 60,
          },
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if grade scale ranges overlap', async () => {
      await expect(
        service.createGradingPolicy(
          {
            schoolId: 'school-001',
            policyName: 'Overlapping Scale',
            gpaScale: '4.0',
            letterGrades: [
              { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0, isPassing: true },
              { letter: 'B', minPercentage: 85, maxPercentage: 95, gpaPoints: 3.0, isPassing: true }, // overlaps with A
            ],
            categoryWeights: [{ categoryId: 'all', categoryName: 'All', weight: 100 }],
            roundingRule: 'nearest',
            minimumPassingGrade: 60,
          },
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);

      expect(mockDynamoDBClient.putItem).not.toHaveBeenCalled();
    });

    it('should throw BadRequestException if min > max in scale entry', async () => {
      await expect(
        service.createGradingPolicy(
          {
            schoolId: 'school-001',
            policyName: 'Bad Range',
            gpaScale: '4.0',
            letterGrades: [
              { letter: 'A', minPercentage: 100, maxPercentage: 90, gpaPoints: 4.0, isPassing: true },
            ],
            categoryWeights: [{ categoryId: 'all', categoryName: 'All', weight: 100 }],
            roundingRule: 'nearest',
            minimumPassingGrade: 60,
          },
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should unset existing default when creating a new default policy', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [makeMockPolicy()],
        hasMore: false,
      });
      mockDynamoDBClient.updateItem.mockResolvedValue(undefined);

      await service.createGradingPolicy(
        {
          schoolId: 'school-001',
          policyName: 'New Default',
          gpaScale: '4.0',
          letterGrades: defaultGradingScale,
          categoryWeights: defaultCategoryWeights,
          roundingRule: 'nearest',
          minimumPassingGrade: 60,
          isDefault: true,
        },
        mockContext,
      );

      // Should unset existing default + create new
      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    });

    it('should publish GradingPolicyCreated event', async () => {
      await service.createGradingPolicy(
        {
          schoolId: 'school-001',
          policyName: 'Test Policy',
          gpaScale: '4.0',
          letterGrades: defaultGradingScale,
          categoryWeights: defaultCategoryWeights,
          roundingRule: 'nearest',
          minimumPassingGrade: 60,
        },
        mockContext,
      );

      expect(mockEventsService.publishEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          eventType: 'GradingPolicyCreated',
          schoolId: 'school-001',
          policyName: 'Test Policy',
        }),
      );
    });
  });

  // ------------------------------------------
  // getGradingPolicy
  // ------------------------------------------
  describe('getGradingPolicy', () => {
    it('should return a grading policy', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockPolicy());

      const result = await service.getGradingPolicy('policy-001', 'school-001', mockContext);

      expect(result.policyId).toBe('policy-001');
      expect(result.policyName).toBe('Standard Grading');
    });

    it('should throw NotFoundException if policy does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.getGradingPolicy('nonexistent', 'school-001', mockContext),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ------------------------------------------
  // listGradingPolicies
  // ------------------------------------------
  describe('listGradingPolicies', () => {
    it('should return active policies for a school', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [makeMockPolicy(), makeMockPolicy({ policyId: 'policy-002', policyName: 'Honors' })],
        hasMore: false,
      });

      const result = await service.listGradingPolicies('school-001', mockContext);

      expect(result).toHaveLength(2);
      expect(result[0].policyName).toBe('Standard Grading');
    });

    it('should return empty array if no policies exist', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.listGradingPolicies('school-001', mockContext);

      expect(result).toHaveLength(0);
    });
  });

  // ------------------------------------------
  // updateGradingPolicy
  // ------------------------------------------
  describe('updateGradingPolicy', () => {
    beforeEach(() => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockPolicy());
      mockDynamoDBClient.updateItem.mockResolvedValue(makeMockPolicy({ policyName: 'Updated Policy' }));
    });

    it('should update a grading policy', async () => {
      const result = await service.updateGradingPolicy(
        'policy-001',
        'school-001',
        { policyName: 'Updated Policy' },
        mockContext,
      );

      expect(result.policyName).toBe('Updated Policy');
      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
    });

    it('should throw NotFoundException if policy does not exist', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(null);

      await expect(
        service.updateGradingPolicy('nonexistent', 'school-001', { policyName: 'X' }, mockContext),
      ).rejects.toThrow(NotFoundException);
    });

    it('should validate weights when updating categoryWeights', async () => {
      await expect(
        service.updateGradingPolicy(
          'policy-001',
          'school-001',
          {
            categoryWeights: [
              { categoryId: 'hw', categoryName: 'Homework', weight: 50 },
              // Missing weight to reach 100
            ],
          },
          mockContext,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('should unset existing default when setting isDefault=true', async () => {
      mockDynamoDBClient.getItem.mockResolvedValue(makeMockPolicy({ isDefault: false }));
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [makeMockPolicy({ policyId: 'other-policy' })],
        hasMore: false,
      });
      mockDynamoDBClient.updateItem.mockResolvedValue(makeMockPolicy({ isDefault: true }));

      await service.updateGradingPolicy(
        'policy-001',
        'school-001',
        { isDefault: true },
        mockContext,
      );

      // 1 call to unset old default + 1 call to update this policy
      expect(mockDynamoDBClient.updateItem).toHaveBeenCalledTimes(2);
    });
  });

  // ------------------------------------------
  // getDefaultPolicyEntity
  // ------------------------------------------
  describe('getDefaultPolicyEntity', () => {
    it('should return the default policy for a school', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({
        items: [makeMockPolicy()],
        hasMore: false,
      });

      const result = await service.getDefaultPolicyEntity('school-001', mockContext);

      expect(result).toBeDefined();
      expect(result!.isDefault).toBe(true);
    });

    it('should return null if no default policy exists', async () => {
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });

      const result = await service.getDefaultPolicyEntity('school-001', mockContext);

      expect(result).toBeNull();
    });
  });
});
