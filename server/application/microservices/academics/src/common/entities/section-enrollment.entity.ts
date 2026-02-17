/**
 * Section Enrollment Entity for Academics Service
 *
 * Junction entity linking students to course sections.
 * Separate from school Enrollment (which is school-year level).
 *
 * Key Structure:
 * - PK: TENANT#{tenantId}
 * - SK: SEC_ENROLL#{schoolId}#{sectionId}#{studentId}
 *
 * GSI1 (School scope - list by section):
 * - GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * - GSI1SK: SEC_ENROLL#{sectionId}#{studentLastName}
 *
 * GSI2 (Student-centric - list student's sections):
 * - GSI2PK: {studentId}
 * - GSI2SK: SEC_ENROLL#{academicYearId}#{courseCode}
 */

import {
  BaseEntity,
  GSIKeyBuilder,
} from './base.entity';

export interface SectionEnrollment extends BaseEntity {
  entityType: 'SEC_ENROLL';

  // References
  studentId: string;
  sectionId: string;
  courseId: string;
  schoolId: string;
  academicYearId: string;

  // Denormalized for read efficiency
  studentName?: string;
  studentNumber?: string;
  currentGradeLevel?: string;
  courseCode?: string;
  courseName?: string;
  sectionNumber?: string;

  // Status
  isActive: boolean;
  enrolledAt: string;
  enrolledBy: string;
  droppedAt?: string;
  droppedBy?: string;
  dropReason?: string;

  // GSI Keys
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

/**
 * Build the entity key for a section enrollment
 */
export function sectionEnrollmentKey(
  schoolId: string,
  sectionId: string,
  studentId: string,
): string {
  return `SEC_ENROLL#${schoolId}#${sectionId}#${studentId}`;
}

/**
 * Create a new SectionEnrollment entity with proper keys
 */
export function createSectionEnrollmentEntity(
  tenantId: string,
  schoolId: string,
  sectionId: string,
  studentId: string,
  data: {
    courseId: string;
    academicYearId: string;
    studentName?: string;
    studentNumber?: string;
    currentGradeLevel?: string;
    courseCode?: string;
    courseName?: string;
    sectionNumber?: string;
    enrolledBy: string;
  },
): SectionEnrollment {
  const now = new Date().toISOString();
  const studentSortName = data.studentName?.toUpperCase() || studentId;

  return {
    tenantId,
    entityKey: sectionEnrollmentKey(schoolId, sectionId, studentId),
    entityType: 'SEC_ENROLL' as const,
    studentId,
    sectionId,
    courseId: data.courseId,
    schoolId,
    academicYearId: data.academicYearId,
    studentName: data.studentName,
    studentNumber: data.studentNumber,
    currentGradeLevel: data.currentGradeLevel,
    courseCode: data.courseCode,
    courseName: data.courseName,
    sectionNumber: data.sectionNumber,
    isActive: true,
    enrolledAt: now,
    enrolledBy: data.enrolledBy,
    createdAt: now,
    createdBy: data.enrolledBy,
    updatedAt: now,
    updatedBy: data.enrolledBy,
    version: 1,
    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: `SEC_ENROLL#${sectionId}#${studentSortName}`,
    gsi2pk: studentId,
    gsi2sk: `SEC_ENROLL#${data.academicYearId}#${data.courseCode || data.courseId}`,
  };
}
