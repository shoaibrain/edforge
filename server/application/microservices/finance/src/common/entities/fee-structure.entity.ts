/**
 * Fee Structure Entity
 *
 * DynamoDB entity for school fee structures.
 * PK: tenantId
 * SK: FEE_STRUCTURE#{schoolId}#{feeStructureId}
 * GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI1SK: FEE_STRUCTURE#{feeType}#{name}
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';
import type { FeeType, FeeFrequency, TaxType } from '@aibrains/shared-types';

export interface DueDateRule {
  type: 'days_after_enrollment' | 'fixed_day_of_month' | 'on_enrollment';
  days?: number;
  dayOfMonth?: number;
}

export interface FeeStructureEntity extends BaseEntity {
  entityType: 'FEE_STRUCTURE';
  feeStructureId: string;
  schoolId: string;
  name: string;
  description?: string;
  academicYear: string;
  academicYearId?: string;
  feeType: FeeType;
  amount: number;
  currency: string;
  taxRate: number;
  taxType: TaxType;
  frequency: FeeFrequency;
  gradeLevels: string[];
  isActive: boolean;
  autoApplyOnEnrollment?: boolean;
  proRateOnMidTermEntry?: boolean;
  versionParentId?: string;
  templateParentId?: string;
  isOverride?: boolean;
  effectiveFrom: string;
  effectiveTo?: string;
  dueDateRule?: DueDateRule;
  enrollmentTypes?: ('new_admission' | 'transfer' | 'returning' | 're_enrollment')[];

  // GSI keys
  gsi1pk: string;
  gsi1sk: string;
}

export function createFeeStructureEntity(
  tenantId: string,
  schoolId: string,
  data: {
    name: string;
    description?: string;
    academicYear: string;
    academicYearId: string;
    feeType: FeeType;
    amount: number;
    currency?: string;
    taxRate?: number;
    taxType?: TaxType;
    frequency: FeeFrequency;
    gradeLevels?: string[];
    autoApplyOnEnrollment?: boolean;
    proRateOnMidTermEntry?: boolean;
    effectiveFrom: string;
    effectiveTo?: string;
    dueDateRule?: DueDateRule;
    enrollmentTypes?: ('new_admission' | 'transfer' | 'returning' | 're_enrollment')[];
  },
  userId: string,
): FeeStructureEntity {
  const feeStructureId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.feeStructure(schoolId, feeStructureId),
    entityType: 'FEE_STRUCTURE',
    feeStructureId,
    schoolId,
    name: data.name,
    description: data.description,
    academicYear: data.academicYear,
    academicYearId: data.academicYearId,
    feeType: data.feeType,
    amount: data.amount,
    currency: data.currency || 'NPR',
    taxRate: data.taxRate ?? 0,
    taxType: data.taxType || 'none',
    frequency: data.frequency,
    gradeLevels: data.gradeLevels || [],
    isActive: true,
    autoApplyOnEnrollment: data.autoApplyOnEnrollment ?? false,
    proRateOnMidTermEntry: data.proRateOnMidTermEntry ?? false,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo,
    dueDateRule: data.dueDateRule,
    enrollmentTypes: data.enrollmentTypes ?? [],

    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('FEE_STRUCTURE', `${data.feeType}#${data.name.toUpperCase()}`),

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
