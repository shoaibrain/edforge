import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, IsEnum, IsBoolean, ValidateNested, Min, Max, IsObject, IsDateString } from 'class-validator';
import { Type } from 'class-transformer';
import type { 
  RubricScoreDto as IRubricScoreDto, 
  UpdateGradeDto as IUpdateGradeDto, 
  CreateGradeDto as ICreateGradeDto,
  GradeRangeDto as IGradeRangeDto,
  CreateGradingScaleDto as ICreateGradingScaleDto
} from '@edforge/shared-types';

export class RubricScoreDto implements IRubricScoreDto {
  @IsString()
  @IsNotEmpty()
  criteriaName: string;

  @IsNumber()
  @Min(0)
  maxPoints: number;

  @IsNumber()
  @Min(0)
  pointsEarned: number;

  @IsString()
  @IsOptional()
  feedback?: string;
}

export class UpdateGradeDto implements IUpdateGradeDto {
  @IsNumber()
  @IsOptional()
  @Min(0)
  score?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  maxPoints?: number;

  @IsString()
  @IsOptional()
  feedback?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RubricScoreDto)
  rubricScores?: RubricScoreDto[];

  @IsEnum(['draft', 'published', 'revised'])
  @IsOptional()
  status?: 'draft' | 'published' | 'revised';

  @IsNumber()
  @IsOptional()
  @Min(1)
  version?: number; // For optimistic locking
}

export class GradeRangeDto implements IGradeRangeDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  minPercentage: number; // Updated to match shared-types

  @IsNumber()
  @Min(0)
  @Max(100)
  maxPercentage: number; // Updated to match shared-types

  @IsString()
  @IsNotEmpty()
  letterGrade: string; // Updated to match shared-types

  @IsNumber()
  @Min(0)
  @Max(4)
  gradePoints: number; // Updated to match shared-types (required)

  @IsBoolean()
  @IsOptional()
  passingGrade?: boolean;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  color?: string;
}

export class CreateGradingScaleDto implements ICreateGradingScaleDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(['letter', 'percentage', 'points', 'passfail'])
  @IsNotEmpty()
  type: 'letter' | 'percentage' | 'points' | 'passfail';

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GradeRangeDto)
  ranges: GradeRangeDto[];
}

// Enhanced Grade DTOs with Global Support
export class CreateGradeDto implements ICreateGradeDto {
  @IsString()
  @IsOptional()
  assignmentId?: string;

  @IsString()
  @IsNotEmpty()
  studentId: string;

  @IsString()
  @IsOptional()
  termId?: string;

  @IsNumber()
  @Min(0)
  score: number;

  @IsNumber()
  @Min(0)
  maxPoints: number;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsString()
  @IsOptional()
  feedback?: string;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => RubricScoreDto)
  rubricScores?: RubricScoreDto[];

  @IsBoolean()
  @IsOptional()
  isLate?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  penaltyApplied?: number;

  @IsBoolean()
  @IsOptional()
  isExcused?: boolean;

  @IsBoolean()
  @IsOptional()
  isFinal?: boolean;

  @IsBoolean()
  @IsOptional()
  canRetake?: boolean;

  @IsEnum(['draft', 'published'])
  @IsOptional()
  status?: 'draft' | 'published';
}

// Grading System DTOs
// Note: GradingScaleDto is deprecated - use GradeRangeDto instead
// Keeping for backward compatibility but should migrate to GradeRangeDto
export class GradingScaleDto {
  @IsNumber()
  @Min(0)
  @Max(100)
  min: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  max: number;

  @IsString()
  @IsNotEmpty()
  letter: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(4)
  gpa?: number;
}

export class CreateGradingSystemDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(['letter', 'percentage', 'numeric', 'pass_fail', 'custom'])
  @IsNotEmpty()
  type: 'letter' | 'percentage' | 'numeric' | 'pass_fail' | 'custom';

  @IsObject()
  @ValidateNested()
  @Type(() => Object)
  scale: {
    min: number;
    max: number;
    passingGrade: number;
    gradeLabels: Record<string, string>;
  };

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}

// Grade Category DTOs
export class CreateGradeCategoryDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsNumber()
  @Min(0)
  @Max(100)
  weight: number;

  @IsString()
  @IsNotEmpty()
  color: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  sortOrder?: number;
}

export class UpdateGradeCategoryDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  weight?: number;

  @IsString()
  @IsOptional()
  color?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  sortOrder?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

// Academic Term DTOs
export class CreateAcademicTermDto {
  @IsString()
  @IsNotEmpty()
  name: string;

  @IsEnum(['semester', 'quarter', 'trimester', 'custom'])
  @IsNotEmpty()
  type: 'semester' | 'quarter' | 'trimester' | 'custom';

  @IsDateString()
  @IsNotEmpty()
  startDate: string;

  @IsDateString()
  @IsNotEmpty()
  endDate: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  weight?: number;
}

export class UpdateAcademicTermDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  weight?: number;

  @IsBoolean()
  @IsOptional()
  isActive?: boolean;
}

// Bulk Grade Operations
export class BulkGradeDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateGradeDto)
  grades: CreateGradeDto[];
}

export class GradeFilterDto {
  @IsString()
  @IsOptional()
  studentId?: string;

  @IsString()
  @IsOptional()
  assignmentId?: string;

  @IsString()
  @IsOptional()
  categoryId?: string;

  @IsString()
  @IsOptional()
  termId?: string;

  @IsEnum(['draft', 'published', 'revised'])
  @IsOptional()
  status?: 'draft' | 'published' | 'revised';

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  limit?: number;

  @IsString()
  @IsOptional()
  lastEvaluatedKey?: string;
}

// Analytics DTOs
export class GradeAnalyticsFilterDto {
  @IsString()
  @IsOptional()
  studentId?: string;

  @IsString()
  @IsOptional()
  classroomId?: string;

  @IsString()
  @IsOptional()
  termId?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}

export class TeacherAnalyticsFilterDto {
  @IsString()
  @IsOptional()
  classroomId?: string;

  @IsString()
  @IsOptional()
  termId?: string;

  @IsDateString()
  @IsOptional()
  startDate?: string;

  @IsDateString()
  @IsOptional()
  endDate?: string;
}

