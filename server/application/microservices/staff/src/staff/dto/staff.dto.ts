/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Staff DTOs
 * 
 * Uses shared types from @edforge/shared-types for type safety across backend and frontend
 */

import { IsString, IsEmail, IsOptional, IsDateString, IsEnum, IsArray, ValidateNested, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import type {
  CreateStaffRequest,
  UpdateStaffRequest,
  RoleRequest,
  QualificationsRequest,
  EducationRequest,
  AddressRequest
} from '@edforge/shared-types';
import { AddressDto } from '../../student/dto/student.dto';

// Re-export types for convenience
export type {
  CreateStaffRequest,
  UpdateStaffRequest,
  RoleRequest,
  QualificationsRequest,
  EducationRequest
} from '@edforge/shared-types';

// DTO classes with validation decorators (implements shared types)
export class RoleDto implements RoleRequest {
  @IsEnum(['teacher', 'principal', 'vice_principal', 'counselor', 'administrator', 'support_staff'])
  roleType: 'teacher' | 'principal' | 'vice_principal' | 'counselor' | 'administrator' | 'support_staff';

  @IsString()
  schoolId: string;

  @IsOptional()
  @IsString()
  departmentId?: string;

  @IsDateString()
  startDate: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;

  @IsBoolean()
  isPrimary: boolean;
}

export class EducationDto implements EducationRequest {
  @IsString()
  degree: string;

  @IsString()
  institution: string;

  @IsString()
  year: string;
}

export class QualificationsDto implements QualificationsRequest {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EducationDto)
  education: EducationDto[];

  @IsArray()
  @IsString({ each: true })
  certifications: string[];

  @IsArray()
  @IsString({ each: true })
  licenses: string[];
}

export class CreateStaffDto implements CreateStaffRequest {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @IsOptional()
  @IsEnum(['male', 'female', 'other', 'prefer_not_to_say'])
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';

  @ValidateNested()
  @Type(() => Object)
  contactInfo: {
    email: string;
    phone: string;
    address: AddressDto;
  };

  @IsDateString()
  hireDate: string;

  @IsEnum(['full_time', 'part_time', 'contract', 'substitute'])
  employmentType: 'full_time' | 'part_time' | 'contract' | 'substitute';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleDto)
  roles: RoleDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => QualificationsDto)
  qualifications?: QualificationsDto;
}

export class UpdateStaffDto implements UpdateStaffRequest {
  @IsOptional()
  @IsString()
  firstName?: string;

  @IsOptional()
  @IsString()
  lastName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => Object)
  contactInfo?: {
    email: string;
    phone: string;
    address: AddressDto;
  };

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => RoleDto)
  roles?: RoleDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => QualificationsDto)
  qualifications?: QualificationsDto;
}

