/*
 * Classroom Entity - Represents a class/course in the academic system
 * 
 * SINGLE-TABLE DESIGN:
 * PK: tenantId
 * SK: SCHOOL#{schoolId}#YEAR#{academicYearId}#CLASSROOM#{classroomId}
 * 
 * GSI1: schoolId#academicYearId -> List all classrooms in a school/year
 * GSI2: teacherId#academicYearId -> List all classrooms for a teacher
 */

import type { Classroom, ClassSchedule, RequestContext } from '@edforge/shared-types';

// Re-export types from shared-types
export type { Classroom, ClassSchedule, RequestContext } from '@edforge/shared-types';

export class EntityKeyBuilder {
  static classroom(schoolId: string, academicYearId: string, classroomId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#CLASSROOM#${classroomId}`;
  }
}

