/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Parent DTOs
 * 
 * Uses shared types from @edforge/shared-types for type safety across backend and frontend
 */

import { IsString, IsEmail, IsOptional, IsArray, ValidateNested, IsBoolean, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import type {
  CreateParentRequest,
  UpdateParentRequest,
  ChildRequest
} from '@edforge/shared-types';
import { AddressDto } from '../../student/dto/student.dto';

// Re-export types for convenience
export type {
  CreateParentRequest,
  UpdateParentRequest,
  ChildRequest
} from '@edforge/shared-types';

// DTO classes with validation decorators (implements shared types)
export class ChildDto implements ChildRequest {
  @IsString()
  studentId: string;

  @IsEnum(['parent', 'guardian', 'emergency_contact'])
  relationship: 'parent' | 'guardian' | 'emergency_contact';

  @IsBoolean()
  isPrimary: boolean;
}

export class CreateParentDto implements CreateParentRequest {
  @IsString()
  firstName: string;

  @IsString()
  lastName: string;

  @IsOptional()
  @IsString()
  middleName?: string;

  @ValidateNested()
  @Type(() => Object)
  contactInfo: {
    email: string;
    phone: string;
    alternatePhone?: string;
    address: AddressDto;
  };

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChildDto)
  children?: ChildDto[];

  @IsOptional()
  @IsBoolean()
  portalEnabled?: boolean;
}

export class UpdateParentDto implements UpdateParentRequest {
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
    alternatePhone?: string;
    address: AddressDto;
  };

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChildDto)
  children?: ChildDto[];
}

