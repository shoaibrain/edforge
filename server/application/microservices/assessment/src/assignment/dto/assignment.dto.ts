import { IsString, IsNotEmpty, IsOptional, IsArray, IsNumber, IsEnum, IsBoolean, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import type { AssignmentAttachmentDto as IAssignmentAttachmentDto, CreateAssignmentDto as ICreateAssignmentDto, UpdateAssignmentDto as IUpdateAssignmentDto } from '@edforge/shared-types';

export class AssignmentAttachmentDto implements IAssignmentAttachmentDto {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  fileUrl: string;

  @IsString()
  @IsNotEmpty()
  fileType: string;

  @IsNumber()
  @Min(0)
  fileSize: number;
}

export class CreateAssignmentDto implements ICreateAssignmentDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  instructions?: string;

  @IsEnum(['homework', 'project', 'quiz', 'test', 'lab', 'presentation', 'other'])
  @IsNotEmpty()
  type: 'homework' | 'project' | 'quiz' | 'test' | 'lab' | 'presentation' | 'other';

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsNotEmpty()
  assignedDate: string; // ISO 8601 date

  @IsString()
  @IsNotEmpty()
  dueDate: string; // ISO 8601 date

  @IsString()
  @IsOptional()
  availableFrom?: string; // ISO 8601 date

  @IsString()
  @IsOptional()
  availableUntil?: string; // ISO 8601 date

  @IsNumber()
  @IsNotEmpty()
  @Min(0)
  @Max(10000)
  maxPoints: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  weight?: number; // Percentage weight in final grade

  @IsNumber()
  @IsOptional()
  @Min(0)
  passingScore?: number;

  @IsBoolean()
  @IsOptional()
  allowLateSubmission?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  lateSubmissionPenalty?: number; // Percentage per day

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AssignmentAttachmentDto)
  attachments?: AssignmentAttachmentDto[];

  @IsEnum(['draft', 'published'])
  @IsOptional()
  status?: 'draft' | 'published';
}

export class UpdateAssignmentDto implements IUpdateAssignmentDto {
  @IsString()
  @IsOptional()
  title?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  instructions?: string;

  @IsEnum(['homework', 'project', 'quiz', 'test', 'lab', 'presentation', 'other'])
  @IsOptional()
  type?: 'homework' | 'project' | 'quiz' | 'test' | 'lab' | 'presentation' | 'other';

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  assignedDate?: string;

  @IsString()
  @IsOptional()
  dueDate?: string;

  @IsString()
  @IsOptional()
  availableFrom?: string;

  @IsString()
  @IsOptional()
  availableUntil?: string;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(10000)
  maxPoints?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  weight?: number;

  @IsNumber()
  @IsOptional()
  @Min(0)
  passingScore?: number;

  @IsBoolean()
  @IsOptional()
  allowLateSubmission?: boolean;

  @IsNumber()
  @IsOptional()
  @Min(0)
  @Max(100)
  lateSubmissionPenalty?: number;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AssignmentAttachmentDto)
  attachments?: AssignmentAttachmentDto[];

  @IsEnum(['draft', 'published', 'archived'])
  @IsOptional()
  status?: 'draft' | 'published' | 'archived';

  @IsNumber()
  @IsOptional()
  @Min(1)
  version?: number; // For optimistic locking
}

