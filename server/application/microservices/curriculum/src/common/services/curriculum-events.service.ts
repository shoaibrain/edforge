/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Curriculum Events Service - EventBridge publisher for Curriculum & Instruction bounded context
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';

/**
 * Domain Events Published by Curriculum Service
 */
export type CurriculumDomainEvent =
  | ClassroomCreatedEvent
  | ClassroomUpdatedEvent
  | ClassroomDeletedEvent
  | LessonPlanPublishedEvent
  | StreamPostCreatedEvent;

export interface BaseDomainEvent {
  eventType: string;
  tenantId: string;
  timestamp: string;
}

export interface ClassroomCreatedEvent extends BaseDomainEvent {
  eventType: 'ClassroomCreated';
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  courseId?: string;
  teacherId: string;
  maxCapacity: number;
  metadata?: {
    correlationId?: string;
    causationId?: string;
  };
}

export interface ClassroomUpdatedEvent extends BaseDomainEvent {
  eventType: 'ClassroomUpdated';
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  changes: Record<string, any>;
}

export interface ClassroomDeletedEvent extends BaseDomainEvent {
  eventType: 'ClassroomDeleted';
  classroomId: string;
  schoolId: string;
  academicYearId: string;
}

export interface LessonPlanPublishedEvent extends BaseDomainEvent {
  eventType: 'LessonPlanPublished';
  lessonPlanId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  teacherId: string;
  lessonDate: string;
}

export interface StreamPostCreatedEvent extends BaseDomainEvent {
  eventType: 'StreamPostCreated';
  postId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  authorId: string;
  postType: string;
}

@Injectable()
export class CurriculumEventsService {
  private readonly logger = new Logger(CurriculumEventsService.name);
  private readonly eventBridge: EventBridgeClient;
  private readonly eventBusName: string;
  private readonly eventSource: string = 'edforge.curriculum-service';

  constructor() {
    this.eventBridge = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.eventBusName = process.env.EVENT_BUS_NAME || 'default';
    this.logger.log(`Curriculum Events Service initialized with bus: ${this.eventBusName}`);
  }

  /**
   * Publish a single domain event to EventBridge
   */
  private async publishEvent(event: CurriculumDomainEvent): Promise<void> {
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
          classroomId: (event as any).classroomId,
          tenantId: event.tenantId,
          eventId: result.Entries?.[0].EventId
        });
      }
    } catch (error: any) {
      this.logger.error('Error publishing event to EventBridge:', error);
      // Don't throw - event publishing failure should not block main operation
    }
  }

  async publishClassroomCreated(event: Omit<ClassroomCreatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ClassroomCreated',
      timestamp: new Date().toISOString()
    } as ClassroomCreatedEvent);
  }

  async publishClassroomUpdated(event: Omit<ClassroomUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ClassroomUpdated',
      timestamp: new Date().toISOString()
    } as ClassroomUpdatedEvent);
  }

  async publishClassroomDeleted(event: Omit<ClassroomDeletedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ClassroomDeleted',
      timestamp: new Date().toISOString()
    } as ClassroomDeletedEvent);
  }

  async publishLessonPlanPublished(event: Omit<LessonPlanPublishedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'LessonPlanPublished',
      timestamp: new Date().toISOString()
    } as LessonPlanPublishedEvent);
  }

  async publishStreamPostCreated(event: Omit<StreamPostCreatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StreamPostCreated',
      timestamp: new Date().toISOString()
    } as StreamPostCreatedEvent);
  }
}

