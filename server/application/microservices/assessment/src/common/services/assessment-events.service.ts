/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Assessment Events Service - EventBridge publisher for Assessment & Evaluation bounded context
 */

import { Injectable } from '@nestjs/common';
import { EventServiceBase, BaseDomainEvent } from '@app/events';

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
  assignmentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
}

export interface GradeCreatedEvent extends BaseDomainEvent {
  eventType: 'GradeCreated';
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
  gradeId: string;
  assignmentId: string;
  studentId: string;
  previousScore: number;
  newScore: number;
}

export interface GradePublishedEvent extends BaseDomainEvent {
  eventType: 'GradePublished';
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
  studentId: string;
  classroomId: string;
  schoolId: string;
  academicYearId: string;
  courseGrade: number;
  letterGrade: string;
  gpaPoints: number;
}

@Injectable()
export class AssessmentEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.assessment-service';

  async publishAssignmentCreated(event: Omit<AssignmentCreatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AssignmentCreated',
      timestamp: new Date().toISOString()
    });
  }

  async publishAssignmentPublished(event: Omit<AssignmentPublishedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AssignmentPublished',
      timestamp: new Date().toISOString()
    });
  }

  async publishAssignmentArchived(event: Omit<AssignmentArchivedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'AssignmentArchived',
      timestamp: new Date().toISOString()
    });
  }

  async publishGradeCreated(event: Omit<GradeCreatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'GradeCreated',
      timestamp: new Date().toISOString()
    });
  }

  async publishGradeUpdated(event: Omit<GradeUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'GradeUpdated',
      timestamp: new Date().toISOString()
    });
  }

  async publishGradePublished(event: Omit<GradePublishedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'GradePublished',
      timestamp: new Date().toISOString()
    });
  }

  async publishCourseGradeCalculated(event: Omit<CourseGradeCalculatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'CourseGradeCalculated',
      timestamp: new Date().toISOString()
    });
  }
}

