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

export interface FeeStructureEntity extends BaseEntity {
  entityType: 'FEE_STRUCTURE';
  feeStructureId: string;
  schoolId: string;
  name: string;
  description?: string;
  academicYear: string;
  feeType: FeeType;
  amount: number;
  currency: 'NPR';
  taxRate: number;
  taxType: TaxType;
  frequency: FeeFrequency;
  gradeLevels: string[];
  isActive: boolean;
  autoApplyOnEnrollment?: boolean;
  effectiveFrom: string;
  effectiveTo?: string;

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
    feeType: FeeType;
    amount: number;
    currency?: 'NPR';
    taxRate?: number;
    taxType?: TaxType;
    frequency: FeeFrequency;
    gradeLevels?: string[];
    autoApplyOnEnrollment?: boolean;
    effectiveFrom: string;
    effectiveTo?: string;
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
    feeType: data.feeType,
    amount: data.amount,
    currency: data.currency || 'NPR',
    taxRate: data.taxRate ?? 0,
    taxType: data.taxType || 'none',
    frequency: data.frequency,
    gradeLevels: data.gradeLevels || [],
    isActive: true,
    autoApplyOnEnrollment: data.autoApplyOnEnrollment ?? false,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo,

    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('FEE_STRUCTURE', `${data.feeType}#${data.name.toUpperCase()}`),

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
