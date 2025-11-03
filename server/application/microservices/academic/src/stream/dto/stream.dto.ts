import { IsString, IsNotEmpty, IsOptional, IsArray, IsEnum, IsBoolean, IsNumber, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class PostAttachmentDto {
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

export class CreateStreamPostDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsEnum(['announcement', 'question', 'material', 'assignment_created', 'grade_posted', 'general'])
  @IsOptional()
  postType?: 'announcement' | 'question' | 'material' | 'assignment_created' | 'grade_posted' | 'general';

  @IsBoolean()
  @IsOptional()
  isPinned?: boolean;

  @IsBoolean()
  @IsOptional()
  isAnnouncement?: boolean;

  @IsBoolean()
  @IsOptional()
  allowComments?: boolean;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PostAttachmentDto)
  attachments?: PostAttachmentDto[];

  @IsString()
  @IsOptional()
  relatedAssignmentId?: string;

  @IsString()
  @IsOptional()
  relatedGradeId?: string;
}

export class UpdateStreamPostDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsEnum(['announcement', 'question', 'material', 'assignment_created', 'grade_posted', 'general'])
  @IsOptional()
  postType?: 'announcement' | 'question' | 'material' | 'assignment_created' | 'grade_posted' | 'general';

  @IsBoolean()
  @IsOptional()
  isPinned?: boolean;

  @IsBoolean()
  @IsOptional()
  isAnnouncement?: boolean;

  @IsBoolean()
  @IsOptional()
  allowComments?: boolean;

  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => PostAttachmentDto)
  attachments?: PostAttachmentDto[];

  @IsNumber()
  @IsOptional()
  @Min(1)
  version?: number; // For optimistic locking
}

export class CreatePostCommentDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  parentCommentId?: string; // For nested comments
}

export class UpdatePostCommentDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  version?: number; // For optimistic locking
}

export class StreamPostFiltersDto {
  @IsString()
  @IsOptional()
  postType?: string;

  @IsString()
  @IsOptional()
  authorId?: string;

  @IsBoolean()
  @IsOptional()
  isPinned?: boolean;

  @IsBoolean()
  @IsOptional()
  isAnnouncement?: boolean;

  @IsString()
  @IsOptional()
  startDate?: string; // ISO 8601

  @IsString()
  @IsOptional()
  endDate?: string; // ISO 8601

  @IsNumber()
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsString()
  @IsOptional()
  lastEvaluatedKey?: string; // For pagination
}
