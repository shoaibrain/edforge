/**
 * Exam Mapper — Sprint A.3.2 + A.3.5
 *
 * Entity ↔ DTO translation. Shape mirrors course.mapper.ts convention.
 */

import { Exam } from '../entities/exam.entity';
import type { ExamResponseDto } from '@aibrains/shared-types';

export function examEntityToDto(entity: Exam): ExamResponseDto {
  return {
    examId: entity.examId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    examName: entity.examName,
    academicYearId: entity.academicYearId,
    termId: entity.termId,
    examType: entity.examType,
    startDate: entity.startDate,
    endDate: entity.endDate,
    status: entity.status,
    gradeLevels: entity.gradeLevels,
    description: entity.description,
    totalMaxMarks: entity.totalMaxMarks,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}
