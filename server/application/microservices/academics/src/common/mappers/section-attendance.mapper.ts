/**
 * Section Attendance Mappers
 *
 * Translates between SectionAttendance DynamoDB entity and section attendance DTOs.
 * Entity uses: note, reason
 * DTO uses: notes, excuseReason
 */

import { SectionAttendance } from '../entities/section-attendance.entity';
import type {
  SectionAttendanceResponseDto,
  BulkSectionAttendanceResponseDto,
} from '@aibrains/shared-types';

/**
 * Convert SectionAttendance entity to SectionAttendanceResponseDto
 */
export function sectionAttendanceEntityToDto(
  entity: SectionAttendance,
  studentName?: string,
): SectionAttendanceResponseDto {
  return {
    sectionAttendanceId: entity.sectionAttendanceId,
    studentId: entity.studentId,
    studentName: entity.studentName || studentName,
    schoolId: entity.schoolId,
    sectionId: entity.sectionId,
    courseName: entity.courseName,
    courseCode: entity.courseCode,
    academicYearId: entity.academicYearId,
    date: entity.date,
    dayOfWeek: entity.dayOfWeek,
    status: entity.status,
    attendanceEventCategory: entity.attendanceEventCategory,
    attendanceEventReason: entity.attendanceEventReason,
    educationalEnvironment: entity.educationalEnvironment,
    checkInTime: entity.checkInTime,
    checkOutTime: entity.checkOutTime,
    durationMinutes: entity.sectionAttendanceDuration,
    excuseType: undefined, // mapped from reason structure in Sprint 4
    excuseReason: entity.reason,
    notes: entity.note,
    parentNotified: entity.parentNotified ?? false,
    parentNotifiedAt: entity.parentNotifiedAt,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
    version: entity.version,
  };
}

/**
 * Create BulkSectionAttendanceResponseDto
 */
export function createBulkSectionAttendanceResponse(
  date: string,
  schoolId: string,
  sectionId: string,
  results: {
    created: number;
    updated: number;
    errors: Array<{ studentId: string; error: string }>;
  },
): BulkSectionAttendanceResponseDto {
  return {
    success: results.errors.length === 0,
    date,
    schoolId,
    sectionId,
    totalProcessed: results.created + results.updated + results.errors.length,
    recordsCreated: results.created,
    recordsUpdated: results.updated,
    errors: results.errors,
  };
}
