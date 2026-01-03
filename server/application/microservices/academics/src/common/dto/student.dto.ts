/**
 * Student DTOs for Academics Service
 * 
 * IMPORTANT: Class declaration order matters for TypeScript decorators!
 * Nested DTOs must be defined BEFORE the classes that reference them
 * to avoid "Cannot access 'X' before initialization" errors.
 */

import { 
  IsNotEmpty, 
  IsString, 
  IsOptional, 
  IsEnum,
  IsArray,
  ValidateNested,
  IsDateString,
  IsEmail,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { Gender, StudentStatus } from '../entities/base.entity';

// ============================================
// NESTED DTOs (must be defined first)
// ============================================

/**
 * Address DTO
 */
export class AddressDto {
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
 * Emergency Contact DTO
 */
export class EmergencyContactDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsString()
  @IsNotEmpty()
  relationship: string;

  @IsString()
  @IsNotEmpty()
  phone: string;

  @IsString()
  @IsOptional()
  alternatePhone?: string;
}

/**
 * Medical Info DTO
 */
export class MedicalInfoDto {
  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  allergies?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  medications?: string[];

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  conditions?: string[];

  @IsString()
  @IsOptional()
  notes?: string;

  @IsString()
  @IsOptional()
  physicianName?: string;

  @IsString()
  @IsOptional()
  physicianPhone?: string;
}

/**
 * Guardian DTO
 * Note: Uses AddressDto, so must come after AddressDto
 */
export class GuardianDto {
  @IsString()
  @IsOptional()
  guardianId?: string;

  @IsEnum(['mother', 'father', 'guardian', 'grandparent', 'other'])
  @IsNotEmpty()
  relationship: 'mother' | 'father' | 'guardian' | 'grandparent' | 'other';

  @IsString()
  @IsNotEmpty()
  firstName: string;

  @IsString()
  @IsNotEmpty()
  lastName: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(['mobile', 'home', 'work'])
  @IsOptional()
  phoneType?: 'mobile' | 'home' | 'work';

  @IsOptional()
  isPrimary?: boolean;

  @IsOptional()
  hasPortalAccess?: boolean;

  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  address?: AddressDto;
}

// ============================================
// MAIN DTOs (use nested DTOs above)
// ============================================

/**
 * Create Student DTO
 */
export class CreateStudentDto {
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  firstName: string;

  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  lastName: string;

  @IsString()
  @IsOptional()
  middleName?: string;

  @IsString()
  @IsOptional()
  preferredName?: string;

  @IsDateString()
  @IsNotEmpty()
  dateOfBirth: string;

  @IsEnum(['male', 'female', 'other', 'prefer_not_to_say'])
  @IsNotEmpty()
  gender: Gender;

  @IsString()
  @IsNotEmpty()
  schoolId: string;

  @IsString()
  @IsNotEmpty()
  currentGradeLevel: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  address?: AddressDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuardianDto)
  @IsOptional()
  guardians?: GuardianDto[];

  @ValidateNested()
  @Type(() => EmergencyContactDto)
  @IsOptional()
  emergencyContact?: EmergencyContactDto;

  @ValidateNested()
  @Type(() => MedicalInfoDto)
  @IsOptional()
  medicalInfo?: MedicalInfoDto;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  specialPrograms?: string[];
}

/**
 * Update Student DTO
 */
export class UpdateStudentDto {
  @IsString()
  @IsOptional()
  firstName?: string;

  @IsString()
  @IsOptional()
  lastName?: string;

  @IsString()
  @IsOptional()
  middleName?: string;

  @IsString()
  @IsOptional()
  preferredName?: string;

  @IsDateString()
  @IsOptional()
  dateOfBirth?: string;

  @IsEnum(['male', 'female', 'other', 'prefer_not_to_say'])
  @IsOptional()
  gender?: Gender;

  @IsString()
  @IsOptional()
  currentGradeLevel?: string;

  @IsEmail()
  @IsOptional()
  email?: string;

  @IsString()
  @IsOptional()
  phone?: string;

  @IsEnum(['active', 'inactive', 'graduated', 'transferred', 'withdrawn'])
  @IsOptional()
  status?: StudentStatus;

  @ValidateNested()
  @Type(() => AddressDto)
  @IsOptional()
  address?: AddressDto;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GuardianDto)
  @IsOptional()
  guardians?: GuardianDto[];

  @ValidateNested()
  @Type(() => EmergencyContactDto)
  @IsOptional()
  emergencyContact?: EmergencyContactDto;

  @ValidateNested()
  @Type(() => MedicalInfoDto)
  @IsOptional()
  medicalInfo?: MedicalInfoDto;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  specialPrograms?: string[];

  @IsString()
  @IsOptional()
  photoUrl?: string;
}

// ============================================
// RESPONSE DTOs
// ============================================

/**
 * Student Response DTO
 */
export class StudentResponseDto {
  studentId: string;
  studentNumber: string;
  firstName: string;
  lastName: string;
  middleName?: string;
  preferredName?: string;
  dateOfBirth: string;
  gender: Gender;
  email?: string;
  phone?: string;
  address?: AddressDto;
  guardians: GuardianDto[];
  emergencyContact?: EmergencyContactDto;
  primarySchoolId: string;
  currentGradeLevel: string;
  status: StudentStatus;
  enrollmentDate: string;
  specialPrograms?: string[];
  photoUrl?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Student List Response DTO
 */
export class StudentListResponseDto {
  items: StudentResponseDto[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
  total?: number;
}

/**
 * Student Profile DTO - Aggregated student data
 */
export class StudentProfileDto {
  // Basic Info
  student: StudentResponseDto;
  
  // Current Enrollment
  currentEnrollment?: {
    enrollmentId: string;
    schoolId: string;
    schoolName?: string;
    academicYearId: string;
    academicYearName?: string;
    gradeLevel: string;
    status: string;
    enrollmentDate: string;
  };
  
  // Attendance Summary (current year)
  attendanceSummary?: {
    totalDays: number;
    presentDays: number;
    absentDays: number;
    lateDays: number;
    excusedAbsences: number;
    attendanceRate: number;
  };
  
  // Academic Summary (current year) - placeholder for future
  academicSummary?: {
    gpa?: number;
    gradeAverage?: number;
    coursesEnrolled?: number;
    creditsEarned?: number;
  };
  
  // Quick Stats
  stats: {
    enrollmentCount: number;
    yearsAttended: number;
    hasActiveIEP?: boolean;
    has504Plan?: boolean;
  };
}
