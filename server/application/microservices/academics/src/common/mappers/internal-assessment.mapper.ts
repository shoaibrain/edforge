/**
 * InternalAssessment Mapper — Sprint D.3.2
 *
 * Strict entity → DTO mapper.
 */

import type { InternalAssessmentEntity } from '../entities/internal-assessment.entity';
import type { InternalAssessmentResponseDto } from '@aibrains/shared-types';

export function internalAssessmentEntityToDto(
  entity: InternalAssessmentEntity,
): InternalAssessmentResponseDto {
  return {
    assessmentId: entity.assessmentId,
    registrationId: entity.registrationId,
    studentId: entity.studentId,
    enrollmentId: entity.enrollmentId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    examType: entity.examType,
    courseId: entity.courseId,
    rubricCategoryId: entity.rubricCategoryId,
    score: entity.score,
    maxScore: entity.maxScore,
    status: entity.status,
    enteredBy: entity.enteredBy,
    enteredAt: entity.enteredAt,
    createdAt: entity.createdAt!,
    createdBy: entity.createdBy,
    updatedAt: entity.updatedAt!,
    updatedBy: entity.updatedBy,
  };
}
