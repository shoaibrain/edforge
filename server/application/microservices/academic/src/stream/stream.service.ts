import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import type { StreamPost, PostComment, RequestContext } from '@edforge/shared-types';
import { EntityKeyBuilder } from './entities/stream-post.entity';
import { CreateStreamPostDto, UpdateStreamPostDto, CreatePostCommentDto, UpdatePostCommentDto, StreamPostFiltersDto } from './dto/stream.dto';
import { ValidationService } from './services/validation.service';
import { retryWithBackoff } from '../common/utils/retry.util';

@Injectable()
export class StreamService {
  constructor(
    private readonly validationService: ValidationService
  ) {}

  private tableName: string = process.env.TABLE_NAME || 'ACADEMIC_TABLE';

  /**
   * Create a new stream post
   */
  async createPost(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    createDto: CreateStreamPostDto,
    context: RequestContext
  ): Promise<StreamPost> {
    try {
      // 1. Validate
      await this.validationService.validateStreamPostCreation(
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        createDto
      );

      // 2. Build entity
      const postId = uuid();
      const timestamp = new Date().toISOString();
      
      const post: StreamPost = {
        tenantId,
        entityKey: EntityKeyBuilder.streamPost(schoolId, academicYearId, classroomId, postId),
        entityType: 'STREAM_POST',
        postId,
        schoolId,
        academicYearId,
        classroomId,
        authorId: context.userId,
        authorName: context.userName || 'Unknown User',
        authorRole: (context.userRole as 'teacher' | 'student' | 'admin') || 'student',
        authorAvatar: context.userAvatar,
        content: createDto.content,
        postType: createDto.postType || 'general',
        isPinned: createDto.isPinned || false,
        isAnnouncement: createDto.isAnnouncement || false,
        allowComments: createDto.allowComments !== false, // Default to true
        attachments: createDto.attachments?.map(att => ({
          attachmentId: uuid(),
          fileName: att.fileName,
          fileUrl: att.fileUrl,
          fileType: att.fileType,
          fileSize: att.fileSize,
          uploadedAt: timestamp,
          uploadedBy: context.userId
        })),
        commentCount: 0,
        likeCount: 0,
        relatedAssignmentId: createDto.relatedAssignmentId,
        relatedGradeId: createDto.relatedGradeId,
        createdAt: timestamp,
        createdBy: context.userId,
        updatedAt: timestamp,
        updatedBy: context.userId,
        version: 1,
        // GSI keys
        gsi1pk: `${classroomId}#${academicYearId}`,
        gsi1sk: `POST#${timestamp}#${postId}`,
        gsi2pk: `${context.userId}#${academicYearId}`,
        gsi2sk: `POST#${timestamp}#${postId}`,
        gsi3pk: `${createDto.postType || 'general'}#${academicYearId}`,
        gsi3sk: `POST#${timestamp}#${postId}`
      };

      // 3. Save to database
      // TODO: Implement DynamoDB save operation
      console.log('Creating stream post:', post);

      return post;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to create stream post');
    }
  }

  /**
   * Get stream posts for a classroom
   */
  async getStreamPosts(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    filters: StreamPostFiltersDto,
    jwtToken: string
  ): Promise<{ posts: StreamPost[]; lastEvaluatedKey?: string }> {
    try {
      // TODO: Implement DynamoDB query using GSI1
      // Query: gsi1pk = classroomId#academicYearId
      // Sort by gsi1sk (chronological order)
      
      console.log('Getting stream posts for classroom:', {
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        filters
      });

      // Mock response for now
      return {
        posts: [],
        lastEvaluatedKey: undefined
      };
    } catch (error) {
      throw new InternalServerErrorException('Failed to get stream posts');
    }
  }

  /**
   * Get a specific stream post
   */
  async getStreamPost(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    jwtToken: string
  ): Promise<StreamPost> {
    try {
      // TODO: Implement DynamoDB get operation
      console.log('Getting stream post:', {
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        postId
      });

      throw new NotFoundException('Stream post not found');
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to get stream post');
    }
  }

  /**
   * Update a stream post
   */
  async updateStreamPost(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    updateDto: UpdateStreamPostDto,
    context: RequestContext
  ): Promise<StreamPost> {
    try {
      // 1. Use retry mechanism with fresh data fetch on conflict
      const updatedPost = await retryWithBackoff(
        async () => {
          // Fetch fresh post data on each retry attempt to get latest version
          const existingPost = await this.getStreamPost(tenantId, schoolId, academicYearId, classroomId, postId, context.jwtToken);
          
          // 2. Validate permissions (only author can edit)
          if (existingPost.authorId !== context.userId) {
            throw new BadRequestException('Only the author can edit this post');
          }

          // Use the fresh version from database
          const currentVersion = existingPost.version;

          // 3. Update fields
          const timestamp = new Date().toISOString();
          const updated: StreamPost = {
            ...existingPost,
            ...updateDto,
            attachments: updateDto.attachments?.map(att => ({
              attachmentId: uuid(),
              fileName: att.fileName,
              fileUrl: att.fileUrl,
              fileType: att.fileType,
              fileSize: att.fileSize,
              uploadedAt: timestamp,
              uploadedBy: context.userId
            })) || existingPost.attachments,
            updatedAt: timestamp,
            updatedBy: context.userId,
            version: currentVersion + 1
          };

          // 4. Save to database
          // TODO: Implement DynamoDB update operation
          // await this.dynamoDBClient.updateItem(...)

          return updated;
        },
        {
          maxAttempts: 3,
          baseDelay: 100,
          maxDelay: 2000
        },
        console // Use console as logger
      ).catch((error) => {
        // Transform error to user-friendly message
        if (error.name === 'ConditionalCheckFailedException' || error.message?.includes('Update condition not met')) {
          throw new BadRequestException('Post has been modified by another user. Please refresh and try again.');
        }
        throw error;
      });

      console.log(`✅ Stream post updated: ${postId} (v${updatedPost.version})`);
      return updatedPost;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to update stream post');
    }
  }

  /**
   * Delete a stream post
   */
  async deleteStreamPost(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    context: RequestContext
  ): Promise<void> {
    try {
      // 1. Get existing post
      const existingPost = await this.getStreamPost(tenantId, schoolId, academicYearId, classroomId, postId, context.jwtToken);
      
      // 2. Validate permissions (only author or admin can delete)
      if (existingPost.authorId !== context.userId && context.userRole !== 'admin') {
        throw new BadRequestException('Only the author or admin can delete this post');
      }

      // 3. Delete from database
      // TODO: Implement DynamoDB delete operation
      console.log('Deleting stream post:', {
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        postId
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to delete stream post');
    }
  }

  /**
   * Create a comment on a stream post
   */
  async createComment(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    createDto: CreatePostCommentDto,
    context: RequestContext
  ): Promise<PostComment> {
    try {
      // 1. Validate post exists and allows comments
      const post = await this.getStreamPost(tenantId, schoolId, academicYearId, classroomId, postId, context.jwtToken);
      if (!post.allowComments) {
        throw new BadRequestException('Comments are not allowed on this post');
      }

      // 2. Build comment entity
      const commentId = uuid();
      const timestamp = new Date().toISOString();
      
      const comment: PostComment = {
        tenantId,
        entityKey: EntityKeyBuilder.postComment(schoolId, academicYearId, classroomId, postId, commentId),
        entityType: 'POST_COMMENT',
        commentId,
        postId,
        schoolId,
        academicYearId,
        classroomId,
        authorId: context.userId,
        authorName: context.userName || 'Unknown User',
        authorRole: (context.userRole as 'teacher' | 'student' | 'admin') || 'student',
        authorAvatar: context.userAvatar,
        content: createDto.content,
        parentCommentId: createDto.parentCommentId,
        likeCount: 0,
        createdAt: timestamp,
        createdBy: context.userId,
        updatedAt: timestamp,
        updatedBy: context.userId,
        version: 1,
        // GSI keys
        gsi1pk: postId,
        gsi1sk: `COMMENT#${timestamp}#${commentId}`,
        gsi2pk: `${context.userId}#${academicYearId}`,
        gsi2sk: `COMMENT#${timestamp}#${commentId}`
      };

      // 3. Save comment
      // TODO: Implement DynamoDB save operation
      console.log('Creating comment:', comment);

      // 4. Update post comment count
      // TODO: Implement atomic counter update
      console.log('Updating post comment count');

      return comment;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to create comment');
    }
  }

  /**
   * Get comments for a stream post
   */
  async getPostComments(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    jwtToken: string
  ): Promise<PostComment[]> {
    try {
      // TODO: Implement DynamoDB query using GSI1
      // Query: gsi1pk = postId
      // Sort by gsi1sk (chronological order)
      
      console.log('Getting comments for post:', {
        tenantId,
        schoolId,
        academicYearId,
        classroomId,
        postId
      });

      // Mock response for now
      return [];
    } catch (error) {
      throw new InternalServerErrorException('Failed to get comments');
    }
  }

  /**
   * Pin/unpin a stream post
   */
  async togglePinPost(
    tenantId: string,
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    context: RequestContext
  ): Promise<StreamPost> {
    try {
      // 1. Get existing post
      const existingPost = await this.getStreamPost(tenantId, schoolId, academicYearId, classroomId, postId, context.jwtToken);
      
      // 2. Validate permissions (only teachers can pin posts)
      if (context.userRole !== 'teacher' && context.userRole !== 'admin') {
        throw new BadRequestException('Only teachers can pin posts');
      }

      // 3. Toggle pin status
      const timestamp = new Date().toISOString();
      const updatedPost: StreamPost = {
        ...existingPost,
        isPinned: !existingPost.isPinned,
        updatedAt: timestamp,
        updatedBy: context.userId,
        version: existingPost.version + 1
      };

      // 4. Save to database
      // TODO: Implement DynamoDB update operation
      console.log('Toggling pin status:', updatedPost);

      return updatedPost;
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException('Failed to toggle pin status');
    }
  }
}
