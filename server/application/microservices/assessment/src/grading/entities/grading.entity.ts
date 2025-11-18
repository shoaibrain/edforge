/*
 * Grading Entity - Represents grades for assignments and overall grade calculations
 * 
 * SINGLE-TABLE DESIGN:
 * PK: tenantId
 * SK: SCHOOL#{schoolId}#YEAR#{academicYearId}#STUDENT#{studentId}#ASSIGNMENT#{assignmentId}#GRADE
 * 
 * GSI1: classroomId#academicYearId -> List all grades for a classroom
 * GSI2: teacherId#academicYearId -> List all grades submitted by a teacher
 * GSI3: studentId#academicYearId -> List all grades for a student
 */

import type { 
  BaseEntity, 
  Grade, 
  GradingSystem, 
  GradeCategory, 
  AcademicTerm, 
  RubricScore, 
  RequestContext 
} from '@edforge/shared-types';

// Re-export types from shared-types
export type { 
  BaseEntity, 
  Grade, 
  GradingSystem, 
  GradeCategory, 
  AcademicTerm, 
  RubricScore, 
  RequestContext,
  GradeAnalytics,
  TeacherAnalytics,
  GradingScale,
  GradeRange
} from '@edforge/shared-types';

export class EntityKeyBuilder {
  static grade(
    schoolId: string,
    academicYearId: string,
    studentId: string,
    assignmentId?: string
  ): string {
    const assignmentPart = assignmentId ? `#ASSIGNMENT#${assignmentId}` : '';
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#STUDENT#${studentId}${assignmentPart}#GRADE`;
  }

  static gradingSystem(schoolId: string, academicYearId: string, systemId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#GRADING_SYSTEM#${systemId}`;
  }

  static gradeCategory(schoolId: string, academicYearId: string, categoryId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#GRADE_CATEGORY#${categoryId}`;
  }

  static academicTerm(schoolId: string, academicYearId: string, termId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#ACADEMIC_TERM#${termId}`;
  }

  static gradeAnalytics(schoolId: string, academicYearId: string, analyticsId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#GRADE_ANALYTICS#${analyticsId}`;
  }

  static teacherAnalytics(schoolId: string, academicYearId: string, analyticsId: string): string {
    return `SCHOOL#${schoolId}#YEAR#${academicYearId}#TEACHER_ANALYTICS#${analyticsId}`;
  }
}

