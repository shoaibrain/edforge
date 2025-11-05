import { IsString, IsNotEmpty, IsOptional, IsArray, IsEnum, IsBoolean, IsNumber, ValidateNested, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import type { 
  PostAttachmentDto as IPostAttachmentDto, 
  CreateStreamPostDto as ICreateStreamPostDto, 
  UpdateStreamPostDto as IUpdateStreamPostDto,
  CreatePostCommentDto as ICreatePostCommentDto,
  UpdatePostCommentDto as IUpdatePostCommentDto,
  StreamPostFiltersDto as IStreamPostFiltersDto
} from '@edforge/shared-types';

export class PostAttachmentDto implements IPostAttachmentDto {
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

export class CreateStreamPostDto implements ICreateStreamPostDto {
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

export class UpdateStreamPostDto implements IUpdateStreamPostDto {
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

export class CreatePostCommentDto implements ICreatePostCommentDto {
  @IsString()
  @IsNotEmpty()
  content: string;

  @IsString()
  @IsOptional()
  parentCommentId?: string; // For nested comments
}

export class UpdatePostCommentDto implements IUpdatePostCommentDto {
  @IsString()
  @IsOptional()
  content?: string;

  @IsNumber()
  @IsOptional()
  @Min(1)
  version?: number; // For optimistic locking
}

export class StreamPostFiltersDto implements IStreamPostFiltersDto {
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
