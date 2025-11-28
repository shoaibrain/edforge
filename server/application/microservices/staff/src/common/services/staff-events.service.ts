/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Staff Events Service - EventBridge publisher for Staff Management bounded context
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';

/**
 * Domain Events Published by Staff Service
 */
export type StaffDomainEvent =
  | StaffHiredEvent
  | StaffUpdatedEvent
  | StaffTerminatedEvent
  | StaffAssignedToClassroomEvent
  | CertificationRenewedEvent
  | CertificationExpiringSoonEvent
  | ProfessionalDevelopmentCompletedEvent;

export interface BaseDomainEvent {
  eventType: string;
  tenantId: string;
  timestamp: string;
}

export interface StaffHiredEvent extends BaseDomainEvent {
  eventType: 'StaffHired';
  staffId: string;
  schoolId: string;
  staffType: string;
  departmentId?: string;
  hireDate: string;
  firstName: string;
  lastName: string;
}

export interface StaffUpdatedEvent extends BaseDomainEvent {
  eventType: 'StaffUpdated';
  staffId: string;
  schoolId: string;
  departmentId?: string;
  firstName: string;
  lastName: string;
  updatedFields?: string[];
}

export interface StaffTerminatedEvent extends BaseDomainEvent {
  eventType: 'StaffTerminated';
  staffId: string;
  schoolId: string;
  terminationDate: string;
  reason?: string;
}

export interface StaffAssignedToClassroomEvent extends BaseDomainEvent {
  eventType: 'StaffAssignedToClassroom';
  staffId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  role: string;
}

export interface CertificationRenewedEvent extends BaseDomainEvent {
  eventType: 'CertificationRenewed';
  staffId: string;
  certificationId: string;
  schoolId: string;
  renewalDate: string;
  expirationDate: string;
}

export interface CertificationExpiringSoonEvent extends BaseDomainEvent {
  eventType: 'CertificationExpiringSoon';
  staffId: string;
  certificationId: string;
  schoolId: string;
  expirationDate: string;
  daysUntilExpiration: number;
}

export interface ProfessionalDevelopmentCompletedEvent extends BaseDomainEvent {
  eventType: 'ProfessionalDevelopmentCompleted';
  staffId: string;
  schoolId: string;
  pdId: string;
  pdTitle: string;
  hoursCompleted: number;
  completionDate: string;
}

@Injectable()
export class StaffEventsService {
  private readonly logger = new Logger(StaffEventsService.name);
  private readonly eventBridge: EventBridgeClient;
  private readonly eventBusName: string;
  private readonly eventSource: string = 'edforge.staff-service';

  constructor() {
    this.eventBridge = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.eventBusName = process.env.EVENT_BUS_NAME || 'default';
    this.logger.log(`Staff Events Service initialized with bus: ${this.eventBusName}`);
  }

  /**
   * Publish a single domain event to EventBridge
   */
  private async publishEvent(event: StaffDomainEvent): Promise<void> {
    try {
      const entry: PutEventsRequestEntry = {
        Source: this.eventSource,
        DetailType: event.eventType,
        Detail: JSON.stringify(event),
        EventBusName: this.eventBusName,
        Time: new Date(event.timestamp)
      };

      const command = new PutEventsCommand({
        Entries: [entry]
      });

      const result = await this.eventBridge.send(command);

      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        this.logger.error('Failed to publish event:', {
          event: event.eventType,
          failures: result.Entries
        });
      } else {
        this.logger.log(`Event published: ${event.eventType}`, {
          staffId: (event as any).staffId,
          tenantId: event.tenantId,
          eventId: result.Entries?.[0].EventId
        });
      }
    } catch (error: any) {
      this.logger.error('Error publishing event to EventBridge:', error);
      // Don't throw - event publishing failure should not block main operation
    }
  }

  async publishStaffHired(event: Omit<StaffHiredEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StaffHired',
      timestamp: new Date().toISOString()
    } as StaffHiredEvent);
  }

  async publishStaffUpdated(event: Omit<StaffUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StaffUpdated',
      timestamp: new Date().toISOString()
    } as StaffUpdatedEvent);
  }

  async publishStaffTerminated(event: Omit<StaffTerminatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StaffTerminated',
      timestamp: new Date().toISOString()
    } as StaffTerminatedEvent);
  }

  async publishStaffAssignedToClassroom(event: Omit<StaffAssignedToClassroomEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StaffAssignedToClassroom',
      timestamp: new Date().toISOString()
    } as StaffAssignedToClassroomEvent);
  }

  async publishCertificationRenewed(event: Omit<CertificationRenewedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'CertificationRenewed',
      timestamp: new Date().toISOString()
    } as CertificationRenewedEvent);
  }

  async publishCertificationExpiringSoon(event: Omit<CertificationExpiringSoonEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'CertificationExpiringSoon',
      timestamp: new Date().toISOString()
    } as CertificationExpiringSoonEvent);
  }

  async publishProfessionalDevelopmentCompleted(event: Omit<ProfessionalDevelopmentCompletedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ProfessionalDevelopmentCompleted',
      timestamp: new Date().toISOString()
    } as ProfessionalDevelopmentCompletedEvent);
  }
}

