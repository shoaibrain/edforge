import { FeeStructureEntity } from '../entities/fee-structure.entity';
import type { FeeStructure } from '@aibrains/shared-types';

export function feeStructureEntityToDto(entity: FeeStructureEntity): FeeStructure {
  return {
    id: entity.feeStructureId,
    schoolId: entity.schoolId,
    name: entity.name,
    description: entity.description,
    academicYear: entity.academicYear,
    feeType: entity.feeType,
    amount: entity.amount,
    currency: entity.currency,
    taxRate: entity.taxRate,
    taxType: entity.taxType,
    frequency: entity.frequency,
    gradeLevels: entity.gradeLevels,
    isActive: entity.isActive,
    autoApplyOnEnrollment: entity.autoApplyOnEnrollment ?? false,
    effectiveFrom: entity.effectiveFrom,
    effectiveTo: entity.effectiveTo,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
