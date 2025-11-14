/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance DTOs
 * 
 * Uses shared types from @edforge/shared-types for type safety across backend and frontend
 */

import { IsString, IsNumber, IsOptional, IsDateString, IsEnum, IsArray, ValidateNested, IsBoolean, IsObject } from 'class-validator';
import { Type } from 'class-transformer';
import type {
  CreateTuitionConfigurationRequest,
  CreatePaymentRequest,
  TuitionRateRequest,
  FeeRequest,
  DiscountPolicyRequest
} from '@edforge/shared-types';

// Re-export types for convenience
export type {
  CreateTuitionConfigurationRequest,
  CreatePaymentRequest,
  TuitionRateRequest,
  FeeRequest,
  DiscountPolicyRequest
} from '@edforge/shared-types';

// DTO classes with validation decorators (implements shared types)
export class TuitionRateDto implements TuitionRateRequest {
  @IsNumber()
  amount: number;

  @IsString()
  currency: string;

  @IsEnum(['annual', 'semester', 'monthly', 'quarterly'])
  frequency: 'annual' | 'semester' | 'monthly' | 'quarterly';

  @IsOptional()
  @IsArray()
  @IsDateString({}, { each: true })
  dueDates?: string[];

  @IsOptional()
  @IsString()
  description?: string;
}

export class FeeDto implements FeeRequest {
  @IsString()
  feeName: string;

  @IsEnum(['registration', 'technology', 'activity', 'lab', 'sports', 'field_trip', 'uniform', 'other'])
  feeType: 'registration' | 'technology' | 'activity' | 'lab' | 'sports' | 'field_trip' | 'uniform' | 'other';

  @IsNumber()
  amount: number;

  @IsEnum(['one_time', 'annual', 'semester', 'monthly', 'per_course'])
  frequency: 'one_time' | 'annual' | 'semester' | 'monthly' | 'per_course';

  @IsBoolean()
  isMandatory: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableGrades?: string[];

  @IsOptional()
  @IsString()
  description?: string;
}

export class DiscountPolicyDto implements DiscountPolicyRequest {
  @IsString()
  name: string;

  @IsEnum(['sibling', 'early_payment', 'scholarship', 'financial_aid', 'staff_discount', 'custom'])
  type: 'sibling' | 'early_payment' | 'scholarship' | 'financial_aid' | 'staff_discount' | 'custom';

  @IsOptional()
  @IsNumber()
  discountPercentage?: number;

  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @IsString()
  conditions: string;

  @IsEnum(['tuition', 'fees', 'both'])
  applicableTo: 'tuition' | 'fees' | 'both';
}

export class CreateTuitionConfigurationDto implements CreateTuitionConfigurationRequest {
  @IsString()
  schoolId: string;

  @IsString()
  academicYearId: string;

  @IsObject()
  tuitionRates: { [gradeLevel: string]: TuitionRateDto };

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => FeeDto)
  fees?: FeeDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DiscountPolicyDto)
  discountPolicies?: DiscountPolicyDto[];
}

export class CreatePaymentDto implements CreatePaymentRequest {
  @IsString()
  invoiceId: string;

  @IsNumber()
  amount: number;

  @IsString()
  currency: string;

  @IsDateString()
  paymentDate: string;

  @IsEnum(['cash', 'check', 'bank_transfer', 'credit_card', 'debit_card', 'other'])
  paymentMethod: 'cash' | 'check' | 'bank_transfer' | 'credit_card' | 'debit_card' | 'other';

  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

