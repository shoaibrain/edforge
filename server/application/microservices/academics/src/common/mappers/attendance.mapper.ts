/**
 * Attendance Mappers
 * 
 * Translates between DynamoDB entity fields and DTO fields.
 * Entity uses: note, reason, periodAttendance
 * DTO uses: notes, excuseReason, periodId/periodNumber
 */

import { Attendance, AttendanceSummary, PeriodAttendance } from '../entities/attendance.entity';
import type { AttendanceStatus } from '../entities/base.entity';
import {
  CreateAttendanceDto,
  UpdateAttendanceDto,
  AttendanceResponseDto,
  BulkAttendanceDto,
  BulkAttendanceResponseDto,
  DailyAttendanceSummaryDto,
  StudentAttendanceSummaryDto,
} from '@aibrains/shared-types';

// ============================================
// Entity to DTO Mappers
// ============================================

/**
 * Convert Attendance entity to AttendanceResponseDto
 */
export function attendanceEntityToDto(entity: Attendance, studentName?: string): AttendanceResponseDto {
  return {
    attendanceId: entity.attendanceId,
    studentId: entity.studentId,
    studentName: entity.studentName || studentName,
    schoolId: entity.schoolId,
    academicYearId: entity.academicYearId,
    date: entity.date,
    dayOfWeek: entity.dayOfWeek,
    status: entity.status,
    attendanceType: 'daily', // Default, can be computed from periodAttendance presence
    checkInTime: entity.checkInTime,
    checkOutTime: entity.checkOutTime,
    minutesLate: undefined, // Not stored in entity, would need computation
    minutesEarly: undefined,
    classroomId: entity.periodAttendance?.[0]?.courseId,
    periodId: undefined,
    periodNumber: entity.periodAttendance?.[0]?.periodNumber,
    excuseType: undefined, // Map from reason if structured
    excuseReason: entity.reason,  // reason -> excuseReason
    excuseDocumentUrl: undefined,
    notes: entity.note,  // note -> notes
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
 * Convert entity AttendanceSummary to StudentAttendanceSummaryDto
 */
export function attendanceSummaryEntityToDto(
  summary: AttendanceSummary,
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

// ============================================
// DTO to Entity Mappers
// ============================================

/**
 * Convert CreateAttendanceDto to entity fields
 * Returns fields that can be spread into createAttendanceEntity
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
  periodAttendance?: PeriodAttendance[];
  parentNotified?: boolean;
  parentNotifiedAt?: string;
} {
  return {
    status: dto.status as AttendanceStatus,
    academicYearId: dto.academicYearId || '',
    checkInTime: dto.checkInTime,
    checkOutTime: dto.checkOutTime,
    note: dto.notes,  // notes -> note
    reason: dto.excuseReason,  // excuseReason -> reason
    periodAttendance: dto.periodNumber ? [{
      periodNumber: dto.periodNumber,
      status: dto.status as AttendanceStatus,
    }] : undefined,
    parentNotified: dto.parentNotified,
    parentNotifiedAt: dto.parentNotifiedAt,
  };
}

/**
 * Convert UpdateAttendanceDto to entity fields
 */
export function updateAttendanceDtoToEntity(
  dto: UpdateAttendanceDto
): Partial<Attendance> {
  const updates: Partial<Attendance> = {};
  
  if (dto.status !== undefined) updates.status = dto.status;
  if (dto.checkInTime !== undefined) updates.checkInTime = dto.checkInTime;
  if (dto.checkOutTime !== undefined) updates.checkOutTime = dto.checkOutTime;
  if (dto.notes !== undefined) updates.note = dto.notes;  // notes -> note
  if (dto.excuseReason !== undefined) updates.reason = dto.excuseReason;  // excuseReason -> reason
  if (dto.parentNotified !== undefined) updates.parentNotified = dto.parentNotified;
  if (dto.parentNotifiedAt !== undefined) updates.parentNotifiedAt = dto.parentNotifiedAt;
  
  if (dto.periodNumber !== undefined) {
    updates.periodAttendance = [{
      periodNumber: dto.periodNumber,
      status: dto.status || 'present',
    }];
  }
  
  return updates;
}

// ============================================
// Summary/Report Mappers
// ============================================

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
