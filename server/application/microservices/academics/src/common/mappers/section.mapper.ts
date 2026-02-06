/**
 * Section Mappers
 *
 * Translates between DynamoDB CourseSection entity and DTO fields.
 */

import { CourseSection } from '../entities/course.entity';
import { SectionResponseDto } from '@edforge/shared-types';

/**
 * Convert CourseSection entity to SectionResponseDto
 */
export function sectionEntityToDto(entity: CourseSection): SectionResponseDto {
  return {
    sectionId: entity.sectionId,
    tenantId: entity.tenantId,
    courseId: entity.courseId,
    courseCode: entity.courseCode,
    courseName: entity.courseName,
    schoolId: entity.schoolId,
    academicYearId: entity.academicYearId,
    termId: entity.termId,
    sectionNumber: entity.sectionNumber,
    sectionName: entity.sectionName,
    primaryTeacherId: entity.primaryTeacherId,
    primaryTeacherName: entity.primaryTeacherName,
    coTeacherIds: entity.coTeacherIds,
    roomId: entity.roomId,
    roomNumber: entity.roomNumber,
    maxEnrollment: entity.maxEnrollment,
    currentEnrollment: entity.currentEnrollment,
    isActive: entity.isActive,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}
