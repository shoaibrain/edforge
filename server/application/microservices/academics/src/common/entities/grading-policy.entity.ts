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
  GradingScaleEntry,
  CategoryWeight,
} from './grade.entity';

export interface GradingPolicyEntity extends BaseEntity {
  entityType: 'GRADEPOLICY';

  policyId: string;
  schoolId: string;
  policyName: string;
  description?: string;

  // Grading scale (letter → numeric range → GPA points)
  gradingScale: GradingScaleEntry[];

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
    gradingScale: GradingScaleEntry[];
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
    gradingScale: data.gradingScale,
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
