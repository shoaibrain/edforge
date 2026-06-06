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
  publishGradingPolicyCreated: jest.fn().mockResolvedValue(undefined),
  publishGradingPolicyUpdated: jest.fn().mockResolvedValue(undefined),
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

      expect(mockEventsService.publishGradingPolicyCreated).toHaveBeenCalledWith(
        'tenant-001',
        expect.any(String),
        'school-001',
        'Test Policy',
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

    it('seeds the archetype default when no policies exist (B.3 read-path seed)', async () => {
      // 1) list query → empty → triggers get-or-seed
      // 2) getDefaultPolicyEntity → queryActiveDefault → empty → ensureDefaultPolicy seeds
      // 3) re-query list → returns the seeded default (no more empty list)
      mockDynamoDBClient.queryGSI
        .mockResolvedValueOnce({ items: [], hasMore: false })
        .mockResolvedValueOnce({ items: [], hasMore: false })
        .mockResolvedValueOnce({ items: [makeMockPolicy()], hasMore: false });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);
      (service as any).getTenantMetadataReader = () => ({
        getArchetype: jest.fn().mockResolvedValue(undefined),
      });

      const result = await service.listGradingPolicies('school-001', mockContext);

      expect(result).toHaveLength(1);
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    });

    it('never returns [] even if the post-seed re-query stays empty (B.3 fallback)', async () => {
      // Pathological soft-deleted-default path: every query is empty, and the
      // seed's conditional write loses to the (inactive) existing row, so
      // ensureDefaultPolicy returns an in-memory entity. listGradingPolicies
      // must still surface that entity rather than an empty list.
      const condFail = Object.assign(new Error('The conditional request failed'), {
        name: 'ConditionalCheckFailedException',
      });
      mockDynamoDBClient.queryGSI
        .mockResolvedValueOnce({ items: [], hasMore: false }) // list
        .mockResolvedValueOnce({ items: [], hasMore: false }) // queryActiveDefault (pre-seed)
        .mockResolvedValueOnce({ items: [], hasMore: false }) // queryActiveDefault (lost-race recovery)
        .mockResolvedValueOnce({ items: [], hasMore: false }); // re-query list (still empty)
      mockDynamoDBClient.putItem.mockRejectedValueOnce(condFail);
      (service as any).getTenantMetadataReader = () => ({
        getArchetype: jest.fn().mockResolvedValue('PABSON'),
      });

      const result = await service.listGradingPolicies('school-001', mockContext);

      expect(result).toHaveLength(1);
      expect(result[0].letterGrades).toHaveLength(10); // PABSON CEHRD scale
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

    it('auto-seeds a default policy when none exists (D.1.3 lazy-seed)', async () => {
      // Pre-D.1.3 this returned null; getDefaultPolicyEntity now falls through to
      // ensureDefaultPolicy. With no archetype resolvable in-test, it seeds the
      // US-default scale rather than returning null.
      mockDynamoDBClient.queryGSI.mockResolvedValue({ items: [], hasMore: false });
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);
      (service as any).getTenantMetadataReader = () => ({
        getArchetype: jest.fn().mockResolvedValue(undefined),
      });

      const result = await service.getDefaultPolicyEntity('school-001', mockContext);

      expect(result).not.toBeNull();
      expect(result!.letterGrades.map((l) => l.letter)).toEqual(['A', 'B', 'C', 'D', 'F']);
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    });
  });

  // ------------------------------------------
  // D.1.3 — lazy-seed from ArchetypeDefaults
  // ------------------------------------------
  describe('D.1.3 — ensureDefaultPolicy lazy-seeds from archetype', () => {
    // The resolver is module-level inside the service; we stub its
    // factory method by reaching into the private field after construction.
    function stubResolver(svc: GradingPolicyService, archetype: string | undefined): void {
      const mockResolver = {
        getArchetype: jest.fn().mockResolvedValue(archetype),
      };

      (svc as any).getTenantMetadataReader = (): typeof mockResolver => mockResolver;
    }

    it('PABSON archetype → seeds 10-letter CEHRD scale incl. NG', async () => {
      stubResolver(service, 'PABSON');
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const policy = await service.ensureDefaultPolicy('school-001', mockContext);

      expect(policy.gpaScale).toBe('4.0');
      expect(policy.letterGrades).toHaveLength(10);
      const letters = policy.letterGrades.map((l) => l.letter);
      expect(letters).toEqual([
        'A+', 'A', 'B+', 'B', 'C+', 'C', 'D+', 'D', 'E', 'NG',
      ]);
      const ng = policy.letterGrades.find((l) => l.letter === 'NG');
      expect(ng).toBeDefined();
      expect(ng!.isPassing).toBe(false);
      expect(ng!.isTerminalFail).toBe(true);
      expect(ng!.gpaPoints).toBe(0);
      // P1.5a — PABSON default is the Division scheme (Saraswati's printed bands).
      expect(policy.schemeType).toBe('division');
      expect(policy.divisions?.map((d) => d.label)).toEqual([
        'Distinction', 'First Division', 'Second Division', 'Third Division',
      ]);
    });

    it('GENERIC archetype → seeds 5-letter US scale (letter_gpa scheme)', async () => {
      stubResolver(service, 'GENERIC');
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const policy = await service.ensureDefaultPolicy('school-001', mockContext);

      expect(policy.gpaScale).toBe('4.0');
      expect(policy.letterGrades).toHaveLength(5);
      expect(policy.letterGrades.map((l) => l.letter)).toEqual(['A', 'B', 'C', 'D', 'F']);
      expect(policy.schemeType).toBe('letter_gpa');
      expect(policy.divisions).toBeUndefined();
    });

    it('unknown archetype → falls back to US-default (no 5xx)', async () => {
      stubResolver(service, 'CBSE_IN');     // declared in master plan but not yet a profile
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const policy = await service.ensureDefaultPolicy('school-001', mockContext);

      expect(policy.letterGrades.map((l) => l.letter)).toEqual(['A', 'B', 'C', 'D', 'F']);
    });

    it('METADATA row missing (getArchetype→undefined) → falls back to US-default (no 5xx)', async () => {
      // getArchetype returns undefined for a genuinely-missing row (an expected
      // absence — not-yet-provisioned tenant). Service degrades quietly.
      stubResolver(service, undefined);
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const policy = await service.ensureDefaultPolicy('school-001', mockContext);

      expect(policy.letterGrades.map((l) => l.letter)).toEqual(['A', 'B', 'C', 'D', 'F']);
    });

    it('infra/permission failure (getArchetype THROWS) → logs ERROR + degrades, no 5xx', async () => {
      // The honest-degradation contract + the regression fence for the
      // 2026-06-04 GB2 silent-degradation class: getArchetype throws ONLY on an
      // infra error (AccessDenied/throttle), which must be logged loudly (ERROR,
      // not WARN) and degraded — never absorbed silently as "no archetype".
      const denied = Object.assign(
        new Error('User is not authorized to perform: dynamodb:GetItem'),
        { name: 'AccessDeniedException' },
      );
      const mockResolver = { getArchetype: jest.fn().mockRejectedValue(denied) };

      (service as any).getTenantMetadataReader = (): typeof mockResolver => mockResolver;
      const errorSpy = jest.spyOn((service as any).logger, 'error');
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const policy = await service.ensureDefaultPolicy('school-001', mockContext);

      // degraded to US-default rather than throwing the operator a 5xx
      expect(policy.letterGrades.map((l) => l.letter)).toEqual(['A', 'B', 'C', 'D', 'F']);
      // and logged at ERROR (the canary the smoke / log alarms watch)
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('identity-table read FAILED'),
      );
      errorSpy.mockRestore();
    });
  });

  // ------------------------------------------
  // B.2 — concurrency-safe seed (deterministic key + conditional write)
  // ------------------------------------------
  describe('B.2 — seed is concurrency-safe', () => {
    function stubResolver(svc: GradingPolicyService, archetype: string | undefined): void {
      const mockResolver = { getArchetype: jest.fn().mockResolvedValue(archetype) };
      (svc as any).getTenantMetadataReader = (): typeof mockResolver => mockResolver;
    }

    it('writes the seed with an attribute_not_exists conditional', async () => {
      stubResolver(service, 'PABSON');
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      await service.ensureDefaultPolicy('school-001', mockContext);

      expect(mockDynamoDBClient.putItem).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ isDefault: true }),
        'attribute_not_exists(entityKey)',
      );
    });

    it('uses a deterministic policyId — stable per school, distinct across schools', async () => {
      stubResolver(service, 'PABSON');
      mockDynamoDBClient.putItem.mockResolvedValue(undefined);

      const a = await service.ensureDefaultPolicy('school-001', mockContext);
      const b = await service.ensureDefaultPolicy('school-001', mockContext);
      const c = await service.ensureDefaultPolicy('school-002', mockContext);

      expect(a.policyId).toBe(b.policyId);
      expect(c.policyId).not.toBe(a.policyId);
    });

    it('lost seed race (ConditionalCheckFailed) → adopts the winner, no duplicate', async () => {
      stubResolver(service, 'PABSON');
      const condFail = Object.assign(new Error('The conditional request failed'), {
        name: 'ConditionalCheckFailedException',
      });
      mockDynamoDBClient.putItem.mockRejectedValueOnce(condFail);
      const winner = makeMockPolicy({ policyId: 'winner-policy', isDefault: true });
      mockDynamoDBClient.queryGSI.mockResolvedValueOnce({ items: [winner], hasMore: false });

      const policy = await service.ensureDefaultPolicy('school-001', mockContext);

      expect(policy.policyId).toBe('winner-policy');
      expect(mockDynamoDBClient.putItem).toHaveBeenCalledTimes(1);
    });

    it('re-throws a non-conditional putItem error (does not mask infra failures)', async () => {
      stubResolver(service, 'PABSON');
      const throttled = Object.assign(new Error('throughput exceeded'), {
        name: 'ProvisionedThroughputExceededException',
      });
      mockDynamoDBClient.putItem.mockRejectedValueOnce(throttled);

      await expect(
        service.ensureDefaultPolicy('school-001', mockContext),
      ).rejects.toThrow('throughput exceeded');
    });
  });
});
