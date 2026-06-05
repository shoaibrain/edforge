/**
 * ResultCard Mapper — Sprint A.4.2 + A.4.4 + A.4.5
 *
 * Entity ↔ DTO translation. Shape mirrors exam.mapper.ts convention.
 */

import { ResultCard } from '../entities/result-card.entity';
import type { ResultCardResponseDto } from '@aibrains/shared-types';

export function resultCardEntityToDto(entity: ResultCard): ResultCardResponseDto {
  return {
    cardId: entity.cardId,
    tenantId: entity.tenantId,
    schoolId: entity.schoolId,
    enrollmentId: entity.enrollmentId,
    studentId: entity.studentId,
    studentIdentity: entity.studentIdentity,
    examId: entity.examId,
    termId: entity.termId,
    academicYearId: entity.academicYearId,
    courseScores: entity.courseScores,
    totalScore: entity.totalScore,
    totalMaxMarks: entity.totalMaxMarks,
    termGpa: entity.termGpa,
    overallGrade: entity.overallGrade,
    classRank: entity.classRank ?? null,
    sectionRank: entity.sectionRank ?? null,
    conduct: entity.conduct ?? null,
    classTeacherRemark: entity.classTeacherRemark ?? null,
    status: entity.status,
    publishedAt: entity.publishedAt ?? null,
    publishedBy: entity.publishedBy ?? null,
    isTerminalExam: entity.isTerminalExam,
    isActive: entity.isActive,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}
