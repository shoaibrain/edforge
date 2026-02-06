/**
 * Course Mappers
 *
 * Translates between DynamoDB Course entity and DTO fields.
 * The entity and DTO share the same field names for courses,
 * so mapping is mostly pass-through with field selection.
 */

import { Course } from '../entities/course.entity';
import {
  CourseResponseDto,
} from '@edforge/shared-types';

/**
 * Convert Course entity to CourseResponseDto
 */
export function courseEntityToDto(entity: Course): CourseResponseDto {
  return {
    courseId: entity.courseId,
    schoolId: entity.schoolId,
    tenantId: entity.tenantId,
    courseCode: entity.courseCode,
    courseName: entity.courseName,
    departmentId: entity.departmentId,
    departmentName: entity.departmentName,
    description: entity.description,
    objectives: entity.objectives,
    gradeLevels: entity.gradeLevels,
    credits: entity.credits,
    creditType: entity.creditType,
    subjectArea: entity.subjectArea,
    courseType: entity.courseType,
    prerequisites: entity.prerequisites,
    corequisites: entity.corequisites,
    typicalDuration: entity.typicalDuration,
    periodsPerWeek: entity.periodsPerWeek,
    isActive: entity.isActive,
    academicYearId: entity.academicYearId,
    standards: entity.standards,
    textbooks: entity.textbooks,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}
