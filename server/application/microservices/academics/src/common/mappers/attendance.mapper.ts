/**
 * Attendance Mappers (School-Level)
 *
 * Translates between SchoolAttendance DynamoDB entity and DTO fields.
 * Entity uses: note, reason
 * DTO uses: notes, excuseReason
 */

import { SchoolAttendance } from '../entities/school-attendance.entity';
import type { AttendanceStatus } from '../entities/base.entity';
import {
  CreateAttendanceDto,
  UpdateAttendanceDto,
  AttendanceResponseDto,
  BulkAttendanceResponseDto,
  DailyAttendanceSummaryDto,
  StudentAttendanceSummaryDto,
} from '@aibrains/shared-types';

// ============================================
// Entity to DTO Mappers
// ============================================

/**
 * Convert SchoolAttendance entity to AttendanceResponseDto
 */
export function attendanceEntityToDto(entity: SchoolAttendance, studentName?: string): AttendanceResponseDto {
  return {
    attendanceId: entity.schoolAttendanceId,
    studentId: entity.studentId,
    studentName: entity.studentName || studentName,
    schoolId: entity.schoolId,
    academicYearId: entity.academicYearId,
    date: entity.date,
    dayOfWeek: entity.dayOfWeek,
    status: entity.status,
    attendanceType: 'daily',
    checkInTime: entity.checkInTime,
    checkOutTime: entity.checkOutTime,
    minutesLate: undefined,
    minutesEarly: undefined,
    classroomId: undefined,
    periodId: undefined,
    periodNumber: undefined,
    sectionId: undefined,
    courseName: undefined,
    excuseType: undefined,
    excuseReason: entity.reason,
    excuseDocumentUrl: undefined,
    notes: entity.note,
    parentNotified: entity.parentNotified ?? false,
    parentNotifiedAt: entity.parentNotifiedAt,
    locationVerified: false,
    createdAt: entity.createdAt!,
    updatedAt: entity.updatedAt!,
    createdBy: entity.createdBy,
    updatedBy: entity.updatedBy,
  };
}

/**
 * Convert CreateAttendanceDto to SchoolAttendance entity fields
 */
export function createAttendanceDtoToEntity(
  dto: CreateAttendanceDto
): {
  status: AttendanceStatus;
  academicYearId: string;
  checkInTime?: string;
  checkOutTime?: string;
  note?: string;
  reason?: string;
  parentNotified?: boolean;
  parentNotifiedAt?: string;
} {
  return {
    status: dto.status as AttendanceStatus,
    academicYearId: dto.academicYearId || '',
    checkInTime: dto.checkInTime,
    checkOutTime: dto.checkOutTime,
    note: dto.notes,
    reason: dto.excuseReason,
    parentNotified: dto.parentNotified,
    parentNotifiedAt: dto.parentNotifiedAt,
  };
}

/**
 * Convert UpdateAttendanceDto to entity fields
 */
export function updateAttendanceDtoToEntity(
  dto: UpdateAttendanceDto
): Partial<SchoolAttendance> {
  const updates: Partial<SchoolAttendance> = {};

  if (dto.status !== undefined) updates.status = dto.status;
  if (dto.checkInTime !== undefined) updates.checkInTime = dto.checkInTime;
  if (dto.checkOutTime !== undefined) updates.checkOutTime = dto.checkOutTime;
  if (dto.notes !== undefined) updates.note = dto.notes;
  if (dto.excuseReason !== undefined) updates.reason = dto.excuseReason;
  if (dto.parentNotified !== undefined) updates.parentNotified = dto.parentNotified;
  if (dto.parentNotifiedAt !== undefined) updates.parentNotifiedAt = dto.parentNotifiedAt;

  return updates;
}

// ============================================
// Summary/Report Mappers
// ============================================

/**
 * Convert entity AttendanceSummary to StudentAttendanceSummaryDto
 */
export function attendanceSummaryEntityToDto(
  summary: { studentId: string; schoolId: string; academicYearId: string; totalDays: number; present: number; absent: number; late: number; excused: number; halfDay: number; attendanceRate: number; dateRange: { start: string; end: string } },
  studentName: string
): StudentAttendanceSummaryDto {
  return {
    studentId: summary.studentId,
    studentName: studentName,
    schoolId: summary.schoolId,
    academicYearId: summary.academicYearId,
    totalDays: summary.totalDays,
    present: summary.present,
    absent: summary.absent,
    late: summary.late,
    excused: summary.excused,
    halfDay: summary.halfDay,
    attendanceRate: summary.attendanceRate,
    dateRange: {
      start: summary.dateRange.start,
      end: summary.dateRange.end,
    },
  };
}

/**
 * Create DailyAttendanceSummaryDto from aggregated counts
 */
export function createDailyAttendanceSummary(
  date: string,
  schoolId: string,
  counts: {
    totalStudents: number;
    present: number;
    absent: number;
    late: number;
    excused: number;
    halfDay: number;
  },
  byGradeLevel?: Record<string, { total: number; present: number; absent: number; rate: number }>
): DailyAttendanceSummaryDto {
  const attendanceRate = counts.totalStudents > 0
    ? Math.round((counts.present / counts.totalStudents) * 100 * 100) / 100
    : 0;

  return {
    date,
    schoolId,
    totalStudents: counts.totalStudents,
    present: counts.present,
    absent: counts.absent,
    late: counts.late,
    excused: counts.excused,
    halfDay: counts.halfDay,
    attendanceRate,
    byGradeLevel,
  };
}

/**
 * Create BulkAttendanceResponseDto
 */
export function createBulkAttendanceResponse(
  date: string,
  schoolId: string,
  results: {
    created: number;
    updated: number;
    errors: Array<{ studentId: string; error: string }>;
  }
): BulkAttendanceResponseDto {
  return {
    success: results.errors.length === 0,
    date,
    schoolId,
    totalProcessed: results.created + results.updated + results.errors.length,
    recordsCreated: results.created,
    recordsUpdated: results.updated,
    errors: results.errors,
  };
}
