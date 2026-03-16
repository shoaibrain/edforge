/**
 * Academics Events Service
 * 
 * Publishes domain events from the Academics Service to the SBT EventBus.
 * Extends EventServiceBase for standardized event publishing.
 */

import { Injectable, Logger } from '@nestjs/common';
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

export interface SectionAttendanceRecordedEvent extends BaseDomainEvent {
  eventType: 'SectionAttendanceRecorded';
  sectionId: string;
  studentId: string;
  schoolId: string;
  date: string;
  status: string;
}

export interface BulkSectionAttendanceRecordedEvent extends BaseDomainEvent {
  eventType: 'BulkSectionAttendanceRecorded';
  sectionId: string;
  schoolId: string;
  date: string;
  totalRecords: number;
  presentCount: number;
  absentCount: number;
}

/**
 * Course-related domain events
 */
export interface CourseCreatedEvent extends BaseDomainEvent {
  eventType: 'CourseCreated';
  courseId: string;
  schoolId: string;
  courseCode: string;
  courseName: string;
}

export interface CourseUpdatedEvent extends BaseDomainEvent {
  eventType: 'CourseUpdated';
  courseId: string;
  schoolId: string;
  updatedFields: string[];
}

export interface CourseDeletedEvent extends BaseDomainEvent {
  eventType: 'CourseDeleted';
  courseId: string;
  schoolId: string;
}

/**
 * Section-related domain events
 */
export interface SectionCreatedEvent extends BaseDomainEvent {
  eventType: 'SectionCreated';
  sectionId: string;
  courseId: string;
  schoolId: string;
  sectionNumber: string;
}

export interface SectionUpdatedEvent extends BaseDomainEvent {
  eventType: 'SectionUpdated';
  sectionId: string;
  courseId: string;
  schoolId: string;
  updatedFields: string[];
}

export interface SectionDeletedEvent extends BaseDomainEvent {
  eventType: 'SectionDeleted';
  sectionId: string;
  courseId: string;
  schoolId: string;
}

/**
 * Grade-related domain events
 */
export interface GradeRecordedEvent extends BaseDomainEvent {
  eventType: 'GradeRecorded';
  studentId: string;
  courseId: string;
  schoolId: string;
  termId: string;
  assignmentId: string;
}

export interface GradeBulkRecordedEvent extends BaseDomainEvent {
  eventType: 'GradeBulkRecorded';
  schoolId: string;
  courseId: string;
  sectionId: string;
  termId: string;
  totalRecords: number;
}

export interface GradeFinalizedEvent extends BaseDomainEvent {
  eventType: 'GradeFinalized';
  studentId: string;
  courseId: string;
  schoolId: string;
  termId: string;
  numericGrade?: number;
  letterGrade?: string;
}

export interface GradePublishedEvent extends BaseDomainEvent {
  eventType: 'GradePublished';
  studentId: string;
  schoolId: string;
  courseId: string;
  grade: string;
  gradingPeriod: string;
}

/**
 * Grading policy domain events
 */
export interface GradingPolicyCreatedEvent extends BaseDomainEvent {
  eventType: 'GradingPolicyCreated';
  policyId: string;
  schoolId: string;
  policyName: string;
}

export interface GradingPolicyUpdatedEvent extends BaseDomainEvent {
  eventType: 'GradingPolicyUpdated';
  policyId: string;
  schoolId: string;
  updatedFields: string[];
}

/**
 * Classwork-related domain events
 */
export interface ClassworkItemCreatedEvent extends BaseDomainEvent {
  eventType: 'ClassworkItemCreated';
  itemId: string;
  sectionId: string;
  schoolId: string;
  type: string;
  title: string;
}

export interface ClassworkItemUpdatedEvent extends BaseDomainEvent {
  eventType: 'ClassworkItemUpdated';
  itemId: string;
  sectionId: string;
  schoolId: string;
  updatedFields: string[];
}

export interface ClassworkItemDeletedEvent extends BaseDomainEvent {
  eventType: 'ClassworkItemDeleted';
  itemId: string;
  sectionId: string;
  schoolId: string;
  type: string;
}

export interface ClassworkTopicCreatedEvent extends BaseDomainEvent {
  eventType: 'ClassworkTopicCreated';
  topicId: string;
  sectionId: string;
  schoolId: string;
  name: string;
}

export interface ClassworkTopicUpdatedEvent extends BaseDomainEvent {
  eventType: 'ClassworkTopicUpdated';
  topicId: string;
  sectionId: string;
  schoolId: string;
  updatedFields: string[];
}

export interface ClassworkTopicDeletedEvent extends BaseDomainEvent {
  eventType: 'ClassworkTopicDeleted';
  topicId: string;
  sectionId: string;
  schoolId: string;
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
  | SectionAttendanceRecordedEvent
  | BulkSectionAttendanceRecordedEvent
  | CourseCreatedEvent
  | CourseUpdatedEvent
  | CourseDeletedEvent
  | SectionCreatedEvent
  | SectionUpdatedEvent
  | SectionDeletedEvent
  | GradeRecordedEvent
  | GradeBulkRecordedEvent
  | GradeFinalizedEvent
  | GradePublishedEvent
  | GradingPolicyCreatedEvent
  | GradingPolicyUpdatedEvent
  | ClassworkItemCreatedEvent
  | ClassworkItemUpdatedEvent
  | ClassworkItemDeletedEvent
  | ClassworkTopicCreatedEvent
  | ClassworkTopicUpdatedEvent
  | ClassworkTopicDeletedEvent;

@Injectable()
export class AcademicsEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.academics-service';
  private readonly logger = new Logger(AcademicsEventsService.name);

  /**
   * Override publishEvent to add structured logging around every event publish.
   * Logs event type, payload size, success/failure, and latency.
   */
  protected async publishEvent(event: BaseDomainEvent & Record<string, any>): Promise<void> {
    const eventType = event.eventType || 'unknown';
    const payloadSize = JSON.stringify(event).length;
    const start = Date.now();
    try {
      await super.publishEvent(event);
      this.logger.debug(`publishEvent: type=${eventType} payloadSize=${payloadSize}B ${Date.now() - start}ms`);
    } catch (error: any) {
      this.logger.error(`publishEvent FAILED: type=${eventType} payloadSize=${payloadSize}B ${Date.now() - start}ms — ${error.message}`);
      // Don't re-throw — event failures should not break the caller's operation
    }
  }

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
   * Publish section attendance recorded event
   */
  async publishSectionAttendanceRecorded(
    tenantId: string,
    sectionId: string,
    studentId: string,
    schoolId: string,
    date: string,
    status: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'SectionAttendanceRecorded',
      timestamp: new Date().toISOString(),
      tenantId,
      sectionId,
      studentId,
      schoolId,
      date,
      status,
    });
  }

  /**
   * Publish bulk section attendance recorded event
   */
  async publishBulkSectionAttendanceRecorded(
    tenantId: string,
    sectionId: string,
    schoolId: string,
    date: string,
    totalRecords: number,
    presentCount: number,
    absentCount: number,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'BulkSectionAttendanceRecorded',
      timestamp: new Date().toISOString(),
      tenantId,
      sectionId,
      schoolId,
      date,
      totalRecords,
      presentCount,
      absentCount,
    });
  }

  /**
   * Publish course created event
   */
  async publishCourseCreated(
    tenantId: string,
    courseId: string,
    schoolId: string,
    courseCode: string,
    courseName: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'CourseCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      courseId,
      schoolId,
      courseCode,
      courseName,
    });
  }

  /**
   * Publish course updated event
   */
  async publishCourseUpdated(
    tenantId: string,
    courseId: string,
    schoolId: string,
    updatedFields: string[],
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'CourseUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      courseId,
      schoolId,
      updatedFields,
    });
  }

  /**
   * Publish course deleted event
   */
  async publishCourseDeleted(
    tenantId: string,
    courseId: string,
    schoolId: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'CourseDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      courseId,
      schoolId,
    });
  }

  /**
   * Publish section created event
   */
  async publishSectionCreated(
    tenantId: string,
    sectionId: string,
    courseId: string,
    schoolId: string,
    sectionNumber: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'SectionCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      sectionId,
      courseId,
      schoolId,
      sectionNumber,
    });
  }

  /**
   * Publish section updated event
   */
  async publishSectionUpdated(
    tenantId: string,
    sectionId: string,
    courseId: string,
    schoolId: string,
    updatedFields: string[],
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'SectionUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      sectionId,
      courseId,
      schoolId,
      updatedFields,
    });
  }

  /**
   * Publish section deleted event
   */
  async publishSectionDeleted(
    tenantId: string,
    sectionId: string,
    courseId: string,
    schoolId: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'SectionDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      sectionId,
      courseId,
      schoolId,
    });
  }

  // ============================================================================
  // CLASSWORK EVENTS
  // ============================================================================

  async publishClassworkItemCreated(
    tenantId: string,
    itemId: string,
    sectionId: string,
    schoolId: string,
    type: string,
    title: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'ClassworkItemCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      itemId,
      sectionId,
      schoolId,
      type,
      title,
    });
  }

  async publishClassworkItemUpdated(
    tenantId: string,
    itemId: string,
    sectionId: string,
    schoolId: string,
    updatedFields: string[],
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'ClassworkItemUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      itemId,
      sectionId,
      schoolId,
      updatedFields,
    });
  }

  async publishClassworkItemDeleted(
    tenantId: string,
    itemId: string,
    sectionId: string,
    schoolId: string,
    type: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'ClassworkItemDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      itemId,
      sectionId,
      schoolId,
      type,
    });
  }

  async publishClassworkTopicCreated(
    tenantId: string,
    topicId: string,
    sectionId: string,
    schoolId: string,
    name: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'ClassworkTopicCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      topicId,
      sectionId,
      schoolId,
      name,
    });
  }

  async publishClassworkTopicUpdated(
    tenantId: string,
    topicId: string,
    sectionId: string,
    schoolId: string,
    updatedFields: string[],
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'ClassworkTopicUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      topicId,
      sectionId,
      schoolId,
      updatedFields,
    });
  }

  async publishClassworkTopicDeleted(
    tenantId: string,
    topicId: string,
    sectionId: string,
    schoolId: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'ClassworkTopicDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      topicId,
      sectionId,
      schoolId,
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
