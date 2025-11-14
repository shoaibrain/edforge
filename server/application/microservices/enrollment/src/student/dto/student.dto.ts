/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Student DTOs
 * 
 * Uses shared types from @edforge/shared-types for type safety across backend and frontend
 */

import { IsString, IsEmail, IsOptional, IsDateString, IsEnum, IsArray, ValidateNested, IsBoolean, MinLength, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import type { 
  CreateStudentRequest, 
  UpdateStudentRequest,
  AddressRequest,
  GuardianRequest,
  EnrollmentContactInfoRequest,
  MedicalInfoRequest
} from '@edforge/shared-types';

// Re-export types for convenience
export type { 
  CreateStudentRequest, 
  UpdateStudentRequest,
  AddressRequest,
  GuardianRequest,
  EnrollmentContactInfoRequest,
  MedicalInfoRequest
} from '@edforge/shared-types';

// DTO classes with validation decorators (implements shared types)
export class AddressDto implements AddressRequest {
  @IsString()
  @MinLength(1)
  street: string;

  @IsString()
  @MinLength(1)
  city: string;

  @IsString()
  @MinLength(1)
  state: string;

  @IsString()
  @MinLength(2)
  @MaxLength(2)
  country: string;

  @IsString()
  @MinLength(1)
  postalCode: string;

  @IsOptional()
  @Type(() => Number)
  latitude?: number;

  @IsOptional()
  @Type(() => Number)
  longitude?: number;
}

export class GuardianDto implements GuardianRequest {
  @IsString()
  guardianId: string;

  @IsEnum(['parent', 'guardian', 'emergency_contact'])
  relationship: 'parent' | 'guardian' | 'emergency_contact';

  @IsBoolean()
  isPrimary: boolean;
}

export class ContactInfoDto implements EnrollmentContactInfoRequest {
  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @ValidateNested()
  @Type(() => AddressDto)
  address: AddressDto;
}

export class MedicalInfoDto implements MedicalInfoRequest {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allergies?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  medications?: string[];

  @ValidateNested()
  @Type(() => Object)
  emergencyContact: {
    name: string;
    phone: string;
    relationship: string;
  };
}

export class CreateStudentDto implements CreateStudentRequest {
  @IsString()
  @MinLength(1)
  firstName: string;

  @IsString()
  @MinLength(1)
  lastName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsDateString()
  dateOfBirth: string;

  @IsOptional()
  @IsEnum(['male', 'female', 'other', 'prefer_not_to_say'])
  gender?: 'male' | 'female' | 'other' | 'prefer_not_to_say';

  @ValidateNested()
  @Type(() => ContactInfoDto)
  contactInfo: ContactInfoDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuardianDto)
  guardians?: GuardianDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MedicalInfoDto)
  medicalInfo?: MedicalInfoDto;
}

export class UpdateStudentDto implements UpdateStudentRequest {
  @IsOptional()
  @IsString()
  @MinLength(1)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  lastName?: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContactInfoDto)
  contactInfo?: ContactInfoDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuardianDto)
  guardians?: GuardianDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => MedicalInfoDto)
  medicalInfo?: MedicalInfoDto;
}

