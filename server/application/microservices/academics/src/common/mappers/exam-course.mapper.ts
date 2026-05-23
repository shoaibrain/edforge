/**
 * ExamCourse Mapper — Sprint A.3.3 + A.3.6
 */

import { ExamCourse } from '../entities/exam-course.entity';
import type { ExamCourseResponseDto } from '@aibrains/shared-types';

export function examCourseEntityToDto(entity: ExamCourse): ExamCourseResponseDto {
  return {
    examCourseId: entity.examCourseId,
    examId: entity.examId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    courseId: entity.courseId,
    courseName: entity.courseName,
    courseCode: entity.courseCode,
    academicSubject: entity.academicSubject,
    maxMarks: entity.maxMarks,
    passingMarks: entity.passingMarks,
    creditHours: entity.creditHours,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}
