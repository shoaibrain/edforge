/**
 * School DTOs for Identity Service
 */

import { 
  IsNotEmpty, 
  IsString, 
  IsOptional, 
  IsEnum,
  IsEmail,
  ValidateNested,
  MaxLength,
  MinLength,
  IsUrl,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SchoolStatus } from '../entities/base.entity';
import { SchoolType } from '../entities/school.entity';

/**
 * Grade Range DTO - MUST be defined before classes that reference it
 */
export class GradeRangeDto {
  @IsString()
  @IsNotEmpty()
  start: string;

  @IsString()
  @IsNotEmpty()
  end: string;
}

/**
 * School Address DTO - MUST be defined before classes that reference it
 */
export class SchoolAddressDto {
  @IsString()
  @IsNotEmpty()
  street1: string;

  @IsString()
  @IsOptional()
  street2?: string;

  @IsString()
  @IsNotEmpty()
  city: string;

  @IsString()
  @IsNotEmpty()
  state: string;

  @IsString()
  @IsNotEmpty()
  zipCode: string;

  @IsString()
  @IsOptional()
  country?: string;
}

/**
 * Create School DTO
 */
export class CreateSchoolDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(10)
  schoolCode: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @IsString()
  @IsOptional()
  shortName?: string;

  @IsEnum(['elementary', 'middle', 'high', 'k12', 'charter', 'private', 'vocational', 'special_education'])
  @IsNotEmpty()
  schoolType: SchoolType;

  @ValidateNested()
  @Type(() => GradeRangeDto)
  @IsNotEmpty()
  gradeRange: GradeRangeDto;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsUrl()
  @IsOptional()
  website?: string;

  @ValidateNested()
  @Type(() => SchoolAddressDto)
  @IsOptional()
  address?: SchoolAddressDto;

  @IsString()
  @IsOptional()
  principalName?: string;

  @IsEmail()
  @IsOptional()
  principalEmail?: string;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  locale?: string;

  @IsEnum(['semester', 'quarter', 'trimester'])
  @IsOptional()
  academicCalendarType?: 'semester' | 'quarter' | 'trimester';

  @IsUrl()
  @IsOptional()
  logoUrl?: string;
}

/**
 * Update School DTO
 */
export class UpdateSchoolDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  shortName?: string;

  @IsEnum(['elementary', 'middle', 'high', 'k12', 'charter', 'private', 'vocational', 'special_education'])
  @IsOptional()
  schoolType?: SchoolType;

  @ValidateNested()
  @Type(() => GradeRangeDto)
  @IsOptional()
  gradeRange?: GradeRangeDto;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsUrl()
  @IsOptional()
  website?: string;

  @ValidateNested()
  @Type(() => SchoolAddressDto)
  @IsOptional()
  address?: SchoolAddressDto;

  @IsString()
  @IsOptional()
  principalName?: string;

  @IsEmail()
  @IsOptional()
  principalEmail?: string;

  @IsEnum(['active', 'inactive', 'setup'])
  @IsOptional()
  status?: SchoolStatus;

  @IsString()
  @IsOptional()
  timezone?: string;

  @IsString()
  @IsOptional()
  currentAcademicYearId?: string;

  @IsUrl()
  @IsOptional()
  logoUrl?: string;
}

/**
 * School Response DTO
 */
export class SchoolResponseDto {
  schoolId: string;
  schoolCode: string;
  name: string;
  shortName?: string;
  schoolType: SchoolType;
  gradeRange: GradeRangeDto;
  phone?: string;
  email?: string;
  website?: string;
  address?: SchoolAddressDto;
  principalName?: string;
  principalEmail?: string;
  status: SchoolStatus;
  timezone: string;
  locale: string;
  academicCalendarType: 'semester' | 'quarter' | 'trimester';
  currentAcademicYearId?: string;
  studentCount?: number;
  staffCount?: number;
  teacherCount?: number;
  logoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * School List Response DTO
 */
export class SchoolListResponseDto {
  items: SchoolResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
  total?: number;
}
