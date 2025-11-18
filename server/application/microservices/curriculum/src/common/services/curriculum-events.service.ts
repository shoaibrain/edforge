/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Curriculum Events Service - EventBridge publisher for Curriculum & Instruction bounded context
 */

import { Injectable } from '@nestjs/common';
import { EventServiceBase, BaseDomainEvent } from '@app/events';

/**
 * Domain Events Published by Curriculum Service
 */
export type CurriculumDomainEvent =
  | ClassroomCreatedEvent
  | ClassroomUpdatedEvent
  | ClassroomDeletedEvent
  | LessonPlanPublishedEvent
  | StreamPostCreatedEvent;

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
export class CurriculumEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.curriculum-service';

  async publishClassroomCreated(event: Omit<ClassroomCreatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ClassroomCreated',
      timestamp: new Date().toISOString()
    });
  }

  async publishClassroomUpdated(event: Omit<ClassroomUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ClassroomUpdated',
      timestamp: new Date().toISOString()
    });
  }

  async publishClassroomDeleted(event: Omit<ClassroomDeletedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ClassroomDeleted',
      timestamp: new Date().toISOString()
    });
  }

  async publishLessonPlanPublished(event: Omit<LessonPlanPublishedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'LessonPlanPublished',
      timestamp: new Date().toISOString()
    });
  }

  async publishStreamPostCreated(event: Omit<StreamPostCreatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StreamPostCreated',
      timestamp: new Date().toISOString()
    });
  }
}

