/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Enrollment Events Service - EventBridge publisher for Enrollment & Student Records bounded context
 */

import { Injectable } from '@nestjs/common';
import { EventServiceBase, BaseDomainEvent } from '@app/events';

/**
 * Domain Events Published by Enrollment Service
 */
export type EnrollmentDomainEvent =
  | StudentCreatedEvent
  | StudentUpdatedEvent
  | StudentEnrolledEvent
  | StudentWithdrawnEvent
  | StudentEnrolledInClassroomEvent
  | StudentUnenrolledFromClassroomEvent
  | TranscriptGeneratedEvent
  | TransferInitiatedEvent
  | TransferCompletedEvent;

export interface StudentCreatedEvent extends BaseDomainEvent {
  eventType: 'StudentCreated';
  studentId: string;
  schoolId: string;
  studentNumber: string;
  gradeLevel: string;
  firstName: string;
  lastName: string;
}

export interface StudentUpdatedEvent extends BaseDomainEvent {
  eventType: 'StudentUpdated';
  studentId: string;
  schoolId: string;
  changes: Record<string, any>;
}

export interface StudentEnrolledEvent extends BaseDomainEvent {
  eventType: 'StudentEnrolled';
  studentId: string;
  schoolId: string;
  academicYearId: string;
  enrollmentId: string;
  enrollmentDate: string;
  gradeLevel: string;
}

export interface StudentWithdrawnEvent extends BaseDomainEvent {
  eventType: 'StudentWithdrawn';
  studentId: string;
  schoolId: string;
  academicYearId: string;
  withdrawalDate: string;
  withdrawalReason: string;
}

export interface StudentEnrolledInClassroomEvent extends BaseDomainEvent {
  eventType: 'StudentEnrolledInClassroom';
  studentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  enrollmentId: string;
  enrollmentDate: string;
}

export interface StudentUnenrolledFromClassroomEvent extends BaseDomainEvent {
  eventType: 'StudentUnenrolledFromClassroom';
  studentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  unenrollmentDate: string;
  reason?: string;
}

export interface TranscriptGeneratedEvent extends BaseDomainEvent {
  eventType: 'TranscriptGenerated';
  studentId: string;
  schoolId: string;
  transcriptId: string;
  academicYearId: string;
  cumulativeGpa: number;
}

export interface TransferInitiatedEvent extends BaseDomainEvent {
  eventType: 'TransferInitiated';
  studentId: string;
  fromSchoolId: string;
  toSchoolId: string;
  transferId: string;
  transferDate: string;
}

export interface TransferCompletedEvent extends BaseDomainEvent {
  eventType: 'TransferCompleted';
  studentId: string;
  fromSchoolId: string;
  toSchoolId: string;
  transferId: string;
  completionDate: string;
}

@Injectable()
export class EnrollmentEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.enrollment-service';

  async publishStudentCreated(event: Omit<StudentCreatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StudentCreated',
      timestamp: new Date().toISOString()
    });
  }

  async publishStudentUpdated(event: Omit<StudentUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StudentUpdated',
      timestamp: new Date().toISOString()
    });
  }

  async publishStudentEnrolled(event: Omit<StudentEnrolledEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StudentEnrolled',
      timestamp: new Date().toISOString()
    });
  }

  async publishStudentWithdrawn(event: Omit<StudentWithdrawnEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StudentWithdrawn',
      timestamp: new Date().toISOString()
    });
  }

  async publishStudentEnrolledInClassroom(event: Omit<StudentEnrolledInClassroomEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StudentEnrolledInClassroom',
      timestamp: new Date().toISOString()
    });
  }

  async publishStudentUnenrolledFromClassroom(event: Omit<StudentUnenrolledFromClassroomEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StudentUnenrolledFromClassroom',
      timestamp: new Date().toISOString()
    });
  }

  async publishTranscriptGenerated(event: Omit<TranscriptGeneratedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'TranscriptGenerated',
      timestamp: new Date().toISOString()
    });
  }

  async publishTransferInitiated(event: Omit<TransferInitiatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'TransferInitiated',
      timestamp: new Date().toISOString()
    });
  }

  async publishTransferCompleted(event: Omit<TransferCompletedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'TransferCompleted',
      timestamp: new Date().toISOString()
    });
  }
}

