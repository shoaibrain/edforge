/**
 * Grading Policy Entity for Academics Service
 *
 * School-level grading policy defining scale, category weights, and rules.
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: GRADEPOLICY#{schoolId}#{policyId}
 *
 * GSI1 (School scope - list policies):
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: GRADEPOLICY#{policyName}
 */

import {
  BaseEntity,
  EntityKeyBuilder,
  GSIKeyBuilder,
} from './base.entity';
import {
  LetterGradeEntry,
  CategoryWeight,
} from './grade.entity';

export interface GradingPolicyEntity extends BaseEntity {
  entityType: 'GRADEPOLICY';

  policyId: string;
  schoolId: string;
  policyName: string;
  description?: string;

  /**
   * GPA scale ceiling — `'4.0'` for US/Nepal CEHRD scales, `'5.0'` for
   * weighted-honors. Drives honors/AP cap math in gpa-calculator
   * (D.1.4). Required as of D.1.1.
   */
  gpaScale: '4.0' | '5.0';

  /**
   * Letter-grade table. Renamed from `letterGrades` in D.1.1 to align with
   * ArchetypeDefaults vocabulary. Each entry carries `isPassing`,
   * `isTerminalFail?` (for `NG` Not-Graded sentinel), `displayName?`.
   */
  letterGrades: LetterGradeEntry[];

  // Category weights (must sum to 100)
  categoryWeights: CategoryWeight[];

  // Drop lowest scores per category
  dropLowestScores?: { categoryId: string; count: number }[];

  // Calculation rules
  roundingRule: 'up' | 'down' | 'nearest';
  minimumPassingGrade: number;

  // Flags
  isDefault: boolean;
  isActive: boolean;

  // GSI Keys
  gsi1pk: string;
  gsi1sk: string;
}

/**
 * Create a new GradingPolicyEntity with proper keys
 */
export function createGradingPolicyEntity(
  tenantId: string,
  policyId: string,
  schoolId: string,
  data: {
    policyName: string;
    description?: string;
    gpaScale: '4.0' | '5.0';
    letterGrades: LetterGradeEntry[];
    categoryWeights: CategoryWeight[];
    dropLowestScores?: { categoryId: string; count: number }[];
    roundingRule: 'up' | 'down' | 'nearest';
    minimumPassingGrade: number;
    isDefault: boolean;
    createdBy: string;
  },
): GradingPolicyEntity {
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.gradingPolicy(schoolId, policyId),
    entityType: 'GRADEPOLICY' as const,
    policyId,
    schoolId,
    policyName: data.policyName,
    description: data.description,
    gpaScale: data.gpaScale,
    letterGrades: data.letterGrades,
    categoryWeights: data.categoryWeights,
    dropLowestScores: data.dropLowestScores,
    roundingRule: data.roundingRule,
    minimumPassingGrade: data.minimumPassingGrade,
    isDefault: data.isDefault,
    isActive: true,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `GRADEPOLICY#${data.policyName.toUpperCase()}`,
  };
}
