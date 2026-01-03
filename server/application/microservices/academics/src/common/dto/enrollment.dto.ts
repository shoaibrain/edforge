/**
 * Enrollment DTOs for Academics Service
 */

import { 
  IsNotEmpty, 
  IsString, 
  IsOptional, 
  IsEnum,
  IsArray,
  IsDateString,
  IsBoolean,
} from 'class-validator';
import { EnrollmentStatus } from '../entities/base.entity';

/**
 * Create Enrollment DTO
 */
export class CreateEnrollmentDto {
  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsNotEmpty()
  academicYearId: string;

  @IsString()
  @IsNotEmpty()
  gradeLevel: string;

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsString()
  @IsOptional()
  sectionId?: string;

  @IsString()
  @IsOptional()
  homeroomTeacherId?: string;

  @IsEnum(['new', 'returning', 'transfer'])
  @IsOptional()
  enrollmentType?: 'new' | 'returning' | 'transfer';

  @IsString()
  @IsOptional()
  previousSchoolId?: string;

  @IsString()
  @IsOptional()
  previousSchoolName?: string;

  @IsString()
  @IsOptional()
  transferReason?: string;

  @IsBoolean()
  @IsOptional()
  specialEducation?: boolean;

  @IsEnum(['none', 'active', 'exited', 'monitoring'])
  @IsOptional()
  eslStatus?: 'none' | 'active' | 'exited' | 'monitoring';

  @IsEnum(['regular', 'free', 'reduced'])
  @IsOptional()
  lunchStatus?: 'regular' | 'free' | 'reduced';

  @IsEnum(['bus', 'car', 'walk', 'other'])
  @IsOptional()
  transportation?: 'bus' | 'car' | 'walk' | 'other';

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  documentsReceived?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}

/**
 * Update Enrollment DTO
 */
export class UpdateEnrollmentDto {
  @IsEnum(['enrolled', 'pending', 'withdrawn', 'graduated', 'transferred'])
  @IsOptional()
  status?: EnrollmentStatus;

  @IsString()
  @IsOptional()
  gradeLevel?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsDateString()
  @IsOptional()
  withdrawalDate?: string;

  @IsString()
  @IsOptional()
  sectionId?: string;

  @IsString()
  @IsOptional()
  homeroomTeacherId?: string;

  @IsBoolean()
  @IsOptional()
  specialEducation?: boolean;

  @IsEnum(['none', 'active', 'exited', 'monitoring'])
  @IsOptional()
  eslStatus?: 'none' | 'active' | 'exited' | 'monitoring';

  @IsEnum(['regular', 'free', 'reduced'])
  @IsOptional()
  lunchStatus?: 'regular' | 'free' | 'reduced';

  @IsEnum(['bus', 'car', 'walk', 'other'])
  @IsOptional()
  transportation?: 'bus' | 'car' | 'walk' | 'other';

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  documentsReceived?: string[];

  @IsString()
  @IsOptional()
  notes?: string;
}

/**
 * Withdraw Student DTO
 */
export class WithdrawStudentDto {
  @IsDateString()
  @IsNotEmpty()
  withdrawalDate: string;

  @IsString()
  @IsOptional()
  reason?: string;

  @IsString()
  @IsOptional()
  destinationSchool?: string;
}

/**
 * Transfer Student DTO
 */
export class TransferStudentDto {
  @IsString()
  @IsNotEmpty()
  toSchoolId: string;

  @IsString()
  @IsNotEmpty()
  toAcademicYearId: string;

  @IsDateString()
  @IsNotEmpty()
  effectiveDate: string;

  @IsString()
  @IsOptional()
  reason?: string;
}

/**
 * Enrollment Response DTO
 */
export class EnrollmentResponseDto {
  enrollmentId: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  gradeLevel: string;
  status: EnrollmentStatus;
  enrollmentDate: string;
  startDate: string;
  endDate?: string;
  withdrawalDate?: string;
  sectionId?: string;
  homeroomTeacherId?: string;
  enrollmentType: 'new' | 'returning' | 'transfer';
  previousSchoolId?: string;
  previousSchoolName?: string;
  specialEducation?: boolean;
  eslStatus?: string;
  lunchStatus?: string;
  transportation?: string;
  notes?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Enrollment List Response DTO
 */
export class EnrollmentListResponseDto {
  items: EnrollmentResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Enrollment Summary DTO
 */
export class EnrollmentSummaryDto {
  schoolId: string;
  academicYearId: string;
  totalEnrolled: number;
  byGradeLevel: Record<string, number>;
  byStatus: Record<EnrollmentStatus, number>;
}

