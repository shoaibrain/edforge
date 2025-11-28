/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Parent Events Service - EventBridge publisher for Parent Engagement bounded context
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';

/**
 * Domain Events Published by Parent Portal Service
 */
export type ParentDomainEvent =
  | GuardianRegisteredEvent
  | ParentUpdatedEvent
  | ParentDeletedEvent
  | GuardianLinkedToStudentEvent
  | NotificationSentEvent
  | PortalAccessGrantedEvent;

export interface BaseDomainEvent {
  eventType: string;
  tenantId: string;
  timestamp: string;
}

export interface GuardianRegisteredEvent extends BaseDomainEvent {
  eventType: 'GuardianRegistered';
  guardianId: string;
  schoolId: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface GuardianLinkedToStudentEvent extends BaseDomainEvent {
  eventType: 'GuardianLinkedToStudent';
  guardianId: string;
  studentId: string;
  schoolId: string;
  relationshipType: string;
  isPrimary: boolean;
}

export interface NotificationSentEvent extends BaseDomainEvent {
  eventType: 'NotificationSent';
  notificationId: string;
  guardianId: string;
  studentId?: string;
  notificationType: string;
  channel: 'EMAIL' | 'SMS' | 'IN_APP';
  subject?: string;
  message: string;
}

export interface PortalAccessGrantedEvent extends BaseDomainEvent {
  eventType: 'PortalAccessGranted';
  guardianId: string;
  schoolId: string;
  accessLevel: string;
}

export interface ParentUpdatedEvent extends BaseDomainEvent {
  eventType: 'ParentUpdated';
  parentId: string;
  firstName: string;
  lastName: string;
  updatedFields?: string[];
}

export interface ParentDeletedEvent extends BaseDomainEvent {
  eventType: 'ParentDeleted';
  parentId: string;
  firstName: string;
  lastName: string;
  reason?: string;
}

@Injectable()
export class ParentEventsService {
  private readonly logger = new Logger(ParentEventsService.name);
  private readonly eventBridge: EventBridgeClient;
  private readonly eventBusName: string;
  private readonly eventSource: string = 'edforge.parent-portal-service';

  constructor() {
    this.eventBridge = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.eventBusName = process.env.EVENT_BUS_NAME || 'default';
    this.logger.log(`Parent Events Service initialized with bus: ${this.eventBusName}`);
  }

  /**
   * Publish a single domain event to EventBridge
   */
  private async publishEvent(event: ParentDomainEvent): Promise<void> {
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
          parentId: (event as any).parentId || (event as any).guardianId,
          tenantId: event.tenantId,
          eventId: result.Entries?.[0].EventId
        });
      }
    } catch (error: any) {
      this.logger.error('Error publishing event to EventBridge:', error);
      // Don't throw - event publishing failure should not block main operation
    }
  }

  async publishGuardianRegistered(event: Omit<GuardianRegisteredEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'GuardianRegistered',
      timestamp: new Date().toISOString()
    } as GuardianRegisteredEvent);
  }

  async publishParentUpdated(event: Omit<ParentUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ParentUpdated',
      timestamp: new Date().toISOString()
    } as ParentUpdatedEvent);
  }

  async publishParentDeleted(event: Omit<ParentDeletedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ParentDeleted',
      timestamp: new Date().toISOString()
    } as ParentDeletedEvent);
  }

  async publishGuardianLinkedToStudent(event: Omit<GuardianLinkedToStudentEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'GuardianLinkedToStudent',
      timestamp: new Date().toISOString()
    } as GuardianLinkedToStudentEvent);
  }

  async publishNotificationSent(event: Omit<NotificationSentEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'NotificationSent',
      timestamp: new Date().toISOString()
    } as NotificationSentEvent);
  }

  async publishPortalAccessGranted(event: Omit<PortalAccessGrantedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'PortalAccessGranted',
      timestamp: new Date().toISOString()
    } as PortalAccessGrantedEvent);
  }
}

