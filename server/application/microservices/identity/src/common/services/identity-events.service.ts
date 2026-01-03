/**
 * Identity Events Service
 * 
 * Publishes domain events from the Identity Service to the SBT EventBus.
 * Extends EventServiceBase for standardized event publishing.
 */

import { Injectable } from '@nestjs/common';
import { EventServiceBase, BaseDomainEvent } from '@app/events';

/**
 * User-related domain events
 */
export interface UserCreatedEvent extends BaseDomainEvent {
  eventType: 'UserCreated';
  userId: string;
  email: string;
  globalRole: string;
}

export interface UserUpdatedEvent extends BaseDomainEvent {
  eventType: 'UserUpdated';
  userId: string;
  email: string;
  updatedFields: string[];
}

export interface UserDeletedEvent extends BaseDomainEvent {
  eventType: 'UserDeleted';
  userId: string;
  email: string;
}

/**
 * School-related domain events
 */
export interface SchoolCreatedEvent extends BaseDomainEvent {
  eventType: 'SchoolCreated';
  schoolId: string;
  schoolCode: string;
  name: string;
  schoolType: string;
}

export interface SchoolUpdatedEvent extends BaseDomainEvent {
  eventType: 'SchoolUpdated';
  schoolId: string;
  updatedFields: string[];
}

export interface SchoolDeletedEvent extends BaseDomainEvent {
  eventType: 'SchoolDeleted';
  schoolId: string;
}

/**
 * Role-related domain events
 */
export interface RoleAssignedEvent extends BaseDomainEvent {
  eventType: 'RoleAssigned';
  userId: string;
  schoolId: string;
  role: string;
}

export interface RoleRevokedEvent extends BaseDomainEvent {
  eventType: 'RoleRevoked';
  userId: string;
  schoolId: string;
  role: string;
}

/**
 * All Identity domain events
 */
export type IdentityDomainEvent = 
  | UserCreatedEvent 
  | UserUpdatedEvent 
  | UserDeletedEvent
  | SchoolCreatedEvent
  | SchoolUpdatedEvent
  | SchoolDeletedEvent
  | RoleAssignedEvent
  | RoleRevokedEvent;

@Injectable()
export class IdentityEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.identity-service';

  /**
   * Publish user created event
   */
  async publishUserCreated(
    tenantId: string,
    userId: string,
    email: string,
    globalRole: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'UserCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      userId,
      email,
      globalRole,
    });
  }

  /**
   * Publish user updated event
   */
  async publishUserUpdated(
    tenantId: string,
    userId: string,
    email: string,
    updatedFields: string[]
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'UserUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      userId,
      email,
      updatedFields,
    });
  }

  /**
   * Publish user deleted event
   */
  async publishUserDeleted(
    tenantId: string,
    userId: string,
    email: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'UserDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      userId,
      email,
    });
  }

  /**
   * Publish school created event
   */
  async publishSchoolCreated(
    tenantId: string,
    schoolId: string,
    schoolCode: string,
    name: string,
    schoolType: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'SchoolCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      schoolCode,
      name,
      schoolType,
    });
  }

  /**
   * Publish school updated event
   */
  async publishSchoolUpdated(
    tenantId: string,
    schoolId: string,
    updatedFields: string[]
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'SchoolUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      updatedFields,
    });
  }

  /**
   * Publish role assigned event
   */
  async publishRoleAssigned(
    tenantId: string,
    userId: string,
    schoolId: string,
    role: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'RoleAssigned',
      timestamp: new Date().toISOString(),
      tenantId,
      userId,
      schoolId,
      role,
    });
  }

  /**
   * Publish role revoked event
   */
  async publishRoleRevoked(
    tenantId: string,
    userId: string,
    schoolId: string,
    role: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'RoleRevoked',
      timestamp: new Date().toISOString(),
      tenantId,
      userId,
      schoolId,
      role,
    });
  }
}
