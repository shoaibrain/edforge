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

export interface GlobalRoleChangedEvent extends BaseDomainEvent {
  eventType: 'GlobalRoleChanged';
  userId: string;
  email: string;
  previousRole: string;
  newRole: string;
  changedBy: string;
}

export interface SchoolRoleChangedEvent extends BaseDomainEvent {
  eventType: 'SchoolRoleChanged';
  userId: string;
  schoolId: string;
  previousRole: string;
  newRole: string;
  changedBy: string;
}

/**
 * EdOrg-related domain events
 */
export interface SEACreatedEvent extends BaseDomainEvent {
  eventType: 'SEACreated';
  seaId: string;
  nameOfInstitution: string;
}

export interface SEAUpdatedEvent extends BaseDomainEvent {
  eventType: 'SEAUpdated';
  seaId: string;
  updatedFields: string[];
}

export interface LEACreatedEvent extends BaseDomainEvent {
  eventType: 'LEACreated';
  leaId: string;
  nameOfInstitution: string;
  leaCategoryDescriptor: string;
}

export interface LEAUpdatedEvent extends BaseDomainEvent {
  eventType: 'LEAUpdated';
  leaId: string;
  updatedFields: string[];
}

export interface LEADeletedEvent extends BaseDomainEvent {
  eventType: 'LEADeleted';
  leaId: string;
}

export interface ESCCreatedEvent extends BaseDomainEvent {
  eventType: 'ESCCreated';
  escId: string;
  nameOfInstitution: string;
}

export interface ESCUpdatedEvent extends BaseDomainEvent {
  eventType: 'ESCUpdated';
  escId: string;
  updatedFields: string[];
}

export interface ESCDeletedEvent extends BaseDomainEvent {
  eventType: 'ESCDeleted';
  escId: string;
}

/**
 * Network-related domain events
 */
export interface NetworkCreatedEvent extends BaseDomainEvent {
  eventType: 'NetworkCreated';
  networkId: string;
  nameOfInstitution: string;
  networkPurposeDescriptor: string;
}

export interface NetworkUpdatedEvent extends BaseDomainEvent {
  eventType: 'NetworkUpdated';
  networkId: string;
  updatedFields: string[];
}

export interface NetworkDeletedEvent extends BaseDomainEvent {
  eventType: 'NetworkDeleted';
  networkId: string;
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
  | RoleRevokedEvent
  | GlobalRoleChangedEvent
  | SchoolRoleChangedEvent
  | SEACreatedEvent
  | SEAUpdatedEvent
  | LEACreatedEvent
  | LEAUpdatedEvent
  | LEADeletedEvent
  | ESCCreatedEvent
  | ESCUpdatedEvent
  | ESCDeletedEvent
  | NetworkCreatedEvent
  | NetworkUpdatedEvent
  | NetworkDeletedEvent;

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

  /**
   * Publish global role changed event
   */
  async publishGlobalRoleChanged(
    tenantId: string,
    userId: string,
    email: string,
    previousRole: string,
    newRole: string,
    changedBy: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'GlobalRoleChanged',
      timestamp: new Date().toISOString(),
      tenantId,
      userId,
      email,
      previousRole,
      newRole,
      changedBy,
    });
  }

  /**
   * Publish school role changed event
   */
  async publishSchoolRoleChanged(
    tenantId: string,
    userId: string,
    schoolId: string,
    previousRole: string,
    newRole: string,
    changedBy: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'SchoolRoleChanged',
      timestamp: new Date().toISOString(),
      tenantId,
      userId,
      schoolId,
      previousRole,
      newRole,
      changedBy,
    });
  }

  // ============================================
  // Education Organization Events
  // ============================================

  async publishSEACreated(tenantId: string, seaId: string, nameOfInstitution: string): Promise<void> {
    await this.publishEvent({
      eventType: 'SEACreated',
      timestamp: new Date().toISOString(),
      tenantId,
      seaId,
      nameOfInstitution,
    });
  }

  async publishSEAUpdated(tenantId: string, seaId: string, updatedFields: string[]): Promise<void> {
    await this.publishEvent({
      eventType: 'SEAUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      seaId,
      updatedFields,
    });
  }

  async publishLEACreated(tenantId: string, leaId: string, nameOfInstitution: string, leaCategoryDescriptor: string): Promise<void> {
    await this.publishEvent({
      eventType: 'LEACreated',
      timestamp: new Date().toISOString(),
      tenantId,
      leaId,
      nameOfInstitution,
      leaCategoryDescriptor,
    });
  }

  async publishLEAUpdated(tenantId: string, leaId: string, updatedFields: string[]): Promise<void> {
    await this.publishEvent({
      eventType: 'LEAUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      leaId,
      updatedFields,
    });
  }

  async publishLEADeleted(tenantId: string, leaId: string): Promise<void> {
    await this.publishEvent({
      eventType: 'LEADeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      leaId,
    });
  }

  async publishESCCreated(tenantId: string, escId: string, nameOfInstitution: string): Promise<void> {
    await this.publishEvent({
      eventType: 'ESCCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      escId,
      nameOfInstitution,
    });
  }

  async publishESCUpdated(tenantId: string, escId: string, updatedFields: string[]): Promise<void> {
    await this.publishEvent({
      eventType: 'ESCUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      escId,
      updatedFields,
    });
  }

  async publishESCDeleted(tenantId: string, escId: string): Promise<void> {
    await this.publishEvent({
      eventType: 'ESCDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      escId,
    });
  }

  // ============================================
  // Network Events
  // ============================================

  async publishNetworkCreated(tenantId: string, networkId: string, nameOfInstitution: string, networkPurposeDescriptor: string): Promise<void> {
    await this.publishEvent({
      eventType: 'NetworkCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      networkId,
      nameOfInstitution,
      networkPurposeDescriptor,
    });
  }

  async publishNetworkUpdated(tenantId: string, networkId: string, updatedFields: string[]): Promise<void> {
    await this.publishEvent({
      eventType: 'NetworkUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      networkId,
      updatedFields,
    });
  }

  async publishNetworkDeleted(tenantId: string, networkId: string): Promise<void> {
    await this.publishEvent({
      eventType: 'NetworkDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      networkId,
    });
  }
}
