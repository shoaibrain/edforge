/**
 * Course Offering Entity - Academics Service
 *
 * Ed-Fi: CourseOffering represents a Course offered in a specific
 * Session (academic term) at a school. This is the bridge between
 * Course (catalog) and Section (scheduled class instance).
 *
 * Chain: Course → CourseOffering → Section
 *
 * Key Patterns:
 * - PK: TENANT#{tenantId}
 * - SK: SCHOOL#{schoolId}#OFFERING#{courseOfferingId}
 *
 * GSI1 (School scope):
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: COURSE#{courseId}#ACADSESSION#{sessionId}
 */

import { BaseEntity, GSIKeyBuilder } from './base.entity';

// ============================================
// Course Offering Entity Interface
// ============================================

export interface CourseOffering extends BaseEntity {
  entityType: 'COURSE_OFFERING';

  // Identifiers
  courseOfferingId: string;
  schoolId: string;

  // Ed-Fi Core References
  courseId: string;
  academicSessionId: string;

  // Local overrides (Ed-Fi: localCourseCode, localCourseTitle)
  localCourseCode?: string;
  localCourseTitle?: string;

  // Denormalized for read efficiency
  courseName?: string;
  courseCode?: string;
  sessionName?: string;

  // GSI Keys
  gsi1pk: string;  // TENANT#{tid}#SCHOOL#{schoolId}
  gsi1sk: string;  // COURSE#{courseId}#ACADSESSION#{sessionId}
}

// ============================================
// Entity Key Builders
// ============================================

export const CourseOfferingKeyBuilder = {
  /**
   * CourseOffering: SCHOOL#{schoolId}#OFFERING#{courseOfferingId}
   */
  courseOffering: (schoolId: string, courseOfferingId: string): string =>
    `SCHOOL#${schoolId}#OFFERING#${courseOfferingId}`,

  /**
   * CourseOfferings for school (prefix): SCHOOL#{schoolId}#OFFERING#
   */
  courseOfferingsPrefix: (schoolId: string): string =>
    `SCHOOL#${schoolId}#OFFERING#`,

  /**
   * GSI1SK: COURSE#{courseId}#ACADSESSION#{sessionId}
   */
  courseSessionSort: (courseId: string, sessionId: string): string =>
    `COURSE#${courseId}#ACADSESSION#${sessionId}`,
};

// ============================================
// Factory Function
// ============================================

export function createCourseOfferingEntity(
  tenantId: string,
  schoolId: string,
  courseOfferingId: string,
  data: Omit<CourseOffering, 'tenantId' | 'entityKey' | 'entityType' | 'courseOfferingId' | 'schoolId' | 'gsi1pk' | 'gsi1sk'>
): CourseOffering {
  return {
    tenantId,
    entityKey: CourseOfferingKeyBuilder.courseOffering(schoolId, courseOfferingId),
    entityType: 'COURSE_OFFERING',
    courseOfferingId,
    schoolId,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: CourseOfferingKeyBuilder.courseSessionSort(data.courseId, data.academicSessionId),
    ...data,
  };
}
