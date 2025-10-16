/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Event Service - EventBridge integration for cross-service communication
 * 
 * ARCHITECTURE RATIONALE:
 * EventBridge provides decoupled, scalable event-driven architecture:
 * - Services don't need to know about each other
 * - Events are durable and retryable
 * - Easy to add new subscribers without changing publishers
 * - Native AWS service (no additional infrastructure needed)
 * 
 * COMMUNICATION PATTERN
 * Application Plane → EventBridge → Subscriber Services
 * 
 * 1. School Service publishes domain events to EventBridge
 * 2. EventBridge routes events to subscribers based on rules
 * 3. Subscriber services process events asynchronously
 * 4. Dead Letter Queue (DLQ) captures failed events for retry
 * 
 * EVENTBRIDGE SETUP (Already configured in your SBT stack):
 * - Event Bus: Your SBT stack likely has an event bus already
 * - Event Rules: Define which services receive which events
 * - Targets: Lambda functions, SQS queues, or other services
 * 
 * COST OPTIMIZATION:
 * - EventBridge charges per million events ($1/million)
 * - Extremely cost-effective for MVP
 * - No need for additional infrastructure (Kafka, RabbitMQ, etc.)
 * 
 * SCALABILITY:
 * - Handles millions of events/second
 * - Auto-scales without configuration
 * - Global availability
 */

import { Injectable } from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';

/**
 * Domain Events Published by School Service
 * 
 * NAMING CONVENTION: PascalCase with past tense verb
 * Examples: SchoolCreated, AcademicYearStarted, DepartmentRestructured
 */
export type SchoolDomainEvent =
  | SchoolCreatedEvent
  | SchoolUpdatedEvent
  | SchoolDeletedEvent
  | SchoolStatusChangedEvent
  | AcademicYearCreatedEvent
  | AcademicYearUpdatedEvent
  | AcademicYearStartedEvent
  | AcademicYearEndedEvent
  | CurrentAcademicYearChangedEvent
  | DepartmentCreatedEvent
  | DepartmentUpdatedEvent
  | DepartmentRestructuredEvent
  | GradingPeriodCreatedEvent
  | HolidayCreatedEvent;

/**
 * Base event interface - all events must include these fields
 */
interface BaseEvent {
  eventType: string;
  timestamp: string;      // ISO 8601
  tenantId: string;
  schoolId: string;
  metadata?: {
    correlationId?: string;  // For tracing
    causationId?: string;    // What caused this event
  };
}

/**
 * School Events
 */
export interface SchoolCreatedEvent extends BaseEvent {
  eventType: 'SchoolCreated';
  schoolName: string;
  schoolCode: string;
  schoolType: string;
  timezone: string;         // Critical for downstream services
  maxCapacity: number;
}

export interface SchoolUpdatedEvent extends BaseEvent {
  eventType: 'SchoolUpdated';
  changes: {
    before: any;
    after: any;
  };
}

export interface SchoolDeletedEvent extends BaseEvent {
  eventType: 'SchoolDeleted';
  schoolName: string;
  reason?: string;
}

export interface SchoolStatusChangedEvent extends BaseEvent {
  eventType: 'SchoolStatusChanged';
  previousStatus: string;
  newStatus: string;
  reason?: string;
}

/**
 * Academic Year Events
 */
export interface AcademicYearCreatedEvent extends BaseEvent {
  eventType: 'AcademicYearCreated';
  academicYearId: string;
  yearName: string;
  startDate: string;
  endDate: string;
}

export interface AcademicYearUpdatedEvent extends BaseEvent {
  eventType: 'AcademicYearUpdated';
  academicYearId: string;
  yearName: string;
  changes: any; // Fields that were updated
}

export interface AcademicYearStartedEvent extends BaseEvent {
  eventType: 'AcademicYearStarted';
  academicYearId: string;
  yearName: string;
  startDate: string;
  endDate: string;
  // Downstream services (Student, Academic) use this to:
  // - Initialize enrollment for new year
  // - Set up grading books
  // - Activate attendance tracking
}

export interface AcademicYearEndedEvent extends BaseEvent {
  eventType: 'AcademicYearEnded';
  academicYearId: string;
  yearName: string;
  // Triggers:
  // - Year-end report generation
  // - Grade finalization
  // - Student promotion processing
  // - Transcript generation
}

export interface CurrentAcademicYearChangedEvent extends BaseEvent {
  eventType: 'CurrentAcademicYearChanged';
  previousYearId?: string;
  newYearId: string;
  yearName: string;
  // Critical for all services that use "current year" context
}

/**
 * Department Events
 */
export interface DepartmentCreatedEvent extends BaseEvent {
  eventType: 'DepartmentCreated';
  departmentId: string;
  departmentName: string;
  departmentCode: string;
  category: string;
}

export interface DepartmentUpdatedEvent extends BaseEvent {
  eventType: 'DepartmentUpdated';
  departmentId: string;
  changes: any;
}

export interface DepartmentRestructuredEvent extends BaseEvent {
  eventType: 'DepartmentRestructured';
  departments: Array<{
    departmentId: string;
    departmentName: string;
    headOfDepartmentUserId?: string;
  }>;
  changes: string;
}

/**
 * Grading Period Events
 */
export interface GradingPeriodCreatedEvent extends BaseEvent {
  eventType: 'GradingPeriodCreated';
  academicYearId: string;
  gradingPeriodId: string;
  periodName: string;
  startDate: string;
  endDate: string;
}

/**
 * Holiday Events
 */
export interface HolidayCreatedEvent extends BaseEvent {
  eventType: 'HolidayCreated';
  academicYearId: string;
  holidayId: string;
  name: string;
  startDate: string;
  endDate: string;
  type: string;
}

@Injectable()
export class EventService {
  private eventBridge: EventBridgeClient;
  private eventBusName: string;
  private eventSource: string = 'edforge.school-service';

  constructor() {
    // Initialize EventBridge client
    this.eventBridge = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });

    // Event Bus Name from SBT Control Plane
    // Your SBT stack creates an event bus in the control plane
    // Format: controlplanestackcontrolplanesbtEventManagerSbtEventBus[ID]
    // 
    // INTEGRATION PATTERN:
    // - Use SBT event bus for consistency with SBT architecture
    // - All tenant lifecycle events (onboarding, offboarding) go through this bus
    // - Application events (SchoolCreated, etc.) should also use this bus
    // - EventManager handles routing to subscribers
    // 
    // CONFIGURATION:
    // Pass event bus name via environment variable from CDK
    // See service-info.json for EVENT_BUS_NAME
    this.eventBusName = process.env.EVENT_BUS_NAME || 'default';

    console.log(`🔄 EventService initialized with bus: ${this.eventBusName}`);
    console.log(`📡 Event source: ${this.eventSource}`);
  }

  /**
   * Publish a single domain event
   * 
   * ERROR HANDLING:
   * - Logs error but doesn't throw (event publishing should not block main operation)
   * - Failed events logged to CloudWatch for monitoring
   * - Consider adding DLQ for critical events
   * 
   * PERFORMANCE:
   * - Async/non-blocking
   * - Batched if multiple events (use publishEvents for batch)
   * - ~10ms latency typical
   */
  async publishEvent(event: SchoolDomainEvent): Promise<void> {
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

      // Check for failures
      if (result.FailedEntryCount && result.FailedEntryCount > 0) {
        console.error('Failed to publish event:', {
          event: event.eventType,
          failures: result.Entries
        });
        
        // TODO: Send to DLQ for retry
        await this.handleEventPublishingFailure(event, result.Entries?.[0]);
      } else {
        console.log(`Event published: ${event.eventType}`, {
          schoolId: event.schoolId,
          tenantId: event.tenantId,
          eventId: result.Entries?.[0].EventId
        });
      }
    } catch (error) {
      console.error('Error publishing event to EventBridge:', error);
      
      // Don't throw - event publishing failure should not block main operation
      // Log to CloudWatch for monitoring/alerting
      await this.handleEventPublishingFailure(event, error);
    }
  }

  /**
   * Publish multiple events in batch
   * 
   * BATCH LIMITS:
   * - EventBridge allows max 10 events per PutEvents call
   * - Automatically chunks if more than 10 events
   * 
   * USE CASE:
   * - Department restructuring (multiple dept updates)
   * - Bulk operations
   * - Year rollover (multiple state changes)
   */
  async publishEvents(events: SchoolDomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Chunk into batches of 10 (EventBridge limit)
    const chunks = this.chunkArray(events, 10);

    for (const chunk of chunks) {
      try {
        const entries: PutEventsRequestEntry[] = chunk.map(event => ({
          Source: this.eventSource,
          DetailType: event.eventType,
          Detail: JSON.stringify(event),
          EventBusName: this.eventBusName,
          Time: new Date(event.timestamp)
        }));

        const command = new PutEventsCommand({
          Entries: entries
        });

        const result = await this.eventBridge.send(command);

        if (result.FailedEntryCount && result.FailedEntryCount > 0) {
          console.error(`Failed to publish ${result.FailedEntryCount} events in batch`);
        } else {
          console.log(`Published ${chunk.length} events to EventBridge`);
        }
      } catch (error) {
        console.error('Error publishing batch events:', error);
      }
    }
  }

  /**
   * Handle event publishing failures
   * 
   * OPTIONS FOR PRODUCTION:
   * 1. Write to DynamoDB table for manual retry
   * 2. Send to SQS DLQ
   * 3. Log to CloudWatch with alarm
   * 4. Email/SNS notification for critical events
   * 
   * FOR MVP: Just log to CloudWatch
   */
  private async handleEventPublishingFailure(
    event: SchoolDomainEvent,
    error: any
  ): Promise<void> {
    console.error('EVENT_PUBLISHING_FAILED', {
      eventType: event.eventType,
      tenantId: event.tenantId,
      schoolId: event.schoolId,
      timestamp: event.timestamp,
      error: error?.message || error,
      errorCode: error?.ErrorCode,
      errorMessage: error?.ErrorMessage
    });

    // TODO for production: Write to DLQ table
    // await this.writeToDLQ(event, error);
  }

  /**
   * Helper: Chunk array into smaller arrays
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Test event publishing (for development/testing)
   * 
   * USAGE:
   * ```
   * await eventService.publishTestEvent('tenant-123', 'school-456');
   * ```
   * 
   * Check CloudWatch Logs or EventBridge console to verify event received
   */
  async publishTestEvent(tenantId: string, schoolId: string): Promise<void> {
    const testEvent: SchoolCreatedEvent = {
      eventType: 'SchoolCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      schoolName: 'Test School',
      schoolCode: 'TEST-001',
      schoolType: 'k12',
      timezone: 'America/New_York',
      maxCapacity: 1000
    };

    await this.publishEvent(testEvent);
    console.log('Test event published successfully!');
  }
}

/**
 * EVENT SUBSCRIPTION PATTERNS
 * 
 * How other services subscribe to School Service events:
 * 
 * OPTION 1: Lambda Functions (Recommended for MVP)
 * -----------------------------------------------
 * EventBridge Rule → Lambda → Process Event
 * 
 * Example CDK:
 * ```typescript
 * new events.Rule(this, 'SchoolCreatedRule', {
 *   eventBus: eventBus,
 *   eventPattern: {
 *     source: ['edforge.school-service'],
 *     detailType: ['SchoolCreated']
 *   },
 *   targets: [new targets.LambdaFunction(studentServiceHandler)]
 * });
 * ```
 * 
 * OPTION 2: SQS Queue (Better for high volume)
 * ---------------------------------------------
 * EventBridge Rule → SQS Queue → Consumer Service
 * 
 * Benefits:
 * - Buffering for bursty traffic
 * - Built-in retry with DLQ
 * - Batch processing
 * 
 * OPTION 3: Direct Service Integration (ECS Task)
 * ------------------------------------------------
 * EventBridge Rule → API Destination → Service HTTP Endpoint
 * 
 * YOUR SETUP (SBT Stack):
 * -----------------------
 * You likely already have EventBridge configured with SBT.
 * Check your CDK stack for event bus definition.
 * 
 * To add School Service events:
 * 1. Update event patterns in your SBT control plane
 * 2. Add rules for School Service events
 * 3. Route to appropriate services
 */

/**
 * CACHING WITH EVENTS
 * 
 * When using in-memory caching (future: Redis), invalidate cache on events:
 * 
 * ```typescript
 * // In School Service
 * await this.eventService.publishEvent({
 *   eventType: 'SchoolConfigUpdated',
 *   schoolId,
 *   tenantId,
 *   timestamp: new Date().toISOString()
 * });
 * 
 * // In Cache Service (listens to events)
 * eventBridge.onEvent('SchoolConfigUpdated', async (event) => {
 *   await cache.invalidate(`config:${event.tenantId}:${event.schoolId}`);
 * });
 * ```
 * 
 * For MVP without Redis:
 * - Use short TTLs (5-15 minutes)
 * - Accept eventual consistency
 * - Monitor cache hit rates
 */

/**
 * MULTI-TENANT EVENT FILTERING
 * 
 * EventBridge rules can filter by tenant for tenant-specific subscriptions:
 * 
 * ```typescript
 * eventPattern: {
 *   source: ['edforge.school-service'],
 *   detailType: ['SchoolCreated'],
 *   detail: {
 *     tenantId: ['tenant-specific-id']  // Only events for this tenant
 *   }
 * }
 * ```
 * 
 * For your Basic tier (pooled): One rule for all tenants
 * For your Premium tier (silo): Per-tenant rules (optional)
 */

