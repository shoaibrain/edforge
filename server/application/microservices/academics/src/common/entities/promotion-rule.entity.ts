/**
 * PromotionRule Entity — Sprint D.2.1
 *
 * Per-(school, gradeLevel) policy row governing the academic-year rollover
 * decision (promoted / retained / etc.). Ed-Fi V6 extension entity under
 * `edforge:PromotionPolicy` namespace.
 *
 * Key Structure (DynamoDB single-table; bare-UUID tenantId per memory
 * `edforge_identity_ddb_bare_uuid_partition_key`):
 *   - PK: tenantId (bare UUID stored; logical notation TENANT#{tid})
 *   - SK: PROMOTION_RULE#{schoolId}#{ruleId}
 *
 * GSI1 (school-scope; D.2.2 LIST queries):
 *   - GSI1PK: tenant#{tid}#school#{schoolId}    (lowercase per S3.2)
 *   - GSI1SK: promotion-rule#{gradeLevel}#{ruleId}
 *
 * **Soft-delete via `isActive`:** DELETE flips `isActive=false`; the row
 * stays in DDB for audit traceability. Active-only filter is applied at
 * the controller layer.
 *
 * **`archetypeDefaulted` flag:** True for rows written by the D.2.3 lazy-
 * seed path. Flipped to false on the first PATCH (D.2.2). Drives the
 * AdminWeb "Default" badge so operators can distinguish seeded from
 * operator-edited rules.
 *
 * @see docs/pilot-greenlight/d2-sprint-plan.md §4 D.2.1
 * @see packages/shared-types/src/schemas/academics/promotion-rule.schema.ts
 */

import {
  BaseEntity,
  EntityKeyBuilder,
} from './base.entity';
import type { AcademicSubjectDescriptor } from '@aibrains/shared-types';

export interface PromotionRuleEntity extends BaseEntity {
  entityType: 'PROMOTION_RULE';

  ruleId: string;
  schoolId: string;
  gradeLevel: string;
  archetypeId: string;
  passingThresholdPct: number;
  minAttendancePct: number;
  subjectsRequired: AcademicSubjectDescriptor[];
  /**
   * True when the row was written by the D.2.3 lazy-seed path AND has not
   * yet been operator-edited. Flipped to false on the first PATCH so the
   * AdminWeb "Default" badge dims after operator override.
   */
  archetypeDefaulted: boolean;
  description?: string;
  isActive: boolean;

  // GSI Keys (lowercase per S3.2)
  gsi1pk: string;  // tenant#{tid}#school#{schoolId}
  gsi1sk: string;  // promotion-rule#{gradeLevel}#{ruleId}
}

// ============================================================================
// GSI key builders (lowercase per S3.2)
// ============================================================================

export function promotionRuleSchoolGsi1pk(tenantId: string, schoolId: string): string {
  return `tenant#${tenantId}#school#${schoolId}`;
}

export function promotionRuleSchoolGsi1sk(gradeLevel: string, ruleId: string): string {
  return `promotion-rule#${gradeLevel}#${ruleId}`;
}

/**
 * Create a new PromotionRuleEntity with proper keys + audit timestamps.
 * Always emitted with `isActive: true`; soft-delete flips later via PATCH.
 */
export function createPromotionRuleEntity(
  tenantId: string,
  ruleId: string,
  schoolId: string,
  data: {
    gradeLevel: string;
    archetypeId: string;
    passingThresholdPct: number;
    minAttendancePct: number;
    subjectsRequired: AcademicSubjectDescriptor[];
    archetypeDefaulted: boolean;
    description?: string;
    createdBy: string;
  },
): PromotionRuleEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.promotionRule(schoolId, ruleId),
    entityType: 'PROMOTION_RULE',
    ruleId,
    schoolId,
    gradeLevel: data.gradeLevel,
    archetypeId: data.archetypeId,
    passingThresholdPct: data.passingThresholdPct,
    minAttendancePct: data.minAttendancePct,
    subjectsRequired: data.subjectsRequired,
    archetypeDefaulted: data.archetypeDefaulted,
    description: data.description,
    isActive: true,
    createdAt: now,
    createdBy: data.createdBy,
    updatedAt: now,
    updatedBy: data.createdBy,
    version: 1,
    gsi1pk: promotionRuleSchoolGsi1pk(tenantId, schoolId),
    gsi1sk: promotionRuleSchoolGsi1sk(data.gradeLevel, ruleId),
  };
}
