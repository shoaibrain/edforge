/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Staff Events Service - EventBridge publisher for Staff Management bounded context
 */

import { Injectable } from '@nestjs/common';
import { EventServiceBase, BaseDomainEvent } from '@app/events';

/**
 * Domain Events Published by Staff Service
 */
export type StaffDomainEvent =
  | StaffHiredEvent
  | StaffTerminatedEvent
  | StaffAssignedToClassroomEvent
  | CertificationRenewedEvent
  | CertificationExpiringSoonEvent
  | ProfessionalDevelopmentCompletedEvent;

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
export class StaffEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.staff-service';

  async publishStaffHired(event: Omit<StaffHiredEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StaffHired',
      timestamp: new Date().toISOString()
    });
  }

  async publishStaffTerminated(event: Omit<StaffTerminatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StaffTerminated',
      timestamp: new Date().toISOString()
    });
  }

  async publishStaffAssignedToClassroom(event: Omit<StaffAssignedToClassroomEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'StaffAssignedToClassroom',
      timestamp: new Date().toISOString()
    });
  }

  async publishCertificationRenewed(event: Omit<CertificationRenewedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'CertificationRenewed',
      timestamp: new Date().toISOString()
    });
  }

  async publishCertificationExpiringSoon(event: Omit<CertificationExpiringSoonEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'CertificationExpiringSoon',
      timestamp: new Date().toISOString()
    });
  }

  async publishProfessionalDevelopmentCompleted(event: Omit<ProfessionalDevelopmentCompletedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ProfessionalDevelopmentCompleted',
      timestamp: new Date().toISOString()
    });
  }
}

