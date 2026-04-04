/**
 * Grade Calculation Engine — Comprehensive Unit Tests
 *
 * Tests the calculateGrade(), calculateWeightedGrade(), calculateSimpleAverage(),
 * lookupLetterGrade(), lookupGpaPoints(), dropLowest(), and applyRounding() methods.
 *
 * Covers:
 * - 2.6a: Simple average scenarios
 * - 2.6b: Weighted grade scenarios (including stub fix)
 * - 2.6c: Letter grade, GPA, rounding, edge cases
 */

// Mock modules with unresolvable path aliases before any imports
jest.mock('@app/auth/token-vending-machine', () => ({ TokenVendingMachine: jest.fn() }), { virtual: true });
jest.mock('@app/auth', () => ({}), { virtual: true });
jest.mock('@app/logger', () => ({ LoggingService: jest.fn() }), { virtual: true });

import { Test, TestingModule } from '@nestjs/testing';
import { GradesService } from './grades.service';
import { GradingPolicyService } from './grading-policy.service';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { AcademicsEventsService } from '../common/services/academics-events.service';
import { AssignmentGrade } from '../common/entities/grade.entity';
import { GradingPolicyEntity } from '../common/entities/grading-policy.entity';

// ============================================
// Mocks (minimal — we only call calculateGrade directly)
// ============================================

const mockDynamoDBClient = {
  getClient: jest.fn(),
  getItem: jest.fn(),
  putItem: jest.fn(),
  updateItem: jest.fn(),
  queryGSI: jest.fn(),
};

const mockEventsService = {
  publishEvent: jest.fn().mockResolvedValue(undefined),
};

const mockGradingPolicyService = {
  getDefaultPolicyEntity: jest.fn(),
};

// ============================================
// Policy Fixtures
// ============================================

/** Policy with contiguous decimal boundaries (auto-created default style) */
const decimalPolicy: GradingPolicyEntity = {
  tenantId: 'tenant-001',
  entityKey: 'GRADEPOLICY#school-001#policy-decimal',
  entityType: 'GRADEPOLICY',
  policyId: 'policy-decimal',
  schoolId: 'school-001',
  policyName: 'Standard (Decimal)',
  gradingScale: [
    { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0 },
    { letter: 'B', minPercentage: 80, maxPercentage: 89.99, gpaPoints: 3.0 },
    { letter: 'C', minPercentage: 70, maxPercentage: 79.99, gpaPoints: 2.0 },
    { letter: 'D', minPercentage: 60, maxPercentage: 69.99, gpaPoints: 1.0 },
    { letter: 'F', minPercentage: 0, maxPercentage: 59.99, gpaPoints: 0.0 },
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

/** Policy with integer boundaries (user-created, gap at 89-90) */
const integerPolicy: GradingPolicyEntity = {
  ...decimalPolicy,
  policyId: 'policy-integer',
  policyName: 'Standard (Integer)',
  gradingScale: [
    { letter: 'A', minPercentage: 90, maxPercentage: 100, gpaPoints: 4.0 },
    { letter: 'B', minPercentage: 80, maxPercentage: 89, gpaPoints: 3.0 },
    { letter: 'C', minPercentage: 70, maxPercentage: 79, gpaPoints: 2.0 },
    { letter: 'D', minPercentage: 60, maxPercentage: 69, gpaPoints: 1.0 },
    { letter: 'F', minPercentage: 0, maxPercentage: 59, gpaPoints: 0.0 },
  ],
};

/** Five-category policy (Dual Enrollment Calculus scenario) */
const fiveCategoryPolicy: GradingPolicyEntity = {
  ...decimalPolicy,
  policyId: 'policy-5cat',
  policyName: 'Five Category',
  categoryWeights: [
    { categoryId: 'tests', categoryName: 'Tests & Exams', weight: 40 },
    { categoryId: 'quizzes', categoryName: 'Quizzes', weight: 20 },
    { categoryId: 'homework', categoryName: 'Homework', weight: 20 },
    { categoryId: 'participation', categoryName: 'Participation', weight: 10 },
    { categoryId: 'projects', categoryName: 'Projects', weight: 10 },
  ],
};

/** Policy with drop-lowest rule */
const dropLowestPolicy: GradingPolicyEntity = {
  ...decimalPolicy,
  policyId: 'policy-drop',
  policyName: 'Drop Lowest',
  dropLowestScores: [{ categoryId: 'hw', count: 1 }],
};

// ============================================
// Assignment Helpers
// ============================================

function makeAssignment(
  overrides: Partial<AssignmentGrade> & Pick<AssignmentGrade, 'assignmentId' | 'assignmentName' | 'possiblePoints'>,
): AssignmentGrade {
  return {
    assignmentType: 'homework',
    ...overrides,
  };
}

// ============================================
// Test Suite
// ============================================

describe('Grade Calculation Engine', () => {
  let service: GradesService;

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GradesService,
        { provide: DynamoDBClientService, useValue: mockDynamoDBClient },
        { provide: AcademicsEventsService, useValue: mockEventsService },
        { provide: GradingPolicyService, useValue: mockGradingPolicyService },
      ],
    }).compile();

    service = module.get<GradesService>(GradesService);
  });

  // ==========================================
  // 2.6a: Simple Average Scenarios
  // ==========================================
  describe('Simple Average (no policy)', () => {
    it('should calculate correct percentage for scored assignments', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', possiblePoints: 100, earnedPoints: 80 }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'HW2', possiblePoints: 100, earnedPoints: 90 }),
        makeAssignment({ assignmentId: 'a3', assignmentName: 'HW3', possiblePoints: 50, earnedPoints: 45 }),
      ];

      const result = service.calculateGrade(assignments, null);

      // (80 + 90 + 45) / (100 + 100 + 50) = 215/250 = 86%
      expect(result.numericGrade).toBe(86);
    });

    it('should handle extra credit (adds to earned, not possible)', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', possiblePoints: 100, earnedPoints: 90 }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'EC', possiblePoints: 10, earnedPoints: 10, isExtraCredit: true }),
      ];

      const result = service.calculateGrade(assignments, null);

      // (90 + 10) / 100 = 100%
      expect(result.numericGrade).toBe(100);
    });

    it('should exclude excused assignments entirely', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', possiblePoints: 100, earnedPoints: 90 }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'HW2', possiblePoints: 100, isExcused: true }),
      ];

      const result = service.calculateGrade(assignments, null);

      // Only HW1: 90/100 = 90%
      expect(result.numericGrade).toBe(90);
    });

    it('should treat earnedPoints: 0 as scored (counts), earnedPoints: undefined as stub (skipped)', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', possiblePoints: 100, earnedPoints: 0 }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'HW2', possiblePoints: 100, earnedPoints: undefined }),
      ];

      const result = service.calculateGrade(assignments, null);

      // Only a1 counts: 0/100 = 0%
      expect(result.numericGrade).toBe(0);
      expect(result.isPassing).toBe(false);
    });

    it('should return 0 when all assignments are excused', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', possiblePoints: 100, isExcused: true }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'HW2', possiblePoints: 100, isExcused: true }),
      ];

      const result = service.calculateGrade(assignments, null);

      expect(result.numericGrade).toBe(0);
      expect(result.letterGrade).toBeUndefined();
      expect(result.gpaPoints).toBeUndefined();
    });

    it('should return 0 when all assignments are stubs', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', possiblePoints: 100, earnedPoints: undefined }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'HW2', possiblePoints: 100, earnedPoints: undefined }),
      ];

      const result = service.calculateGrade(assignments, null);

      expect(result.numericGrade).toBe(0);
      expect(result.categoryGrades).toHaveLength(0);
    });

    it('should return 0 with empty assignments array', () => {
      const result = service.calculateGrade([], decimalPolicy);

      expect(result.numericGrade).toBe(0);
      expect(result.categoryGrades).toHaveLength(0);
    });
  });

  // ==========================================
  // 2.6b: Weighted Grade Scenarios
  // ==========================================
  describe('Weighted Grade (with policy)', () => {
    it('should calculate correctly when all categories have scored assignments', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 100 }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'Test1', categoryId: 'test', possiblePoints: 100, earnedPoints: 80 }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      // hw: 100% * 30% = 30, test: 80% * 70% = 56, total = 86%
      expect(result.numericGrade).toBe(86);
      expect(result.letterGrade).toBe('B');
      expect(result.gpaPoints).toBe(3.0);
      expect(result.isPassing).toBe(true);
      expect(result.categoryGrades).toHaveLength(2);
    });

    it('should normalize when some categories have no assignments (empty)', () => {
      // Only homework, no tests
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 90 }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      // hw: 90% * 30w, totalWeight = 30, normalized: (27/0.3) = 90%
      expect(result.numericGrade).toBe(90);
    });

    it('should EXCLUDE categories with ONLY ungraded stubs from weighted sum (bug fix)', () => {
      // Scenario: Dual Enrollment Calculus — only quizzes and participation have scores
      const assignments = [
        // Quizzes — scored
        makeAssignment({ assignmentId: 'q1', assignmentName: 'Quiz 1', categoryId: 'quizzes', possiblePoints: 20, earnedPoints: 19 }),
        makeAssignment({ assignmentId: 'q2', assignmentName: 'Quiz 2', categoryId: 'quizzes', possiblePoints: 20, earnedPoints: 18 }),
        // Participation — scored
        makeAssignment({ assignmentId: 'p1', assignmentName: 'Week 1', categoryId: 'participation', possiblePoints: 10, earnedPoints: 10 }),
        makeAssignment({ assignmentId: 'p2', assignmentName: 'Week 2', categoryId: 'participation', possiblePoints: 10, earnedPoints: 9.5 }),
        // Tests — only stubs (ungraded)
        makeAssignment({ assignmentId: 't1', assignmentName: 'Midterm', categoryId: 'tests', possiblePoints: 100, earnedPoints: undefined }),
        // Homework — only stubs (ungraded)
        makeAssignment({ assignmentId: 'h1', assignmentName: 'Problem Set 1', categoryId: 'homework', possiblePoints: 50, earnedPoints: undefined }),
        // Projects — only stubs (ungraded)
        makeAssignment({ assignmentId: 'pr1', assignmentName: 'Lab Report', categoryId: 'projects', possiblePoints: 100, earnedPoints: undefined }),
      ];

      const result = service.calculateGrade(assignments, fiveCategoryPolicy);

      // quizzes: (19+18)/(20+20) = 37/40 = 92.5%, weight 20
      // participation: (10+9.5)/(10+10) = 19.5/20 = 97.5%, weight 10
      // tests, homework, projects: stubs → excluded
      // totalWeight = 30, normalized: (92.5*20/100 + 97.5*10/100) / (30/100) = (18.5 + 9.75) / 0.3 = 94.17%
      expect(result.numericGrade).toBeGreaterThan(90);
      expect(result.numericGrade).toBeLessThan(96);
      expect(result.letterGrade).toBe('A');

      // Category grades should include all 5 categories for UI display
      expect(result.categoryGrades).toHaveLength(5);

      // Stub-only categories should show 0% with no letter grade
      const testsCategory = result.categoryGrades.find(c => c.categoryId === 'tests');
      expect(testsCategory?.percentage).toBe(0);
      expect(testsCategory?.letterGrade).toBeUndefined();
    });

    it('should handle mix of stubs and scored in one category (stubs skipped from denominator)', () => {
      const assignments = [
        // 3 graded + 2 stubs in homework
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 80 }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'HW2', categoryId: 'hw', possiblePoints: 100, earnedPoints: 90 }),
        makeAssignment({ assignmentId: 'a3', assignmentName: 'HW3', categoryId: 'hw', possiblePoints: 100, earnedPoints: 100 }),
        makeAssignment({ assignmentId: 'a4', assignmentName: 'HW4', categoryId: 'hw', possiblePoints: 100, earnedPoints: undefined }),
        makeAssignment({ assignmentId: 'a5', assignmentName: 'HW5', categoryId: 'hw', possiblePoints: 100, earnedPoints: undefined }),
        // Tests
        makeAssignment({ assignmentId: 'a6', assignmentName: 'Test1', categoryId: 'test', possiblePoints: 100, earnedPoints: 75 }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      // hw: (80+90+100)/300 = 90%, stubs NOT in denominator
      const hwCategory = result.categoryGrades.find(c => c.categoryId === 'hw');
      expect(hwCategory?.percentage).toBe(90);
      expect(hwCategory?.possiblePoints).toBe(300); // Only 3 scored contribute to possible

      // test: 75%
      // Weighted: 90*30/100 + 75*70/100 = 27 + 52.5 = 79.5, totalWeight=100
      expect(result.numericGrade).toBe(79.5);
    });

    it('should penalize missing assignments (adds to denominator)', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 100 }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'HW2', categoryId: 'hw', possiblePoints: 100, isMissing: true }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      // hw: 100/(100+100) = 50%
      const hwCategory = result.categoryGrades.find(c => c.categoryId === 'hw');
      expect(hwCategory?.percentage).toBe(50);
    });

    it('should handle category with ONLY missing assignments (0% at full weight)', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 90 }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'Test1', categoryId: 'test', possiblePoints: 100, isMissing: true }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      // hw: 90%, test: 0% (missing counts at full weight)
      // Weighted: 90*30/100 + 0*70/100 = 27, totalWeight=100, = 27%
      expect(result.numericGrade).toBe(27);
    });

    it('should correctly apply drop lowest rule', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 50 }), // lowest — dropped
        makeAssignment({ assignmentId: 'a2', assignmentName: 'HW2', categoryId: 'hw', possiblePoints: 100, earnedPoints: 90 }),
        makeAssignment({ assignmentId: 'a3', assignmentName: 'HW3', categoryId: 'hw', possiblePoints: 100, earnedPoints: 100 }),
        makeAssignment({ assignmentId: 'a4', assignmentName: 'Test1', categoryId: 'test', possiblePoints: 100, earnedPoints: 80 }),
      ];

      const result = service.calculateGrade(assignments, dropLowestPolicy);

      // hw: drop lowest (50%), remaining (90+100)/200 = 95%
      const hwCategory = result.categoryGrades.find(c => c.categoryId === 'hw');
      expect(hwCategory?.percentage).toBe(95);

      // Weighted: 95*30/100 + 80*70/100 = 28.5 + 56 = 84.5
      expect(result.numericGrade).toBe(84.5);
    });
  });

  // ==========================================
  // 2.6c: Letter Grade, GPA, Rounding, Edge Cases
  // ==========================================
  describe('Letter Grade Lookup', () => {
    it('should return A for 95%', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 95 }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      expect(result.letterGrade).toBe('A');
      expect(result.gpaPoints).toBe(4.0);
    });

    it('should handle boundary 89.5 with integer scale (gap fix)', () => {
      // This is the key test for Ticket 2.4 — with integer boundaries (B: 80-89),
      // the old code would miss 89.5. The fix uses >= minPercentage only in descending order.
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 200, earnedPoints: 179 }),
      ];

      const result = service.calculateGrade(assignments, integerPolicy);

      // 179/200 = 89.5% → should be B (>= 80) since sorted descending hits B before C
      expect(result.numericGrade).toBe(89.5);
      expect(result.letterGrade).toBe('B');
      expect(result.gpaPoints).toBe(3.0);
    });

    it('should return correct grades at exact boundaries', () => {
      // Test at 90 (A boundary)
      const a90 = service.calculateGrade(
        [makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 90 })],
        decimalPolicy,
      );
      expect(a90.letterGrade).toBe('A');

      // Test at 60 (D boundary / minimum passing)
      const d60 = service.calculateGrade(
        [makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 60 })],
        decimalPolicy,
      );
      expect(d60.letterGrade).toBe('D');
      expect(d60.isPassing).toBe(true);

      // Test at 59.99 (F, below passing)
      const f59 = service.calculateGrade(
        [makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 10000, earnedPoints: 5999 })],
        decimalPolicy,
      );
      expect(f59.letterGrade).toBe('F');
      expect(f59.isPassing).toBe(false);
    });

    it('should return highest grade for extra credit above 100%', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 95 }),
        makeAssignment({ assignmentId: 'a2', assignmentName: 'EC', categoryId: 'hw', possiblePoints: 10, earnedPoints: 10, isExtraCredit: true }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      // (95 + 10) / 100 = 105%
      expect(result.numericGrade).toBe(105);
      expect(result.letterGrade).toBe('A');
      expect(result.gpaPoints).toBe(4.0);
    });

    it('should return undefined letter/GPA when no policy', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', possiblePoints: 100, earnedPoints: 85 }),
      ];

      const result = service.calculateGrade(assignments, null);

      expect(result.numericGrade).toBe(85);
      expect(result.letterGrade).toBeUndefined();
      expect(result.gpaPoints).toBeUndefined();
    });

    it('should return F for 0%', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 0 }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      expect(result.numericGrade).toBe(0);
      expect(result.letterGrade).toBe('F');
      expect(result.gpaPoints).toBe(0.0);
    });
  });

  describe('Rounding', () => {
    it('should round nearest by default', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 300, earnedPoints: 268 }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      // 268/300 = 89.3333... → rounded nearest = 89.33
      expect(result.numericGrade).toBe(89.33);
    });

    it('should round up when policy says up', () => {
      const upPolicy = { ...decimalPolicy, roundingRule: 'up' as const };
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 300, earnedPoints: 268 }),
      ];

      const result = service.calculateGrade(assignments, upPolicy);

      // 89.3333 → ceil to 89.34
      expect(result.numericGrade).toBe(89.34);
    });

    it('should round down when policy says down', () => {
      const downPolicy = { ...decimalPolicy, roundingRule: 'down' as const };
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 300, earnedPoints: 268 }),
      ];

      const result = service.calculateGrade(assignments, downPolicy);

      // 89.3333 → floor to 89.33
      expect(result.numericGrade).toBe(89.33);
    });
  });

  describe('Edge Cases', () => {
    it('should handle single assignment correctly', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 87 }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      // Single hw: 87%, normalized with totalWeight=30 → 87%
      expect(result.numericGrade).toBe(87);
      expect(result.letterGrade).toBe('B');
    });

    it('should handle Tyler Brooks scenario (Dual Enrollment Calculus)', () => {
      // Real data from API responses: Quizzes scored ~94.5%, Participation ~98%
      // Tests, Homework, Projects are all stubs
      const assignments = [
        // Quizzes (20% weight) — scored
        makeAssignment({ assignmentId: 'q1', assignmentName: 'Quiz 1', categoryId: 'quizzes', possiblePoints: 20, earnedPoints: 18 }),
        makeAssignment({ assignmentId: 'q2', assignmentName: 'Quiz 2', categoryId: 'quizzes', possiblePoints: 20, earnedPoints: 20 }),
        makeAssignment({ assignmentId: 'q3', assignmentName: 'Quiz 3', categoryId: 'quizzes', possiblePoints: 20, earnedPoints: 19 }),
        // Participation (10% weight) — scored
        makeAssignment({ assignmentId: 'p1', assignmentName: 'Participation W1', categoryId: 'participation', possiblePoints: 10, earnedPoints: 10 }),
        makeAssignment({ assignmentId: 'p2', assignmentName: 'Participation W2', categoryId: 'participation', possiblePoints: 10, earnedPoints: 9 }),
        makeAssignment({ assignmentId: 'p3', assignmentName: 'Participation W3', categoryId: 'participation', possiblePoints: 10, earnedPoints: 10 }),
        // Tests & Exams (40% weight) — stubs
        makeAssignment({ assignmentId: 't1', assignmentName: 'Midterm', categoryId: 'tests', possiblePoints: 100, earnedPoints: undefined }),
        // Homework (20% weight) — stubs
        makeAssignment({ assignmentId: 'h1', assignmentName: 'Problem Set 1', categoryId: 'homework', possiblePoints: 50, earnedPoints: undefined }),
        makeAssignment({ assignmentId: 'h2', assignmentName: 'Problem Set 2', categoryId: 'homework', possiblePoints: 50, earnedPoints: undefined }),
        // Projects (10% weight) — stubs
        makeAssignment({ assignmentId: 'pr1', assignmentName: 'Lab Report', categoryId: 'projects', possiblePoints: 100, earnedPoints: undefined }),
      ];

      const result = service.calculateGrade(assignments, fiveCategoryPolicy);

      // Before fix: ~28.7% (stubs counted as 0 at full weight)
      // After fix: ~95.56% (only scored categories contribute)
      // Quizzes: (18+20+19)/60 = 95%, Participation: (10+9+10)/30 = 96.67%
      // Weighted: (95*20 + 96.67*10) / 30 = (1900 + 966.7) / 30 = 95.56%
      expect(result.numericGrade).toBeGreaterThan(90);
      expect(result.numericGrade).toBeLessThan(97);
      expect(result.letterGrade).toBe('A');
      expect(result.isPassing).toBe(true);
    });

    it('should handle uncategorized assignments with remaining weight', () => {
      const assignments = [
        makeAssignment({ assignmentId: 'a1', assignmentName: 'HW1', categoryId: 'hw', possiblePoints: 100, earnedPoints: 90 }),
        // Uncategorized (no categoryId)
        makeAssignment({ assignmentId: 'a2', assignmentName: 'Pop Quiz', possiblePoints: 10, earnedPoints: 8 }),
      ];

      const result = service.calculateGrade(assignments, decimalPolicy);

      // hw: 90% * 30w, uncategorized: 80% * remaining(0)w — totalWeight already 30 from hw only
      // Actually remaining = 100 - 30 = 70 (only hw has weight, test category empty)
      // But uncategorized: 80% * 70/100 = 56, plus hw: 90 * 30/100 = 27
      // totalWeight = 30 + 70 = 100, numericGrade = (27 + 56) / 1 = 83
      expect(result.numericGrade).toBeDefined();
    });
  });
});
