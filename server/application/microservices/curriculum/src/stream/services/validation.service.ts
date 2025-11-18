import { Injectable, BadRequestException } from '@nestjs/common';
import { CreateStreamPostDto, CreatePostCommentDto } from '../dto/stream.dto';

@Injectable()
export class ValidationService {
  /**
   * Validate stream post creation
   */
  async validateStreamPostCreation(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    createDto: CreateStreamPostDto
  ): Promise<void> {
    // Validate required fields
    if (!createDto.content || createDto.content.trim().length === 0) {
      throw new BadRequestException('Post content is required');
    }

    // Validate content length
    if (createDto.content.length > 10000) {
      throw new BadRequestException('Post content cannot exceed 10000 characters');
    }

    // Validate post type
    const validPostTypes = ['announcement', 'question', 'material', 'assignment_created', 'grade_posted', 'general'];
    if (createDto.postType && !validPostTypes.includes(createDto.postType)) {
      throw new BadRequestException('Invalid post type');
    }

    // Validate attachments
    if (createDto.attachments && createDto.attachments.length > 10) {
      throw new BadRequestException('Cannot attach more than 10 files');
    }

    if (createDto.attachments) {
      for (const attachment of createDto.attachments) {
        // Validate file size (max 50MB per file)
        if (attachment.fileSize > 50 * 1024 * 1024) {
          throw new BadRequestException('File size cannot exceed 50MB');
        }

        // Validate file type
        const allowedTypes = [
          'image/jpeg', 'image/png', 'image/gif', 'image/webp',
          'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'text/plain', 'text/csv',
          'video/mp4', 'video/quicktime',
          'audio/mpeg', 'audio/wav'
        ];

        if (!allowedTypes.includes(attachment.fileType)) {
          throw new BadRequestException(`File type ${attachment.fileType} is not allowed`);
        }

        // Validate file name
        if (!attachment.fileName || attachment.fileName.trim().length === 0) {
          throw new BadRequestException('File name is required');
        }

        if (attachment.fileName.length > 255) {
          throw new BadRequestException('File name cannot exceed 255 characters');
        }
      }
    }

    // Validate related entities
    if (createDto.relatedAssignmentId && !this.isValidUUID(createDto.relatedAssignmentId)) {
      throw new BadRequestException('Invalid assignment ID format');
    }

    if (createDto.relatedGradeId && !this.isValidUUID(createDto.relatedGradeId)) {
      throw new BadRequestException('Invalid grade ID format');
    }

    // TODO: Validate classroom exists and user has access
    // TODO: Validate related assignment/grade exists and belongs to classroom
  }

  /**
   * Validate post comment creation
   */
  async validatePostCommentCreation(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    createDto: CreatePostCommentDto
  ): Promise<void> {
    // Validate required fields
    if (!createDto.content || createDto.content.trim().length === 0) {
      throw new BadRequestException('Comment content is required');
    }

    // Validate content length
    if (createDto.content.length > 2000) {
      throw new BadRequestException('Comment content cannot exceed 2000 characters');
    }

    // Validate post ID format
    if (!this.isValidUUID(postId)) {
      throw new BadRequestException('Invalid post ID format');
    }

    // Validate parent comment ID if provided
    if (createDto.parentCommentId && !this.isValidUUID(createDto.parentCommentId)) {
      throw new BadRequestException('Invalid parent comment ID format');
    }

    // TODO: Validate post exists and allows comments
    // TODO: Validate parent comment exists if provided
    // TODO: Validate user has access to classroom
  }

  /**
   * Validate stream post update
   */
  async validateStreamPostUpdate(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    updateDto: any
  ): Promise<void> {
    // Validate post ID format
    if (!this.isValidUUID(postId)) {
      throw new BadRequestException('Invalid post ID format');
    }

    // Validate content if provided
    if (updateDto.content !== undefined) {
      if (!updateDto.content || updateDto.content.trim().length === 0) {
        throw new BadRequestException('Post content cannot be empty');
      }

      if (updateDto.content.length > 10000) {
        throw new BadRequestException('Post content cannot exceed 10000 characters');
      }
    }

    // Validate post type if provided
    if (updateDto.postType) {
      const validPostTypes = ['announcement', 'question', 'material', 'assignment_created', 'grade_posted', 'general'];
      if (!validPostTypes.includes(updateDto.postType)) {
        throw new BadRequestException('Invalid post type');
      }
    }

    // Validate attachments if provided
    if (updateDto.attachments) {
      if (updateDto.attachments.length > 10) {
        throw new BadRequestException('Cannot attach more than 10 files');
      }

      for (const attachment of updateDto.attachments) {
        if (attachment.fileSize > 50 * 1024 * 1024) {
          throw new BadRequestException('File size cannot exceed 50MB');
        }

        const allowedTypes = [
          'image/jpeg', 'image/png', 'image/gif', 'image/webp',
          'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          'text/plain', 'text/csv',
          'video/mp4', 'video/quicktime',
          'audio/mpeg', 'audio/wav'
        ];

        if (!allowedTypes.includes(attachment.fileType)) {
          throw new BadRequestException(`File type ${attachment.fileType} is not allowed`);
        }
      }
    }

    // TODO: Validate post exists and user has permission to edit
  }

  /**
   * Validate stream post deletion
   */
  async validateStreamPostDeletion(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    userId: string,
    userRole: string
  ): Promise<void> {
    // Validate post ID format
    if (!this.isValidUUID(postId)) {
      throw new BadRequestException('Invalid post ID format');
    }

    // TODO: Validate post exists
    // TODO: Validate user has permission to delete (author or admin)
  }

  /**
   * Validate pin/unpin operation
   */
  async validatePinOperation(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    userRole: string
  ): Promise<void> {
    // Validate post ID format
    if (!this.isValidUUID(postId)) {
      throw new BadRequestException('Invalid post ID format');
    }

    // Only teachers and admins can pin posts
    if (userRole !== 'teacher' && userRole !== 'admin') {
      throw new BadRequestException('Only teachers can pin posts');
    }

    // TODO: Validate post exists
  }

  /**
   * Validate stream post filters
   */
  async validateStreamPostFilters(filters: any): Promise<void> {
    // Validate post type filter
    if (filters.postType) {
      const validPostTypes = ['announcement', 'question', 'material', 'assignment_created', 'grade_posted', 'general'];
      if (!validPostTypes.includes(filters.postType)) {
        throw new BadRequestException('Invalid post type filter');
      }
    }

    // Validate author ID filter
    if (filters.authorId && !this.isValidUUID(filters.authorId)) {
      throw new BadRequestException('Invalid author ID format');
    }

    // Validate date filters
    if (filters.startDate && !this.isValidISODate(filters.startDate)) {
      throw new BadRequestException('Invalid start date format');
    }

    if (filters.endDate && !this.isValidISODate(filters.endDate)) {
      throw new BadRequestException('Invalid end date format');
    }

    if (filters.startDate && filters.endDate) {
      const startDate = new Date(filters.startDate);
      const endDate = new Date(filters.endDate);
      if (startDate >= endDate) {
        throw new BadRequestException('Start date must be before end date');
      }
    }

    // Validate pagination
    if (filters.limit && (filters.limit < 1 || filters.limit > 100)) {
      throw new BadRequestException('Limit must be between 1 and 100');
    }
  }

  /**
   * Helper method to validate UUID format
   */
  private isValidUUID(uuid: string): boolean {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Helper method to validate ISO date format
   */
  private isValidISODate(dateString: string): boolean {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime()) && dateString === date.toISOString();
  }
}
