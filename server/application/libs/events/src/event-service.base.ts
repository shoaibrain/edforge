/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 *
 * Event Service Base Class - Reusable EventBridge publisher for all microservices
 *
 * ARCHITECTURE:
 * - Abstract base class for event publishing
 * - Uses SBT EventBridge bus (configured via EVENT_BUS_NAME env var)
 * - Error handling with retry logic
 * - Non-blocking event publishing
 * - Fail-fast if EVENT_BUS_NAME is not configured
 *
 * C0.c.3 — runtime payload validation against the C0.c.2 registry:
 *   - `publishValidatedEvent(event: DomainEvent)` is the typed entry
 *     point. The DomainEvent discriminated union forces compile-time
 *     schema membership; runtime validation also fires.
 *   - `publishEvent(event: BaseDomainEvent)` (the loose-typed entry
 *     point used by ~110 existing PascalCase publishers) now runs
 *     validation as a soft introduction:
 *       * registered + valid       → emit
 *       * unregistered (legacy)    → log warning + emit (backward compat)
 *       * registered + invalid     → SKIP emit + log + invoke DLQ hook
 *
 * Skipping invalid-payload emits is the safer default: pushing
 * corrupted JSON onto EventBridge crashes downstream consumers on
 * parse, which is worse than missing one event. The audit row at the
 * caller's auditedWrite() still records what happened.
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';
import { validateEvent, type DomainEvent } from '@aibrains/shared-types';

/**
 * Base interface for all domain events
 */
export interface BaseDomainEvent {
  eventType: string;
  timestamp: string;
  tenantId: string;
  [key: string]: any;
}

@Injectable()
export abstract class EventServiceBase {
  protected readonly logger: Logger;
  protected readonly eventBridge: EventBridgeClient;
  protected readonly eventBusName: string;
  protected abstract readonly eventSource: string;

  constructor() {
    this.logger = new Logger(this.constructor.name);
    
    // Initialize EventBridge client
    this.eventBridge = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1',
      maxAttempts: 3,
      retryMode: 'adaptive'
    });

    // Event Bus Name from SBT Control Plane - REQUIRED configuration
    // Passed via service-info.txt -> CDK -> Container environment
    // Format: controlplanestackcontrolplanesbtEventManagerSbtEventBus[ID]
    if (!process.env.EVENT_BUS_NAME) {
      const errorMsg = 'CRITICAL: EVENT_BUS_NAME environment variable is not set. ' +
        'This is required for EventBridge integration. ' +
        'Ensure it is configured in service-info.txt and deployed via CDK.';
      this.logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    this.eventBusName = process.env.EVENT_BUS_NAME;

    this.logger.log(`EventService initialized with bus: ${this.eventBusName}`);
    // Note: eventSource is abstract and will be set by subclass
    // Accessing it here is safe because subclasses must define it before constructor completes
  }

  /**
   * Typed entry point for emitting a registry-known domain event
   * (Sprint C0.c.3). The `DomainEvent` discriminated union from
   * `@aibrains/shared-types` enforces schema membership at compile time;
   * `publishEvent` (called internally) re-validates at runtime so a
   * cast-bypass is caught.
   *
   * Prefer this method for any new emit site. The legacy untyped
   * `publishEvent` remains for the ~110 existing PascalCase event
   * types that haven't yet migrated to the C0.c.2 taxonomy.
   */
  async publishValidatedEvent(event: DomainEvent): Promise<void> {
    return this.publishEvent(event as BaseDomainEvent);
  }

  /**
   * C0.c.3 — runtime payload validation gate.
   *
   * Returns `{ shouldEmit: true }` for:
   *   - events whose `eventType` is in EVENT_REGISTRY AND whose payload
   *     passes the schema
   *   - events whose `eventType` is NOT in EVENT_REGISTRY (legacy
   *     PascalCase publishers — log a warning so the migration debt is
   *     visible, but emit)
   *
   * Returns `{ shouldEmit: false }` ONLY for registered + invalid
   * payloads. The caller is responsible for invoking the DLQ hook.
   */
  private validateBeforeEmit(event: BaseDomainEvent): { shouldEmit: boolean; failure?: { errorCode: string; issues: unknown } } {
    // Cast eventType to satisfy validateEvent's `eventType: string` contract.
    // BaseDomainEvent's eventType is already `string`; the spread + explicit
    // re-set is defensive in case a caller passes a fixture with a narrowed
    // literal type.
    const result: any = validateEvent({
      ...event,
      eventType: event.eventType,
    });

    if (result.success === true) {
      return { shouldEmit: true };
    }

    if (result.error === 'UNKNOWN_EVENT_TYPE') {
      // Legacy PascalCase event (SchoolCreated, AttendanceRecorded, …).
      // Emit preserves backward compat; warning surfaces migration debt.
      this.logger.warn(
        `Emitting unregistered eventType '${event.eventType}' — add a schema to EVENT_REGISTRY (C0.c.2 taxonomy) to enable runtime validation.`,
      );
      return { shouldEmit: true };
    }

    // INVALID_PAYLOAD: registered eventType but payload doesn't match.
    // Don't push corrupted JSON to EventBridge; downstream parses would
    // crash. The caller's auditedWrite still records what happened.
    this.logger.error('Event payload validation failed — skipping emit', {
      eventType: event.eventType,
      tenantId: event.tenantId,
      issues: result.details?.issues,
    });
    return {
      shouldEmit: false,
      failure: { errorCode: 'INVALID_PAYLOAD', issues: result.details?.issues ?? [] },
    };
  }

  /**
   * Publish a single domain event
   *
   * ERROR HANDLING:
   * - Logs error but doesn't throw (event publishing should not block main operation)
   * - Failed events logged to CloudWatch for monitoring
   * - C0.c.3 — runs validateBeforeEmit; skips emit + invokes DLQ hook
   *   when a registered event's payload doesn't match its schema
   *
   * PERFORMANCE:
   * - Async/non-blocking
   * - ~10ms latency typical
   */
  async publishEvent(event: BaseDomainEvent): Promise<void> {
    const gate = this.validateBeforeEmit(event);
    if (!gate.shouldEmit) {
      await this.handleEventPublishingFailure(event, gate.failure);
      return;
    }
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
        this.logger.error('Failed to publish event:', {
          event: event.eventType,
          failures: result.Entries
        });
        
        await this.handleEventPublishingFailure(event, result.Entries?.[0]);
      } else {
        this.logger.log(`✅ Event published: ${event.eventType}`, {
          tenantId: event.tenantId,
          eventId: result.Entries?.[0].EventId
        });
      }
    } catch (error) {
      this.logger.error('Error publishing event to EventBridge:', error);
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
   * C0.c.3 — runs validateBeforeEmit on each event before chunking.
   * INVALID_PAYLOAD entries are dropped from the batch and routed to
   * the DLQ hook individually; the remaining valid + legacy events are
   * chunked and emitted as before.
   */
  async publishEvents(events: BaseDomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    // Pre-validate each event. Dropped entries don't reach the EventBridge
    // emit path; their failures land in the DLQ hook instead.
    const validEvents: BaseDomainEvent[] = [];
    for (const event of events) {
      const gate = this.validateBeforeEmit(event);
      if (gate.shouldEmit) {
        validEvents.push(event);
      } else {
        await this.handleEventPublishingFailure(event, gate.failure);
      }
    }
    if (validEvents.length === 0) return;

    // EventBridge allows max 10 events per batch
    const batchSize = 10;
    const batches: BaseDomainEvent[][] = [];

    for (let i = 0; i < validEvents.length; i += batchSize) {
      batches.push(validEvents.slice(i, i + batchSize));
    }

    for (const batch of batches) {
      try {
        const entries: PutEventsRequestEntry[] = batch.map(event => ({
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
          this.logger.error(`Failed to publish ${result.FailedEntryCount} events in batch`);
          // Handle failures individually
          for (let i = 0; i < batch.length; i++) {
            if (result.Entries?.[i]?.ErrorCode) {
              await this.handleEventPublishingFailure(batch[i], result.Entries[i]);
            }
          }
        } else {
          this.logger.log(`✅ Published batch of ${batch.length} events`);
        }
      } catch (error) {
        this.logger.error('Error publishing event batch:', error);
        // Try to publish events individually
        for (const event of batch) {
          await this.publishEvent(event);
        }
      }
    }
  }

  /**
   * Handle event publishing failure
   * Override in subclasses for custom error handling
   */
  protected async handleEventPublishingFailure(
    event: BaseDomainEvent,
    error: any
  ): Promise<void> {
    // Log to CloudWatch for monitoring/alerting
    this.logger.error('Event publishing failure:', {
      eventType: event.eventType,
      tenantId: event.tenantId,
      error: error?.ErrorCode || error?.message || error
    });

    // TODO: Implement DLQ for critical events
    // For now, just log - events are best-effort delivery
  }
}

