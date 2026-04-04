/**
 * Enrollment Billing Events
 *
 * Event interfaces for enrollment→billing integration.
 * Published by academics service, consumed by finance service.
 */

export interface StudentEnrolledEvent {
  eventType: 'student.enrolled';
  tenantId: string;
  schoolId: string;
  studentId: string;
  gradeLevel: string;
  enrollmentDate: string;
  academicYearId: string;
  sectionId?: string;
}

export interface StudentSectionAssignedEvent {
  eventType: 'student.section.assigned';
  tenantId: string;
  schoolId: string;
  studentId: string;
  sectionId: string;
  courseId: string;
  enrollmentDate: string;
  academicYearId: string;
}

export interface StudentWithdrawnEvent {
  eventType: 'student.withdrawn';
  tenantId: string;
  schoolId: string;
  studentId: string;
  withdrawalDate: string;
  academicYearId: string;
  reason?: string;
}

export interface StudentTransferredEvent {
  eventType: 'student.transferred';
  tenantId: string;
  schoolId: string;
  studentId: string;
  fromSectionId: string;
  toSectionId: string;
  transferDate: string;
  academicYearId: string;
}

export type EnrollmentBillingEvent =
  | StudentEnrolledEvent
  | StudentSectionAssignedEvent
  | StudentWithdrawnEvent
  | StudentTransferredEvent;
