/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment DTOs
 * 
 * Uses shared types from @edforge/shared-types for type safety across backend and frontend
 */

import { IsString, IsOptional, IsDateString, IsEnum, IsBoolean } from 'class-validator';
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

