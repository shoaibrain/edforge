import { FeeStructureEntity } from '../entities/fee-structure.entity';
import type { FeeStructure } from '@aibrains/shared-types';

export function feeStructureEntityToDto(entity: FeeStructureEntity): FeeStructure {
  return {
    id: entity.feeStructureId,
    schoolId: entity.schoolId,
    name: entity.name,
    description: entity.description,
    academicYear: entity.academicYear,
    academicYearId: entity.academicYearId!,
    feeType: entity.feeType,
    amount: entity.amount,
    currency: entity.currency as FeeStructure['currency'],
    taxRate: entity.taxRate,
    taxType: entity.taxType,
    frequency: entity.frequency,
    gradeLevels: entity.gradeLevels,
    isActive: entity.isActive,
    autoApplyOnEnrollment: entity.autoApplyOnEnrollment ?? false,
    proRateOnMidTermEntry: entity.proRateOnMidTermEntry,
    effectiveFrom: entity.effectiveFrom,
    effectiveTo: entity.effectiveTo,
    version: entity.version,
    versionParentId: entity.versionParentId,
    templateParentId: entity.templateParentId,
    isOverride: entity.isOverride ?? false,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
