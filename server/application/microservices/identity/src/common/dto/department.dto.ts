/**
 * Department and Configuration DTOs for Identity Service
 */

import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsBoolean,
  IsArray,
  IsEnum,
  IsInt,
  Min,
  Max,
  ValidateNested,
  MaxLength,
  MinLength,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';

// ============================================
// Department DTOs
// ============================================

/**
 * Create Department DTO
 */
export class CreateDepartmentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(10)
  code: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  headUserId?: string;
}

/**
 * Update Department DTO
 */
export class UpdateDepartmentDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  description?: string;

  @IsString()
  @IsOptional()
  headUserId?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/**
 * Department Response DTO
 */
export class DepartmentResponseDto {
  departmentId: string;
  schoolId: string;
  code: string;
  name: string;
  description?: string;
  headUserId?: string;
  headName?: string;
  isActive: boolean;
  teacherCount?: number;
  courseCount?: number;
  createdAt: string;
  updatedAt: string;
}

/**
 * Department List Response DTO
 */
export class DepartmentListResponseDto {
  items: DepartmentResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

// ============================================
// School Configuration DTOs
// ============================================

/**
 * Grading Scale DTO
 */
export class GradeLevelDto {
  @IsString()
  @IsNotEmpty()
  letter: string;

  @IsInt()
  @Min(0)
  @Max(100)
  minScore: number;

  @IsInt()
  @Min(0)
  @Max(100)
  maxScore: number;

  @IsOptional()
  @Min(0)
  @Max(5)
  gpa?: number;
}

/**
 * Grading Scale Configuration DTO
 */
export class GradingScaleDto {
  @IsEnum(['letter', 'percentage', 'points', 'custom'])
  @IsNotEmpty()
  type: 'letter' | 'percentage' | 'points' | 'custom';

  @IsInt()
  @Min(0)
  @Max(100)
  passingGrade: number;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradeLevelDto)
  scale: GradeLevelDto[];
}

/**
 * School Features DTO
 */
export class SchoolFeaturesDto {
  @IsBoolean()
  @IsOptional()
  attendance?: boolean;

  @IsBoolean()
  @IsOptional()
  grades?: boolean;

  @IsBoolean()
  @IsOptional()
  enrollment?: boolean;

  @IsBoolean()
  @IsOptional()
  curriculum?: boolean;

  @IsBoolean()
  @IsOptional()
  scheduling?: boolean;

  @IsBoolean()
  @IsOptional()
  specialPrograms?: boolean;

  @IsBoolean()
  @IsOptional()
  parentPortal?: boolean;

  @IsBoolean()
  @IsOptional()
  studentPortal?: boolean;
}

/**
 * Update School Configuration DTO
 */
export class UpdateSchoolConfigDto {
  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  locale?: string;

  @IsString()
  @IsOptional()
  dateFormat?: string;

  @IsEnum(['12h', '24h'])
  @IsOptional()
  timeFormat?: '12h' | '24h';

  @IsEnum(['semester', 'quarter', 'trimester'])
  @IsOptional()
  academicCalendarType?: 'semester' | 'quarter' | 'trimester';

  @ValidateNested()
  @Type(() => GradingScaleDto)
  @IsOptional()
  gradingScale?: GradingScaleDto;

  @IsBoolean()
  @IsOptional()
  attendanceRequired?: boolean;

  @IsArray()
  @IsInt({ each: true })
  @IsOptional()
  schoolDays?: number[];

  @IsString()
  @IsOptional()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'Start time must be in HH:MM format' })
  startTime?: string;

  @IsString()
  @IsOptional()
  @Matches(/^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/, { message: 'End time must be in HH:MM format' })
  endTime?: string;

  @IsInt()
  @Min(15)
  @Max(120)
  @IsOptional()
  periodDuration?: number;

  @IsBoolean()
  @IsOptional()
  notificationsEnabled?: boolean;

  @IsBoolean()
  @IsOptional()
  emailNotifications?: boolean;

  @IsBoolean()
  @IsOptional()
  smsNotifications?: boolean;

  @ValidateNested()
  @Type(() => SchoolFeaturesDto)
  @IsOptional()
  features?: SchoolFeaturesDto;
}

/**
 * School Configuration Response DTO
 */
export class SchoolConfigResponseDto {
  schoolId: string;
  timezone: string;
  locale: string;
  dateFormat: string;
  timeFormat: '12h' | '24h';
  academicCalendarType: 'semester' | 'quarter' | 'trimester';
  gradingScale: GradingScaleDto;
  attendanceRequired: boolean;
  schoolDays: number[];
  startTime: string;
  endTime: string;
  periodDuration: number;
  notificationsEnabled: boolean;
  emailNotifications: boolean;
  smsNotifications: boolean;
  features: SchoolFeaturesDto;
  createdAt: string;
  updatedAt: string;
}

