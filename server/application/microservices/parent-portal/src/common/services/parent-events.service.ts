/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Parent Events Service - EventBridge publisher for Parent Engagement bounded context
 */

import { Injectable } from '@nestjs/common';
import { EventServiceBase, BaseDomainEvent } from '@app/events';

/**
 * Domain Events Published by Parent Portal Service
 */
export type ParentDomainEvent =
  | GuardianRegisteredEvent
  | GuardianLinkedToStudentEvent
  | NotificationSentEvent
  | PortalAccessGrantedEvent;

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

@Injectable()
export class ParentEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.parent-portal-service';

  async publishGuardianRegistered(event: Omit<GuardianRegisteredEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'GuardianRegistered',
      timestamp: new Date().toISOString()
    });
  }

  async publishGuardianLinkedToStudent(event: Omit<GuardianLinkedToStudentEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'GuardianLinkedToStudent',
      timestamp: new Date().toISOString()
    });
  }

  async publishNotificationSent(event: Omit<NotificationSentEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'NotificationSent',
      timestamp: new Date().toISOString()
    });
  }

  async publishPortalAccessGranted(event: Omit<PortalAccessGrantedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'PortalAccessGranted',
      timestamp: new Date().toISOString()
    });
  }
}

