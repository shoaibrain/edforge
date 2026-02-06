/**
 * Grading Policy Mapper
 *
 * Translates between GradingPolicyEntity and response DTO.
 */

import { GradingPolicyEntity } from '../entities/grading-policy.entity';

export interface GradingPolicyResponseDto {
  policyId: string;
  schoolId: string;
  tenantId: string;
  policyName: string;
  description?: string;
  gradingScale: {
    letter: string;
    minPercentage: number;
    maxPercentage: number;
    gpaPoints: number;
  }[];
  categoryWeights: {
    categoryId: string;
    categoryName: string;
    weight: number;
  }[];
  dropLowestScores?: { categoryId: string; count: number }[];
  roundingRule: string;
  minimumPassingGrade: number;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy: string;
  updatedBy: string;
}

export function gradingPolicyEntityToDto(entity: GradingPolicyEntity): GradingPolicyResponseDto {
  return {
    policyId: entity.policyId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    policyName: entity.policyName,
    description: entity.description,
    gradingScale: entity.gradingScale,
    categoryWeights: entity.categoryWeights,
    dropLowestScores: entity.dropLowestScores,
    roundingRule: entity.roundingRule,
    minimumPassingGrade: entity.minimumPassingGrade,
    isDefault: entity.isDefault,
    isActive: entity.isActive,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}
