/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Attendance Events Service - EventBridge publisher for Attendance Management bounded context
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';

/**
 * Domain Events Published by Attendance Service
 */
export type AttendanceDomainEvent =
  | AttendanceRecordedEvent
  | AttendanceUpdatedEvent
  | AttendanceDeletedEvent
  | AbsenceExcusedEvent
  | ChronicAbsenteeismDetectedEvent
  | TruancyAlertGeneratedEvent;

export interface BaseDomainEvent {
  eventType: string;
  tenantId: string;
  timestamp: string;
}

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

export interface AttendanceDeletedEvent extends BaseDomainEvent {
  eventType: 'AttendanceDeleted';
  recordId: string;
  studentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  date: string;
  deletedBy: string;
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
export class AttendanceEventsService {
  private readonly logger = new Logger(AttendanceEventsService.name);
  private readonly eventBridge: EventBridgeClient;
  private readonly eventBusName: string;
  private readonly eventSource: string = 'edforge.attendance-service';

  constructor() {
    this.eventBridge = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.eventBusName = process.env.EVENT_BUS_NAME || 'default';
    this.logger.log(`Attendance Events Service initialized with bus: ${this.eventBusName}`);
  }

  private async publishEvent(event: AttendanceDomainEvent): Promise<void> {
    try {
      const entry: PutEventsRequestEntry = {
        Source: this.eventSource,
        DetailType: event.eventType,
        Detail: JSON.stringify(event),
        EventBusName: this.eventBusName !== 'default' ? this.eventBusName : undefined
      };

      const command = new PutEventsCommand({
        Entries: [entry]
      });

      const response = await this.eventBridge.send(command);

      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        const error = response.Entries?.[0]?.ErrorMessage || 'Unknown error';
        this.logger.error(`Failed to publish ${event.eventType} event: ${error}`);
        throw new Error(`Failed to publish event: ${error}`);
      }

      this.logger.debug(`Published ${event.eventType} event for tenant ${event.tenantId}`);
    } catch (error: any) {
      this.logger.error(`Error publishing ${event.eventType} event: ${error.message}`, error.stack);
      throw error;
    }
  }

  async publishAttendanceRecorded(event: Omit<AttendanceRecordedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AttendanceRecorded',
      timestamp: new Date().toISOString()
    } as AttendanceRecordedEvent);
  }

  async publishAttendanceUpdated(event: Omit<AttendanceUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AttendanceUpdated',
      timestamp: new Date().toISOString()
    } as AttendanceUpdatedEvent);
  }

  async publishAttendanceDeleted(event: Omit<AttendanceDeletedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AttendanceDeleted',
      timestamp: new Date().toISOString()
    } as AttendanceDeletedEvent);
  }

  async publishAbsenceExcused(event: Omit<AbsenceExcusedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AbsenceExcused',
      timestamp: new Date().toISOString()
    } as AbsenceExcusedEvent);
  }

  async publishChronicAbsenteeismDetected(event: Omit<ChronicAbsenteeismDetectedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ChronicAbsenteeismDetected',
      timestamp: new Date().toISOString()
    } as ChronicAbsenteeismDetectedEvent);
  }

  async publishTruancyAlertGenerated(event: Omit<TruancyAlertGeneratedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'TruancyAlertGenerated',
      timestamp: new Date().toISOString()
    } as TruancyAlertGeneratedEvent);
  }
}

