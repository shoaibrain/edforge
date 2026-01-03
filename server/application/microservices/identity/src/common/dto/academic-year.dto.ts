/**
 * Academic Year DTOs for Identity Service
 */

import {
  IsNotEmpty,
  IsString,
  IsOptional,
  IsEnum,
  IsBoolean,
  IsDateString,
  IsInt,
  Min,
  Max,
  ValidateNested,
  MaxLength,
  MinLength,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AcademicYearStatus, TermType } from '../entities/base.entity';

/**
 * Create Academic Year DTO
 */
export class CreateAcademicYearDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(4)
  @MaxLength(20)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  shortName?: string;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsEnum(['semester', 'quarter', 'trimester'])
  @IsOptional()
  calendarType?: 'semester' | 'quarter' | 'trimester';

  @IsBoolean()
  @IsOptional()
  setAsCurrent?: boolean;
}

/**
 * Update Academic Year DTO
 */
export class UpdateAcademicYearDto {
  @IsString()
  @IsOptional()
  @MinLength(4)
  @MaxLength(20)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  shortName?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsEnum(['semester', 'quarter', 'trimester'])
  @IsOptional()
  calendarType?: 'semester' | 'quarter' | 'trimester';
}

/**
 * Update Academic Year Status DTO
 */
export class UpdateAcademicYearStatusDto {
  @IsEnum(['planning', 'active', 'completed', 'archived'])
  @IsNotEmpty()
  status: AcademicYearStatus;
}

/**
 * Academic Year Response DTO
 */
export class AcademicYearResponseDto {
  yearId: string;
  schoolId: string;
  name: string;
  shortName?: string;
  startDate: string;
  endDate: string;
  status: AcademicYearStatus;
  isCurrent: boolean;
  calendarType: 'semester' | 'quarter' | 'trimester';
  createdAt: string;
  updatedAt: string;
}

/**
 * Academic Year List Response DTO
 */
export class AcademicYearListResponseDto {
  items: AcademicYearResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

// ============================================
// Grading Period DTOs
// ============================================

/**
 * Create Grading Period DTO
 */
export class CreateGradingPeriodDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  name: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  shortName?: string;

  @IsEnum(['semester', 'quarter', 'trimester', 'year'])
  @IsNotEmpty()
  termType: TermType;

  @IsInt()
  @Min(1)
  @Max(12)
  @IsNotEmpty()
  sequence: number;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsDateString()
  @IsOptional()
  gradesDueDate?: string;

  @IsDateString()
  @IsOptional()
  reportCardDate?: string;
}

/**
 * Update Grading Period DTO
 */
export class UpdateGradingPeriodDto {
  @IsString()
  @IsOptional()
  @MinLength(2)
  @MaxLength(50)
  name?: string;

  @IsString()
  @IsOptional()
  @MaxLength(10)
  shortName?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsDateString()
  @IsOptional()
  gradesDueDate?: string;

  @IsDateString()
  @IsOptional()
  reportCardDate?: string;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

/**
 * Grading Period Response DTO
 */
export class GradingPeriodResponseDto {
  termId: string;
  yearId: string;
  schoolId: string;
  name: string;
  shortName?: string;
  termType: TermType;
  sequence: number;
  startDate: string;
  endDate: string;
  gradesDueDate?: string;
  reportCardDate?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * Grading Period List Response DTO
 */
export class GradingPeriodListResponseDto {
  items: GradingPeriodResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

// ============================================
// Holiday DTOs
// ============================================

/**
 * Create Holiday DTO
 */
export class CreateHolidayDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsDateString()
  @IsNotEmpty()
  date: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsEnum(['federal', 'state', 'school', 'break', 'professional_development'])
  @IsNotEmpty()
  holidayType: 'federal' | 'state' | 'school' | 'break' | 'professional_development';

  @IsBoolean()
  @IsOptional()
  affectsStudents?: boolean;

  @IsBoolean()
  @IsOptional()
  affectsStaff?: boolean;
}

/**
 * Bulk Create Holidays DTO
 */
export class BulkCreateHolidaysDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateHolidayDto)
  holidays: CreateHolidayDto[];
}

/**
 * Holiday Response DTO
 */
export class HolidayResponseDto {
  holidayId: string;
  yearId: string;
  schoolId: string;
  name: string;
  date: string;
  endDate?: string;
  holidayType: 'federal' | 'state' | 'school' | 'break' | 'professional_development';
  affectsStudents: boolean;
  affectsStaff: boolean;
  createdAt: string;
}

/**
 * Holiday List Response DTO
 */
export class HolidayListResponseDto {
  items: HolidayResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

