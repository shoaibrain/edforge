/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Assessment Events Service - EventBridge publisher for Assessment & Evaluation bounded context
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';

/**
 * Domain Events Published by Assessment Service
 */
export type AssessmentDomainEvent =
  | AssignmentCreatedEvent
  | AssignmentPublishedEvent
  | AssignmentArchivedEvent
  | GradeCreatedEvent
  | GradeUpdatedEvent
  | GradePublishedEvent
  | CourseGradeCalculatedEvent;

export interface AssignmentCreatedEvent extends BaseDomainEvent {
  eventType: 'AssignmentCreated';
  tenantId: string;
  assignmentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  teacherId: string;
  title: string;
  dueDate: string;
  maxScore: number;
}

export interface AssignmentPublishedEvent extends BaseDomainEvent {
  eventType: 'AssignmentPublished';
  tenantId: string;
  assignmentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  title: string;
  dueDate: string;
  maxScore: number;
  studentIds: string[];
}

export interface AssignmentArchivedEvent extends BaseDomainEvent {
  eventType: 'AssignmentArchived';
  tenantId: string;
  assignmentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
}

export interface GradeCreatedEvent extends BaseDomainEvent {
  eventType: 'GradeCreated';
  tenantId: string;
  gradeId: string;
  assignmentId: string;
  studentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  score: number;
  maxScore: number;
}

export interface GradeUpdatedEvent extends BaseDomainEvent {
  eventType: 'GradeUpdated';
  tenantId: string;
  gradeId: string;
  assignmentId: string;
  studentId: string;
  previousScore: number;
  newScore: number;
}

export interface GradePublishedEvent extends BaseDomainEvent {
  eventType: 'GradePublished';
  tenantId: string;
  gradeId: string;
  assignmentId: string;
  studentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  score: number;
  maxScore: number;
  letterGrade: string;
}

export interface CourseGradeCalculatedEvent extends BaseDomainEvent {
  eventType: 'CourseGradeCalculated';
  tenantId: string;
  studentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  courseGrade: number;
  letterGrade: string;
  gpaPoints: number;
}

interface BaseDomainEvent {
  eventType: string;
  timestamp: string;
  tenantId: string;
  [key: string]: any;
}

@Injectable()
export class AssessmentEventsService {
  private readonly logger = new Logger(AssessmentEventsService.name);
  private readonly eventBridgeClient: EventBridgeClient;
  private readonly eventBusName: string;
  private readonly eventSource = 'edforge.assessment-service';

  constructor(private readonly configService: ConfigService) {
    this.eventBridgeClient = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.eventBusName = this.configService.get<string>('EVENT_BUS_NAME') || 'default';
    this.logger.log(`Assessment Events Service initialized. Event Bus: ${this.eventBusName}`);
  }

  private async publishEvent(event: AssessmentDomainEvent): Promise<void> {
    try {
      const entry: PutEventsRequestEntry = {
        Source: this.eventSource,
        DetailType: event.eventType,
        Detail: JSON.stringify(event),
        EventBusName: this.eventBusName === 'default' ? undefined : this.eventBusName
      };

      const command = new PutEventsCommand({
        Entries: [entry]
      });

      const response = await this.eventBridgeClient.send(command);

      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        this.logger.error(`Failed to publish event ${event.eventType}:`, response.Entries?.[0]?.ErrorMessage);
        throw new Error(`Failed to publish event: ${response.Entries?.[0]?.ErrorMessage}`);
      }

      this.logger.log(`Event published: ${event.eventType} (${response.Entries?.[0]?.EventId})`);
    } catch (error: any) {
      this.logger.error(`Failed to publish event ${event.eventType}: ${error.message}`, error.stack);
      throw error;
    }
  }

  async publishAssignmentCreated(event: Omit<AssignmentCreatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AssignmentCreated',
      timestamp: new Date().toISOString()
    } as AssignmentCreatedEvent);
  }

  async publishAssignmentPublished(event: Omit<AssignmentPublishedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AssignmentPublished',
      timestamp: new Date().toISOString()
    } as AssignmentPublishedEvent);
  }

  async publishAssignmentArchived(event: Omit<AssignmentArchivedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AssignmentArchived',
      timestamp: new Date().toISOString()
    } as AssignmentArchivedEvent);
  }

  async publishGradeCreated(event: Omit<GradeCreatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'GradeCreated',
      timestamp: new Date().toISOString()
    } as GradeCreatedEvent);
  }

  async publishGradeUpdated(event: Omit<GradeUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'GradeUpdated',
      timestamp: new Date().toISOString()
    } as GradeUpdatedEvent);
  }

  async publishGradePublished(event: Omit<GradePublishedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'GradePublished',
      timestamp: new Date().toISOString()
    } as GradePublishedEvent);
  }

  async publishCourseGradeCalculated(event: Omit<CourseGradeCalculatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'CourseGradeCalculated',
      timestamp: new Date().toISOString()
    } as CourseGradeCalculatedEvent);
  }
}

