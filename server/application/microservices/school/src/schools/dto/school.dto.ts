/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Data Transfer Objects (DTOs) for School Service
 * 
 * VALIDATION STRATEGY:
 * - class-validator decorators for basic validation
 * - ValidationService for complex business rules
 * - DTO → Entity transformation in service layer
 */

import { 
  IsString, 
  IsEmail, 
  IsOptional, 
  IsEnum, 
  IsNumber, 
  IsBoolean, 
  ValidateNested,
  IsArray,
  Min,
  Max,
  Length
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Contact Information DTO
 */
export class ContactInfoDto {
  @IsEmail()
  primaryEmail: string;

  @IsString()
  @Length(1, 20)
  primaryPhone: string; // E.164 format: +1-555-0123

  @IsOptional()
  @IsString()
  secondaryPhone?: string;

  @IsOptional()
  @IsString()
  website?: string;

  @IsOptional()
  @IsString()
  fax?: string;
}

/**
 * Address DTO
 */
export class AddressDto {
  @IsString()
  @Length(1, 200)
  street: string;

  @IsString()
  @Length(1, 100)
  city: string;

  @IsString()
  @Length(1, 100)
  state: string;

  @IsString()
  @Length(2, 2)
  country: string; // ISO 3166-1 alpha-2 (US, CA, GB)

  @IsString()
  @Length(1, 20)
  postalCode: string;

  @IsOptional()
  @IsNumber()
  latitude?: number;

  @IsOptional()
  @IsNumber()
  longitude?: number;

  @IsString()
  timezone: string; // IANA timezone (America/New_York)
}

/**
 * Grade Range DTO
 */
export class GradeRangeDto {
  @IsString()
  lowestGrade: string; // "K", "1", "2"

  @IsString()
  highestGrade: string; // "5", "8", "12"
}

/**
 * Create School DTO
 */
export class CreateSchoolDto {
  @IsString()
  @Length(3, 255)
  schoolName: string;

  @IsString()
  @Length(3, 50)
  schoolCode: string;

  @IsEnum(['elementary', 'middle', 'high', 'k12', 'alternative', 'special'])
  schoolType: 'elementary' | 'middle' | 'high' | 'k12' | 'alternative' | 'special';

  @ValidateNested()
  @Type(() => ContactInfoDto)
  contactInfo: ContactInfoDto;

  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;

  @IsNumber()
  @Min(1)
  @Max(50000)
  maxStudentCapacity: number;

  @ValidateNested()
  @Type(() => GradeRangeDto)
  gradeRange: GradeRangeDto;

  @IsOptional()
  @IsString()
  principalUserId?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vicePrincipalUserIds?: string[];

  @IsOptional()
  @IsString()
  foundedDate?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  motto?: string;

  @IsOptional()
  @IsString()
  logoUrl?: string;
}

/**
 * Update School DTO
 */
export class UpdateSchoolDto {
  @IsOptional()
  @IsString()
  @Length(3, 255)
  schoolName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContactInfoDto)
  contactInfo?: ContactInfoDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => AddressDto)
  address?: AddressDto;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(50000)
  maxStudentCapacity?: number;

  @IsOptional()
  @IsString()
  principalUserId?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEnum(['active', 'inactive', 'suspended', 'closed'])
  status?: 'active' | 'inactive' | 'suspended' | 'closed';

  @IsOptional()
  @IsString()
  statusReason?: string;

  @IsNumber()
  version: number; // Required for optimistic locking
}

/**
 * Academic Structure DTO - Defined first to avoid circular dependency
 */
export class AcademicStructureDto {
  @IsNumber()
  @Min(1)
  @Max(4)
  semesterCount: number;

  @IsNumber()
  @Min(1)
  @Max(12)
  gradingPeriodCount: number;

  @IsNumber()
  @Min(30)
  @Max(365)
  instructionalDays: number;

  @IsNumber()
  @Min(30)
  @Max(365)
  schoolDays: number;
}

/**
 * Create Academic Year DTO
 */
export class CreateAcademicYearDto {
  @IsString()
  @Length(3, 100)
  yearName: string; // "2024-2025"

  @IsString()
  @Length(2, 20)
  yearCode: string; // "AY24"

  @IsString()
  startDate: string; // ISO date: YYYY-MM-DD

  @IsString()
  endDate: string; // ISO date: YYYY-MM-DD

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => AcademicStructureDto)
  structure?: AcademicStructureDto;
}

/**
 * Update Academic Year DTO
 * All fields are optional for partial updates
 */
export class UpdateAcademicYearDto {
  @IsOptional()
  @IsString()
  @Length(3, 100)
  yearName?: string; // "2024-2025"

  @IsOptional()
  @IsString()
  @Length(2, 20)
  yearCode?: string; // "AY24"

  @IsOptional()
  @IsString()
  startDate?: string; // ISO date: YYYY-MM-DD

  @IsOptional()
  @IsString()
  endDate?: string; // ISO date: YYYY-MM-DD

  @IsOptional()
  @IsEnum(['planned', 'active', 'completed', 'archived'])
  status?: 'planned' | 'active' | 'completed' | 'archived';

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;

  @IsOptional()
  @ValidateNested()
  @Type(() => AcademicStructureDto)
  structure?: AcademicStructureDto;

  @IsOptional()
  @IsNumber()
  @Min(1)
  version?: number; // Required for optimistic locking
}

/**
 * Create Grading Period DTO
 */
export class CreateGradingPeriodDto {
  @IsString()
  periodName: string; // "Fall Semester", "Q1"

  @IsEnum(['semester', 'quarter', 'trimester', 'custom'])
  periodType: 'semester' | 'quarter' | 'trimester' | 'custom';

  @IsNumber()
  @Min(1)
  periodNumber: number;

  @IsString()
  startDate: string; // YYYY-MM-DD

  @IsString()
  endDate: string; // YYYY-MM-DD

  @IsOptional()
  @IsBoolean()
  isCurrent?: boolean;

  @IsOptional()
  @IsNumber()
  instructionalDays?: number;

  @IsOptional()
  @IsString()
  gradesDueDate?: string;

  @IsOptional()
  @IsString()
  reportCardDate?: string;
}

/**
 * Create Holiday DTO
 */
export class CreateHolidayDto {
  @IsString()
  name: string; // "Thanksgiving Break"

  @IsEnum(['holiday', 'professional_day', 'weather_closure', 'emergency'])
  type: 'holiday' | 'professional_day' | 'weather_closure' | 'emergency';

  @IsString()
  startDate: string;

  @IsString()
  endDate: string;

  @IsOptional()
  @IsBoolean()
  allDay?: boolean;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @IsOptional()
  @IsBoolean()
  affectsAttendance?: boolean;

  @IsOptional()
  @IsBoolean()
  affectsPayroll?: boolean;
}

/**
 * Create Department DTO
 */
export class CreateDepartmentDto {
  @IsString()
  @Length(2, 100)
  departmentName: string;

  @IsString()
  @Length(2, 20)
  departmentCode: string;

  @IsEnum(['academic', 'administrative', 'support', 'athletic'])
  category: 'academic' | 'administrative' | 'support' | 'athletic';

  @IsOptional()
  @IsString()
  headOfDepartmentUserId?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

