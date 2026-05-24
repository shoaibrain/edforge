/**
 * RubricCategory Entity — Sprint D.3.0
 *
 * Per-(school, examType) rubric category row holding the weight % of each
 * internal-assessment category. D.4.2 / D.5.x / D.6.x seed archetype
 * defaults via lazy-seed; D.3 ships shape only.
 *
 * Ed-Fi V6 alignment: `edforge:AssessmentItemRubric`.
 *
 * Keys (single-table; bare-UUID tenantId per memory
 * `edforge_identity_ddb_bare_uuid_partition_key`):
 *   - PK: tenantId
 *   - SK: RUBRIC_CATEGORY#{schoolId}#{categoryId}
 *
 * GSI1 (school-scope):
 *   - gsi1pk: tenant#{tid}#school#{schoolId}     (lowercase per S3.2)
 *   - gsi1sk: rubric-category#{examType}#{categoryId}
 *
 * @see docs/pilot-greenlight/d3-sprint-plan.md §4 D.3.0
 */

import { BaseEntity, EntityKeyBuilder } from './base.entity';
import type {
  AcademicSubjectDescriptor,
  ExamType,
} from '@aibrains/shared-types';

export interface RubricCategoryEntity extends BaseEntity {
  entityType: 'RUBRIC_CATEGORY';
  categoryId: string;
  schoolId: string;
  examType: ExamType;
  /** Undefined = "applies to all subjects" (e.g. participation, conduct). */
  academicSubject?: AcademicSubjectDescriptor;
  categoryName: string;
  weight: number;
  archetypeDefaultId?: string;
  archetypeDefaulted: boolean;
  cdcReference?: string;
  isActive: boolean;
  gsi1pk: string;
  gsi1sk: string;
}

export function rubricCategorySchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}

export function rubricCategorySchoolGsi1sk(examType: ExamType, categoryId: string): string {
  return `rubric-category#${examType}#${categoryId}`;
}

export function createRubricCategoryEntity(
  tenantId: string,
  categoryId: string,
  schoolId: string,
  data: {
    examType: ExamType;
    academicSubject?: AcademicSubjectDescriptor;
    categoryName: string;
    weight: number;
    archetypeDefaultId?: string;
    archetypeDefaulted: boolean;
    cdcReference?: string;
    createdBy: string;
  },
): RubricCategoryEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.rubricCategory(schoolId, categoryId),
    entityType: 'RUBRIC_CATEGORY',
    categoryId,
    schoolId,
    examType: data.examType,
    academicSubject: data.academicSubject,
    categoryName: data.categoryName,
    weight: data.weight,
    archetypeDefaultId: data.archetypeDefaultId,
    archetypeDefaulted: data.archetypeDefaulted,
    cdcReference: data.cdcReference,
    isActive: true,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: rubricCategorySchoolGsi1pk(tenantId, schoolId),
    gsi1sk: rubricCategorySchoolGsi1sk(data.examType, categoryId),
  };
}
