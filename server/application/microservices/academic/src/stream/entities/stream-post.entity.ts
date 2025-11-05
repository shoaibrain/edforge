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

import type { StreamPost, PostAttachment, PostComment, RequestContext } from '@edforge/shared-types';

// Re-export types from shared-types
export type { StreamPost, PostAttachment, PostComment, RequestContext } from '@edforge/shared-types';

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
