/**
 * Grade Mapper
 *
 * Translates between Grade entity and response DTO.
 */

import { Grade } from '../entities/grade.entity';

export interface GradeResponseDto {
  gradeId: string;
  studentId: string;
  schoolId: string;
  courseId: string;
  sectionId?: string;
  teacherId: string;
  academicYearId: string;
  termId: string;
  numericGrade?: number;
  letterGrade?: string;
  gpaPoints?: number;
  credits?: number;
  categoryGrades?: {
    categoryId: string;
    categoryName: string;
    weight: number;
    earnedPoints: number;
    possiblePoints: number;
    percentage: number;
    letterGrade?: string;
  }[];
  assignments?: {
    assignmentId: string;
    assignmentName: string;
    assignmentType: string;
    categoryId?: string;
    dueDate?: string;
    earnedPoints?: number;
    possiblePoints: number;
    percentage?: number;
    letterGrade?: string;
    isExtraCredit?: boolean;
    isDropped?: boolean;
    isMissing?: boolean;
    isExcused?: boolean;
    comment?: string;
    gradedAt?: string;
  }[];
  isFinal: boolean;
  isPassFail?: boolean;
  isPassing?: boolean;
  teacherComment?: string;
  lastCalculatedAt?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export function gradeEntityToDto(entity: Grade): GradeResponseDto {
  return {
    gradeId: entity.gradeId,
    studentId: entity.studentId,
    schoolId: entity.schoolId,
    courseId: entity.courseId,
    sectionId: entity.sectionId,
    teacherId: entity.teacherId,
    academicYearId: entity.academicYearId,
    termId: entity.termId,
    numericGrade: entity.numericGrade,
    letterGrade: entity.letterGrade,
    gpaPoints: entity.gpaPoints,
    credits: entity.credits,
    categoryGrades: entity.categoryGrades,
    assignments: entity.assignments?.map(a => ({
      assignmentId: a.assignmentId,
      assignmentName: a.assignmentName,
      assignmentType: a.assignmentType,
      categoryId: a.categoryId,
      dueDate: a.dueDate,
      earnedPoints: a.earnedPoints,
      possiblePoints: a.possiblePoints,
      percentage: a.percentage,
      letterGrade: a.letterGrade,
      isExtraCredit: a.isExtraCredit,
      isDropped: a.isDropped,
      isMissing: a.isMissing,
      isExcused: a.isExcused,
      comment: a.comment,
      gradedAt: a.gradedAt,
    })),
    isFinal: entity.isFinal,
    isPassFail: entity.isPassFail,
    isPassing: entity.isPassing,
    teacherComment: entity.teacherComment,
    lastCalculatedAt: entity.lastCalculatedAt,
    publishedAt: entity.publishedAt,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  };
}
