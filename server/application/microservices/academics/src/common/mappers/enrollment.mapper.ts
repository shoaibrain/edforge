/**
 * Enrollment Mappers
 * 
 * Translates between DynamoDB entity fields and DTO fields.
 * Key mappings:
 * - Entity uses: enrolled status
 * - DTO uses: active status (but 'enrolled' now added to schema)
 * - TransferStudentDto uses: newSchoolId
 */

import { Enrollment } from '../entities/enrollment.entity';
import type { EnrollmentStatus as EntityEnrollmentStatus } from '../entities/base.entity';
import {
  CreateEnrollmentDto,
  UpdateEnrollmentDto,
  EnrollmentResponseDto,
  WithdrawStudentDto,
  TransferStudentDto,
  EnrollmentSummaryDto,
  EnrollmentStatus,
} from '@aibrains/shared-types';

// ============================================
// Entity to DTO Mappers
// ============================================

/**
 * Convert Enrollment entity to EnrollmentResponseDto
 */
export function enrollmentEntityToDto(
  entity: Enrollment,
  studentName?: string,
  schoolName?: string,
  academicYearName?: string,
  homeroomName?: string
): EnrollmentResponseDto {
  return {
    enrollmentId: entity.enrollmentId,
    studentId: entity.studentId,
    studentName: studentName,
    schoolId: entity.schoolId,
    schoolName: schoolName,
    tenantId: entity.tenantId,
    academicYearId: entity.academicYearId,
    academicYearName: academicYearName,
    gradeLevel: entity.gradeLevel,
    enrollmentType: entity.enrollmentType as any, // Compatible enum
    status: mapEntityStatusToDto(entity.status),
    enrollmentDate: entity.enrollmentDate,
    withdrawalDate: entity.withdrawalDate,
    expectedGraduationDate: undefined,
    actualGraduationDate: undefined,
    previousSchoolName: entity.previousSchoolName,
    previousSchoolAddress: undefined,
    transferReason: entity.transferReason,
    homeroomId: undefined, // Would need lookup
    homeroomName: homeroomName,
    sectionId: entity.sectionId,
    // Ed-Fi StudentSchoolAssociation fields
    entryGradeLevelDescriptor: entity.entryGradeLevelDescriptor,
    entryTypeDescriptor: entity.entryTypeDescriptor,
    enrollmentTypeDescriptor: entity.enrollmentTypeDescriptor,
    residencyStatusDescriptor: entity.residencyStatusDescriptor,
    primarySchool: entity.primarySchool,
    fullTimeEquivalency: entity.fullTimeEquivalency,
    repeatGradeIndicator: entity.repeatGradeIndicator,
    calendarCode: entity.calendarCode,
    exitWithdrawTypeDescriptor: entity.exitWithdrawTypeDescriptor,
    notes: entity.notes,
    createdAt: entity.createdAt!,
    updatedAt: entity.updatedAt!,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}

// ============================================
// DTO to Entity Mappers
// ============================================

/**
 * Convert CreateEnrollmentDto to entity fields
 */
export function createEnrollmentDtoToEntity(
  dto: CreateEnrollmentDto
): Partial<Enrollment> {
  return {
    gradeLevel: dto.gradeLevel,
    status: mapDtoStatusToEntity(dto.enrollmentType === 'new' ? 'pending' : 'enrolled'),
    enrollmentDate: dto.enrollmentDate,
    startDate: dto.enrollmentDate,
    enrollmentType: dto.enrollmentType as any,
    previousSchoolName: dto.previousSchoolName,
    transferReason: dto.transferReason,
    sectionId: dto.sectionId,
    notes: dto.notes,
    // Ed-Fi StudentSchoolAssociation fields
    entryGradeLevelDescriptor: dto.entryGradeLevelDescriptor,
    entryTypeDescriptor: dto.entryTypeDescriptor,
    enrollmentTypeDescriptor: dto.enrollmentTypeDescriptor,
    residencyStatusDescriptor: dto.residencyStatusDescriptor,
    primarySchool: dto.primarySchool ?? true,
    fullTimeEquivalency: dto.fullTimeEquivalency ?? 1.0,
    repeatGradeIndicator: dto.repeatGradeIndicator ?? false,
    calendarCode: dto.calendarCode,
  };
}

/**
 * Convert UpdateEnrollmentDto to entity fields
 */
export function updateEnrollmentDtoToEntity(
  dto: UpdateEnrollmentDto
): Partial<Enrollment> {
  const updates: Partial<Enrollment> = {};
  
  if (dto.gradeLevel !== undefined) updates.gradeLevel = dto.gradeLevel;
  if (dto.sectionId !== undefined) updates.sectionId = dto.sectionId;
  if (dto.notes !== undefined) updates.notes = dto.notes;
  
  return updates;
}

/**
 * Convert WithdrawStudentDto to entity fields
 */
export function withdrawDtoToEntity(dto: WithdrawStudentDto): Partial<Enrollment> {
  return {
    status: 'withdrawn',
    withdrawalDate: dto.withdrawalDate,
    endDate: dto.withdrawalDate,
    notes: dto.notes ? `Withdrawal: ${dto.reason}. ${dto.notes}` : `Withdrawal: ${dto.reason}`,
    exitWithdrawTypeDescriptor: dto.exitWithdrawTypeDescriptor,
  };
}

/**
 * Convert TransferStudentDto for transfer operation
 * Note: This returns data needed for the transfer, not entity fields directly
 */
export function transferDtoToTransferData(dto: TransferStudentDto): {
  toSchoolId: string;  // Map newSchoolId to toSchoolId for internal use
  effectiveDate: string;
  reason?: string;
  notes?: string;
  newGradeLevel?: string;
} {
  return {
    toSchoolId: dto.newSchoolId,  // newSchoolId -> toSchoolId
    effectiveDate: dto.effectiveDate,
    reason: dto.transferReason,
    notes: dto.notes,
    newGradeLevel: dto.newGradeLevel,
  };
}

// ============================================
// Status Mapping Helpers
// ============================================

/**
 * Map entity status to DTO status
 * Entity uses 'enrolled', DTO also accepts 'enrolled' (added to schema)
 */
function mapEntityStatusToDto(entityStatus: string): EnrollmentStatus {
  // Direct mapping - 'enrolled' is now in the schema
  return entityStatus as EnrollmentStatus;
}

/**
 * Map DTO status to entity status
 * If 'active' comes from frontend, convert to 'enrolled' for entity
 */
function mapDtoStatusToEntity(dtoStatus: EnrollmentStatus | string): EntityEnrollmentStatus {
  // 'active' is an alias for 'enrolled' in the entity
  if (dtoStatus === 'active') return 'enrolled';
  return dtoStatus as EntityEnrollmentStatus;
}

// ============================================
// Summary Mappers
// ============================================

/**
 * Create EnrollmentSummaryDto from aggregated data
 */
export function createEnrollmentSummary(
  schoolId: string,
  academicYearId: string,
  counts: {
    total: number;
    byGradeLevel: Record<string, number>;
    byStatus: Record<string, number>;
    recentEnrollments: number;
    recentWithdrawals: number;
  },
  schoolName?: string,
  academicYearName?: string
): EnrollmentSummaryDto {
  return {
    schoolId,
    schoolName,
    academicYearId,
    academicYearName,
    totalEnrolled: counts.total,
    byGradeLevel: counts.byGradeLevel,
    byStatus: counts.byStatus,
    recentEnrollments: counts.recentEnrollments,
    recentWithdrawals: counts.recentWithdrawals,
  };
}
