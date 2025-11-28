/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment DTOs
 * 
 * Uses shared types from @edforge/shared-types for type safety across backend and frontend
 */

import { IsString, IsOptional, IsDateString, IsEnum, IsBoolean, IsArray } from 'class-validator';
import type {
  CreateEnrollmentRequest,
  UpdateEnrollmentStatusRequest,
  TransferEnrollmentRequest,
  SuspendEnrollmentRequest,
  GraduateEnrollmentRequest
} from '@edforge/shared-types';

// Re-export types for convenience
export type {
  CreateEnrollmentRequest,
  UpdateEnrollmentStatusRequest,
  TransferEnrollmentRequest,
  SuspendEnrollmentRequest,
  GraduateEnrollmentRequest
} from '@edforge/shared-types';

// DTO classes with validation decorators (implements shared types)
export class CreateEnrollmentDto implements CreateEnrollmentRequest {
  @IsString()
  schoolId: string;

  @IsString()
  academicYearId: string;

  @IsString()
  gradeLevel: string;  // "K", "1", "2", ..., "12"

  @IsOptional()
  @IsString()
  section?: string;    // "A", "B", "C"

  @IsDateString()
  enrollmentDate: string;

  @IsOptional()
  @IsEnum(['pending', 'active'])
  status?: 'pending' | 'active';
}

export class UpdateEnrollmentStatusDto implements UpdateEnrollmentStatusRequest {
  @IsEnum(['pending', 'active', 'suspended', 'graduated', 'transferred', 'withdrawn'])
  status: 'pending' | 'active' | 'suspended' | 'graduated' | 'transferred' | 'withdrawn';

  @IsOptional()
  @IsString()
  statusReason?: string;
}

export class TransferEnrollmentDto implements TransferEnrollmentRequest {
  @IsString()
  targetSchoolId: string;

  @IsString()
  targetAcademicYearId: string;

  @IsString()
  targetGradeLevel: string;

  @IsDateString()
  transferDate: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

export class SuspendEnrollmentDto implements SuspendEnrollmentRequest {
  @IsString()
  reason: string;

  @IsDateString()
  suspensionDate: string;

  @IsOptional()
  @IsDateString()
  expectedReturnDate?: string;
}

export class GraduateEnrollmentDto implements GraduateEnrollmentRequest {
  @IsDateString()
  graduationDate: string;

  @IsOptional()
  @IsString()
  diplomaNumber?: string;

  @IsOptional()
  @IsBoolean()
  honors?: boolean;
}

/**
 * Bulk Enrollment DTOs
 * Phase 5: Advanced Features - Bulk Operations
 */
export class BulkEnrollmentItemDto extends CreateEnrollmentDto {
  @IsString()
  studentId: string;
}

export class BulkEnrollmentOptionsDto {
  @IsOptional()
  @IsBoolean()
  validateAllFirst?: boolean; // Validate all before processing (default: true)

  @IsOptional()
  maxConcurrent?: number; // Max parallel enrollments (default: 10)
}

export class BulkEnrollmentDto {
  @IsArray()
  enrollments: BulkEnrollmentItemDto[];

  @IsOptional()
  options?: BulkEnrollmentOptionsDto;
}

export interface BulkEnrollmentResult {
  studentId: string;
  enrollmentId: string;
  invoiceId?: string;
  status: 'success';
}

export interface BulkEnrollmentFailure {
  studentId: string;
  error: string;
  errorCode?: string;
  status: 'failed';
}

export interface BulkEnrollmentResponse {
  success: BulkEnrollmentResult[];
  failed: BulkEnrollmentFailure[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

