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
 * Phase 1 — emitted by the dedicated PATCH /schools/:schoolId/grade-levels
 * endpoint. Carries the full new set plus the diff (`added`, `removed`)
 * so academics + analytics + reporting consumers can react asynchronously
 * (e.g., warn if a removed code still has active enrollments, refresh
 * grade-band caches, flag downstream IEMIS aggregations).
 *
 * Distinct from the generic `SchoolUpdated` event so consumers can
 * subscribe specifically to grade-level changes without filtering
 * `updatedFields` arrays at runtime.
 */
export interface SchoolGradeLevelsUpdatedEvent extends BaseDomainEvent {
  eventType: 'SchoolGradeLevelsUpdated';
  schoolId: string;
  enabledGradeLevels: string[];
  added: string[];
  removed: string[];
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
 * Calendar-related domain events
 */
export interface CalendarCreatedEvent extends BaseDomainEvent {
  eventType: 'CalendarCreated';
  calendarId: string;
  schoolId: string;
  calendarCode: string;
  calendarTypeDescriptor: string;
}

export interface CalendarDateGeneratedEvent extends BaseDomainEvent {
  eventType: 'CalendarDateGenerated';
  schoolId: string;
  calendarId: string;
  academicYearId: string;
  totalDays: number;
  instructionalDays: number;
}

export interface CalendarDateUpdatedEvent extends BaseDomainEvent {
  eventType: 'CalendarDateUpdated';
  schoolId: string;
  date: string;
  updatedFields: string[];
}

export interface AcademicSessionCreatedEvent extends BaseDomainEvent {
  eventType: 'AcademicSessionCreated';
  academicSessionId: string;
  schoolId: string;
  sessionName: string;
  beginDate: string;
  endDate: string;
}

export interface AcademicSessionUpdatedEvent extends BaseDomainEvent {
  eventType: 'AcademicSessionUpdated';
  academicSessionId: string;
  schoolId: string;
  updatedFields: string[];
}

export interface AcademicSessionDeletedEvent extends BaseDomainEvent {
  eventType: 'AcademicSessionDeleted';
  academicSessionId: string;
  schoolId: string;
}

/**
 * ClassPeriod-related domain events
 */
export interface ClassPeriodCreatedEvent extends BaseDomainEvent {
  eventType: 'ClassPeriodCreated';
  periodId: string;
  schoolId: string;
  classPeriodName: string;
}

export interface ClassPeriodUpdatedEvent extends BaseDomainEvent {
  eventType: 'ClassPeriodUpdated';
  periodId: string;
  schoolId: string;
  updatedFields: string[];
}

export interface ClassPeriodDeletedEvent extends BaseDomainEvent {
  eventType: 'ClassPeriodDeleted';
  periodId: string;
  schoolId: string;
}

/**
 * Location-related domain events
 */
export interface LocationCreatedEvent extends BaseDomainEvent {
  eventType: 'LocationCreated';
  locationId: string;
  schoolId: string;
  roomNumber: string;
}

export interface LocationUpdatedEvent extends BaseDomainEvent {
  eventType: 'LocationUpdated';
  locationId: string;
  schoolId: string;
  updatedFields: string[];
}

export interface LocationDeletedEvent extends BaseDomainEvent {
  eventType: 'LocationDeleted';
  locationId: string;
  schoolId: string;
}

/**
 * Workspace settings updated event (A-WS2.T1).
 *
 * Emitted when a tenant edits their workspace settings (regional /
 * branding / policies). Subscribers (analytics aggregator, finance, etc.)
 * use this to invalidate their per-tenant settings cache so changes
 * propagate within seconds instead of waiting for the 5-minute TTL.
 *
 * `changedSections` lists the top-level sections touched in this update
 * (subset of: 'regional' | 'branding' | 'policies'). Subscribers that only
 * care about specific sections can short-circuit on this hint, but the
 * cache invalidation is unconditional in V1 (cheap, conservative).
 */
export interface WorkspaceSettingsUpdatedEvent extends BaseDomainEvent {
  eventType: 'WorkspaceSettingsUpdated';
  changedSections: Array<'regional' | 'branding' | 'policies'>;
}

/**
 * All Identity domain events
 */
export type IdentityDomainEvent =
  | WorkspaceSettingsUpdatedEvent
  | UserCreatedEvent
  | UserUpdatedEvent
  | UserDeletedEvent
  | SchoolCreatedEvent
  | SchoolUpdatedEvent
  | SchoolGradeLevelsUpdatedEvent
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
  | NetworkDeletedEvent
  | CalendarCreatedEvent
  | CalendarDateGeneratedEvent
  | CalendarDateUpdatedEvent
  | AcademicSessionCreatedEvent
  | AcademicSessionUpdatedEvent
  | AcademicSessionDeletedEvent
  | ClassPeriodCreatedEvent
  | ClassPeriodUpdatedEvent
  | ClassPeriodDeletedEvent
  | LocationCreatedEvent
  | LocationUpdatedEvent
  | LocationDeletedEvent;

@Injectable()
export class IdentityEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.identity-service';

  /**
   * Publish workspace-settings updated event (A-WS2.T1).
   *
   * Fire-and-forget. EventServiceBase.publishEvent() catches all errors and
   * logs them — the PATCH /tenants/{id}/settings call returns 200 even if
   * EventBridge is unavailable. Subscribers will simply not invalidate
   * their cache; the 5-minute TTL eventually picks up the change.
   */
  async publishWorkspaceSettingsUpdated(
    tenantId: string,
    changedSections: Array<'regional' | 'branding' | 'policies'>,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'WorkspaceSettingsUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      changedSections,
    });
  }

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
   * Phase 1 — publish a school grade-levels-updated event.
   * Carries the new full set plus add/remove diff so downstream
   * consumers (academics, analytics, IEMIS reporting) can react
   * without re-computing the diff themselves.
   */
  async publishSchoolGradeLevelsUpdated(
    tenantId: string,
    schoolId: string,
    enabledGradeLevels: string[],
    added: string[],
    removed: string[],
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'SchoolGradeLevelsUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      enabledGradeLevels,
      added,
      removed,
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

  // ============================================
  // Calendar Domain Events
  // ============================================

  async publishCalendarCreated(
    tenantId: string,
    calendarId: string,
    schoolId: string,
    calendarCode: string,
    calendarTypeDescriptor: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'CalendarCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      calendarId,
      schoolId,
      calendarCode,
      calendarTypeDescriptor,
    });
  }

  async publishCalendarDateGenerated(
    tenantId: string,
    schoolId: string,
    calendarId: string,
    academicYearId: string,
    totalDays: number,
    instructionalDays: number
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'CalendarDateGenerated',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      calendarId,
      academicYearId,
      totalDays,
      instructionalDays,
    });
  }

  async publishCalendarDateUpdated(
    tenantId: string,
    schoolId: string,
    date: string,
    updatedFields: string[]
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'CalendarDateUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      date,
      updatedFields,
    });
  }

  async publishAcademicSessionCreated(
    tenantId: string,
    academicSessionId: string,
    schoolId: string,
    sessionName: string,
    beginDate: string,
    endDate: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'AcademicSessionCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      academicSessionId,
      schoolId,
      sessionName,
      beginDate,
      endDate,
    });
  }

  async publishAcademicSessionUpdated(
    tenantId: string,
    academicSessionId: string,
    schoolId: string,
    updatedFields: string[]
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'AcademicSessionUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      academicSessionId,
      schoolId,
      updatedFields,
    });
  }

  async publishAcademicSessionDeleted(
    tenantId: string,
    academicSessionId: string,
    schoolId: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'AcademicSessionDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      academicSessionId,
      schoolId,
    });
  }

  // ============================================
  // Master Schedule Events
  // ============================================

  async publishClassPeriodCreated(
    tenantId: string,
    periodId: string,
    schoolId: string,
    classPeriodName: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'ClassPeriodCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      periodId,
      schoolId,
      classPeriodName,
    });
  }

  async publishClassPeriodUpdated(
    tenantId: string,
    periodId: string,
    schoolId: string,
    updatedFields: string[]
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'ClassPeriodUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      periodId,
      schoolId,
      updatedFields,
    });
  }

  async publishClassPeriodDeleted(
    tenantId: string,
    periodId: string,
    schoolId: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'ClassPeriodDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      periodId,
      schoolId,
    });
  }

  async publishLocationCreated(
    tenantId: string,
    locationId: string,
    schoolId: string,
    roomNumber: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'LocationCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      locationId,
      schoolId,
      roomNumber,
    });
  }

  async publishLocationUpdated(
    tenantId: string,
    locationId: string,
    schoolId: string,
    updatedFields: string[]
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'LocationUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      locationId,
      schoolId,
      updatedFields,
    });
  }

  async publishLocationDeleted(
    tenantId: string,
    locationId: string,
    schoolId: string
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'LocationDeleted',
      timestamp: new Date().toISOString(),
      tenantId,
      locationId,
      schoolId,
    });
  }
}
