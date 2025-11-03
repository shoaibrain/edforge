/*
 * Stream Post Entity - Represents posts in classroom stream
 * 
 * SINGLE-TABLE DESIGN:
 * PK: tenantId
 * SK: SCHOOL#{schoolId}#YEAR#{academicYearId}#CLASSROOM#{classroomId}#POST#{postId}
 * 
 * GSI1: classroomId#academicYearId -> List all posts for a classroom (chronological)
 * GSI2: authorId#academicYearId -> List all posts by a user
 * GSI3: postType#academicYearId -> List posts by type (announcements, questions, etc.)
 */

export interface BaseEntity {
  tenantId: string;
  entityKey: string;
  entityType: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  updatedBy: string;
  version: number;
}

export interface StreamPost extends BaseEntity {
  entityType: 'STREAM_POST';
  postId: string;
  schoolId: string;
  academicYearId: string;
  classroomId: string;
  
  // Author information
  authorId: string;
  authorName: string;
  authorRole: 'teacher' | 'student' | 'admin';
  authorAvatar?: string;
  
  // Post content
  content: string;
  postType: 'announcement' | 'question' | 'material' | 'assignment_created' | 'grade_posted' | 'general';
  
  // Post settings
  isPinned: boolean;
  isAnnouncement: boolean;
  allowComments: boolean;
  
  // Attachments
  attachments?: PostAttachment[];
  
  // Engagement metrics
  commentCount: number;
  likeCount: number;
  
  // Related entities (for notifications)
  relatedAssignmentId?: string;
  relatedGradeId?: string;
  
  // GSI keys
  gsi1pk: string; // classroomId#academicYearId
  gsi1sk: string; // POST#{createdAt}#{postId}
  gsi2pk: string; // authorId#academicYearId
  gsi2sk: string; // POST#{createdAt}#{postId}
  gsi3pk: string; // postType#academicYearId
  gsi3sk: string; // POST#{createdAt}#{postId}
}

export interface PostAttachment {
  attachmentId: string;
  fileName: string;
  fileUrl: string;
  fileType: string;
  fileSize: number;
  uploadedAt: string;
  uploadedBy: string;
}

export interface PostComment extends BaseEntity {
  entityType: 'POST_COMMENT';
  commentId: string;
  postId: string;
  schoolId: string;
  academicYearId: string;
  classroomId: string;
  
  // Author information
  authorId: string;
  authorName: string;
  authorRole: 'teacher' | 'student' | 'admin';
  authorAvatar?: string;
  
  // Comment content
  content: string;
  parentCommentId?: string; // For nested comments/replies
  
  // Engagement
  likeCount: number;
  
  // GSI keys
  gsi1pk: string; // postId
  gsi1sk: string; // COMMENT#{createdAt}#{commentId}
  gsi2pk: string; // authorId#academicYearId
  gsi2sk: string; // COMMENT#{createdAt}#{commentId}
}

export interface RequestContext {
  userId: string;
  jwtToken: string;
  tenantId: string;
  userName?: string;
  userRole?: string;
  userAvatar?: string;
}

export class EntityKeyBuilder {
  static streamPost(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string
  ): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#CLASSROOM#${classroomId}#POST#${postId}`;
  }

  static postComment(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    postId: string,
    commentId: string
  ): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#CLASSROOM#${classroomId}#POST#${postId}#COMMENT#${commentId}`;
  }
}
