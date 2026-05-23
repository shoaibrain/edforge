/**
 * ExamScore Mapper — Sprint A.3.4 + A.3.7
 */

import { ExamScore } from '../entities/exam-score.entity';
import type { ExamScoreResponseDto } from '@aibrains/shared-types';

export function examScoreEntityToDto(entity: ExamScore): ExamScoreResponseDto {
  return {
    examScoreId: entity.examScoreId,
    examId: entity.examId,
    examCourseId: entity.examCourseId,
    enrollmentId: entity.enrollmentId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    studentId: entity.studentId,
    rawScore: entity.rawScore,
    status: entity.status,
    correlationId: entity.correlationId,
    enteredBy: entity.enteredBy,
    enteredAt: entity.enteredAt,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
