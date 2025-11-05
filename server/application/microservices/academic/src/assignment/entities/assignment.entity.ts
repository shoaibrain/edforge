/*
 * Assignment Entity - Represents homework, projects, tasks assigned to students
 * 
 * SINGLE-TABLE DESIGN:
 * PK: tenantId
 * SK: SCHOOL#{schoolId}#YEAR#{academicYearId}#CLASSROOM#{classroomId}#ASSIGNMENT#{assignmentId}
 * 
 * GSI1: classroomId#academicYearId -> List all assignments for a classroom
 * GSI2: teacherId#academicYearId -> List all assignments created by a teacher
 * GSI3: studentId#academicYearId -> List all assignments for a student (via enrollment)
 */

import type { Assignment, AssignmentAttachment, RequestContext } from '@edforge/shared-types';

// Re-export types from shared-types
export type { Assignment, AssignmentAttachment, RequestContext } from '@edforge/shared-types';

export class EntityKeyBuilder {
  static assignment(
    schoolId: string,
    academicYearId: string,
    classroomId: string,
    assignmentId: string
  ): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#CLASSROOM#${classroomId}#ASSIGNMENT#${assignmentId}`;
  }
}

