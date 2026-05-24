/**
 * RubricCategory Mapper — Sprint D.3.0
 *
 * Translates RubricCategoryEntity (DDB shape) → RubricCategoryResponseDto
 * (`@aibrains/shared-types`). Strict mapper — no NaN/""/"unknown" fallbacks.
 */

import type { RubricCategoryEntity } from '../entities/rubric-category.entity';
import type { RubricCategoryResponseDto } from '@aibrains/shared-types';

export function rubricCategoryEntityToDto(entity: RubricCategoryEntity): RubricCategoryResponseDto {
  return {
    categoryId: entity.categoryId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    examType: entity.examType,
    academicSubject: entity.academicSubject ?? null,
    categoryName: entity.categoryName,
    weight: entity.weight,
    archetypeDefaultId: entity.archetypeDefaultId ?? null,
    archetypeDefaulted: entity.archetypeDefaulted,
    cdcReference: entity.cdcReference ?? null,
    isActive: entity.isActive,
    createdAt: entity.createdAt!,
    createdBy: entity.createdBy,
    updatedAt: entity.updatedAt!,
    updatedBy: entity.updatedBy,
  };
}
