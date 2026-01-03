/**
 * Academics Events Service
 * 
 * Publishes domain events from the Academics Service to the SBT EventBus.
 * Extends EventServiceBase for standardized event publishing.
 */

import { Injectable } from '@nestjs/common';
import { EventServiceBase, BaseDomainEvent } from '@app/events';

/**
 * Student-related domain events
 */
export interface StudentCreatedEvent extends BaseDomainEvent {
  eventType: 'StudentCreated';
  studentId: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  gradeLevel: string;
}

export interface StudentUpdatedEvent extends BaseDomainEvent {
  eventType: 'StudentUpdated';
  studentId: string;
  schoolId: string;
  updatedFields: string[];
}

export interface StudentDeletedEvent extends BaseDomainEvent {
  eventType: 'StudentDeleted';
  studentId: string;
  schoolId: string;
}

/**
 * Enrollment-related domain events
 */
export interface EnrollmentCompletedEvent extends BaseDomainEvent {
  eventType: 'EnrollmentCompleted';
  enrollmentId: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  gradeLevel: string;
}

export interface StudentWithdrawnEvent extends BaseDomainEvent {
  eventType: 'StudentWithdrawn';
  enrollmentId: string;
  studentId: string;
  schoolId: string;
  withdrawalDate: string;
  reason?: string;
}

export interface StudentTransferredEvent extends BaseDomainEvent {
  eventType: 'StudentTransferred';
  studentId: string;
  fromSchoolId: string;
  toSchoolId: string;
  transferDate: string;
}

/**
 * Attendance-related domain events
 */
export interface AttendanceRecordedEvent extends BaseDomainEvent {
  eventType: 'AttendanceRecorded';
  studentId: string;
  schoolId: string;
  date: string;
  status: string;
}

export interface BulkAttendanceRecordedEvent extends BaseDomainEvent {
  eventType: 'BulkAttendanceRecorded';
  schoolId: string;
  date: string;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
}

/**
 * Grade-related domain events (for future use)
 */
export interface GradePublishedEvent extends BaseDomainEvent {
  eventType: 'GradePublished';
  studentId: string;
  schoolId: string;
  courseId: string;
  grade: string;
  gradingPeriod: string;
}

/**
 * All Academics domain events
 */
export type AcademicsDomainEvent = 
  | StudentCreatedEvent 
  | StudentUpdatedEvent 
  | StudentDeletedEvent
  | EnrollmentCompletedEvent
  | StudentWithdrawnEvent
  | StudentTransferredEvent
  | AttendanceRecordedEvent
  | BulkAttendanceRecordedEvent
  | GradePublishedEvent;

@Injectable()
export class AcademicsEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.academics-service';

  /**
   * Publish student created event
   */
  async publishStudentCreated(
    tenantId: string,
    studentId: string,
    schoolId: string,
    firstName: string,
    lastName: string,
    gradeLevel: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'StudentCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      studentId,
      schoolId,
      firstName,
      lastName,
      gradeLevel,
    });
  }

  /**
   * Publish student updated event
   */
  async publishStudentUpdated(
    tenantId: string,
    studentId: string,
    schoolId: string,
    updatedFields: string[]
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'StudentUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      studentId,
      schoolId,
      updatedFields,
    });
  }

  /**
   * Publish enrollment completed event
   */
  async publishEnrollmentCompleted(
    tenantId: string,
    enrollmentId: string,
    studentId: string,
    schoolId: string,
    academicYearId: string,
    gradeLevel: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'EnrollmentCompleted',
      timestamp: new Date().toISOString(),
      tenantId,
      enrollmentId,
      studentId,
      schoolId,
      academicYearId,
      gradeLevel,
    });
  }

  /**
   * Publish student withdrawn event
   */
  async publishStudentWithdrawn(
    tenantId: string,
    enrollmentId: string,
    studentId: string,
    schoolId: string,
    withdrawalDate: string,
    reason?: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'StudentWithdrawn',
      timestamp: new Date().toISOString(),
      tenantId,
      enrollmentId,
      studentId,
      schoolId,
      withdrawalDate,
      reason,
    });
  }

  /**
   * Publish student transferred event
   */
  async publishStudentTransferred(
    tenantId: string,
    studentId: string,
    fromSchoolId: string,
    toSchoolId: string,
    transferDate: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'StudentTransferred',
      timestamp: new Date().toISOString(),
      tenantId,
      studentId,
      fromSchoolId,
      toSchoolId,
      transferDate,
    });
  }

  /**
   * Publish attendance recorded event
   */
  async publishAttendanceRecorded(
    tenantId: string,
    studentId: string,
    schoolId: string,
    date: string,
    status: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'AttendanceRecorded',
      timestamp: new Date().toISOString(),
      tenantId,
      studentId,
      schoolId,
      date,
      status,
    });
  }

  /**
   * Publish bulk attendance recorded event
   */
  async publishBulkAttendanceRecorded(
    tenantId: string,
    schoolId: string,
    date: string,
    totalRecords: number,
    presentCount: number,
    absentCount: number
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'BulkAttendanceRecorded',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      date,
      totalRecords,
      presentCount,
      absentCount,
    });
  }

  /**
   * Publish grade published event
   */
  async publishGradePublished(
    tenantId: string,
    studentId: string,
    schoolId: string,
    courseId: string,
    grade: string,
    gradingPeriod: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'GradePublished',
      timestamp: new Date().toISOString(),
      tenantId,
      studentId,
      schoolId,
      courseId,
      grade,
      gradingPeriod,
    });
  }
}
