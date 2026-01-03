/**
 * Attendance DTOs for Academics Service
 */

import { 
  IsNotEmpty, 
  IsString, 
  IsOptional, 
  IsEnum,
  IsArray,
  IsDateString,
  ValidateNested,
  IsNumber,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AttendanceStatus } from '../entities/base.entity';

/**
 * Record Single Attendance DTO
 */
export class RecordAttendanceDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsNotEmpty()
  academicYearId: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsEnum(['present', 'absent', 'late', 'excused', 'half_day'])
  @IsNotEmpty()
  status: AttendanceStatus;

  @IsString()
  @IsOptional()
  checkInTime?: string;

  @IsString()
  @IsOptional()
  checkOutTime?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PeriodAttendanceDto)
  @IsOptional()
  periodAttendance?: PeriodAttendanceDto[];
}

/**
 * Period Attendance DTO
 */
export class PeriodAttendanceDto {
  @IsNumber()
  @Min(1)
  @Max(12)
  periodNumber: number;

  @IsString()
  @IsOptional()
  periodName?: string;

  @IsString()
  @IsOptional()
  courseId?: string;

  @IsString()
  @IsOptional()
  teacherId?: string;

  @IsEnum(['present', 'absent', 'late', 'excused', 'half_day'])
  @IsNotEmpty()
  status: AttendanceStatus;

  @IsString()
  @IsOptional()
  note?: string;
}

/**
 * Bulk Attendance DTO
 */
export class BulkAttendanceDto {
  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsNotEmpty()
  academicYearId: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BulkAttendanceRecordDto)
  @IsNotEmpty()
  records: BulkAttendanceRecordDto[];
}

/**
 * Bulk Attendance Record DTO
 */
export class BulkAttendanceRecordDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsEnum(['present', 'absent', 'late', 'excused', 'half_day'])
  @IsNotEmpty()
  status: AttendanceStatus;

  @IsString()
  @IsOptional()
  checkInTime?: string;

  @IsString()
  @IsOptional()
  note?: string;
}

/**
 * Update Attendance DTO
 */
export class UpdateAttendanceDto {
  @IsEnum(['present', 'absent', 'late', 'excused', 'half_day'])
  @IsOptional()
  status?: AttendanceStatus;

  @IsString()
  @IsOptional()
  checkInTime?: string;

  @IsString()
  @IsOptional()
  checkOutTime?: string;

  @IsString()
  @IsOptional()
  note?: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PeriodAttendanceDto)
  @IsOptional()
  periodAttendance?: PeriodAttendanceDto[];
}

/**
 * Attendance Response DTO
 */
export class AttendanceResponseDto {
  attendanceId: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  date: string;
  dayOfWeek: number;
  status: AttendanceStatus;
  checkInTime?: string;
  checkOutTime?: string;
  periodAttendance?: PeriodAttendanceDto[];
  note?: string;
  reason?: string;
  recordedBy: string;
  verifiedBy?: string;
  parentNotified?: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Attendance List Response DTO
 */
export class AttendanceListResponseDto {
  items: AttendanceResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Daily Attendance Summary DTO
 */
export class DailyAttendanceSummaryDto {
  schoolId: string;
  date: string;
  totalStudents: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  halfDay: number;
  attendanceRate: number;
  byGradeLevel?: Record<string, {
    total: number;
    present: number;
    absent: number;
    rate: number;
  }>;
}

/**
 * Student Attendance Summary DTO
 */
export class StudentAttendanceSummaryDto {
  studentId: string;
  schoolId: string;
  academicYearId: string;
  termId?: string;
  dateRange: {
    start: string;
    end: string;
  };
  totalDays: number;
  present: number;
  absent: number;
  late: number;
  excused: number;
  halfDay: number;
  attendanceRate: number;
}

/**
 * Bulk Attendance Response DTO
 */
export class BulkAttendanceResponseDto {
  date: string;
  schoolId: string;
  processed: number;
  created: number;
  updated: number;
  errors: Array<{
    studentId: string;
    error: string;
  }>;
}

