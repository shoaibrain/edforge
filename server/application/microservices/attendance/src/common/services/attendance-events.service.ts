/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Attendance Events Service - EventBridge publisher for Attendance Management bounded context
 */

import { Injectable } from '@nestjs/common';
import { EventServiceBase, BaseDomainEvent } from '@app/events';

/**
 * Domain Events Published by Attendance Service
 */
export type AttendanceDomainEvent =
  | AttendanceRecordedEvent
  | AttendanceUpdatedEvent
  | AbsenceExcusedEvent
  | ChronicAbsenteeismDetectedEvent
  | TruancyAlertGeneratedEvent;

export interface AttendanceRecordedEvent extends BaseDomainEvent {
  eventType: 'AttendanceRecorded';
  recordId: string;
  studentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  date: string;
  status: 'PRESENT' | 'ABSENT' | 'TARDY' | 'EXCUSED' | 'UNEXCUSED';
  recordedBy: string;
}

export interface AttendanceUpdatedEvent extends BaseDomainEvent {
  eventType: 'AttendanceUpdated';
  recordId: string;
  studentId: string;
  previousStatus: string;
  newStatus: string;
  reason?: string;
}

export interface AbsenceExcusedEvent extends BaseDomainEvent {
  eventType: 'AbsenceExcused';
  recordId: string;
  studentId: string;
  classroomId: string;
  schoolId: string;
  date: string;
  excuseNote?: string;
  excusedBy: string;
}

export interface ChronicAbsenteeismDetectedEvent extends BaseDomainEvent {
  eventType: 'ChronicAbsenteeismDetected';
  studentId: string;
  schoolId: string;
  academicYearId: string;
  absenceRate: number;
  totalAbsences: number;
  threshold: number;
}

export interface TruancyAlertGeneratedEvent extends BaseDomainEvent {
  eventType: 'TruancyAlertGenerated';
  studentId: string;
  schoolId: string;
  academicYearId: string;
  unexcusedAbsences: number;
  threshold: number;
}

@Injectable()
export class AttendanceEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.attendance-service';

  async publishAttendanceRecorded(event: Omit<AttendanceRecordedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AttendanceRecorded',
      timestamp: new Date().toISOString()
    });
  }

  async publishAttendanceUpdated(event: Omit<AttendanceUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AttendanceUpdated',
      timestamp: new Date().toISOString()
    });
  }

  async publishAbsenceExcused(event: Omit<AbsenceExcusedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AbsenceExcused',
      timestamp: new Date().toISOString()
    });
  }

  async publishChronicAbsenteeismDetected(event: Omit<ChronicAbsenteeismDetectedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ChronicAbsenteeismDetected',
      timestamp: new Date().toISOString()
    });
  }

  async publishTruancyAlertGenerated(event: Omit<TruancyAlertGeneratedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'TruancyAlertGenerated',
      timestamp: new Date().toISOString()
    });
  }
}

