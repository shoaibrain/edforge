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
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';

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
   * Publish a single domain event
   * 
   * ERROR HANDLING:
   * - Logs error but doesn't throw (event publishing should not block main operation)
   * - Failed events logged to CloudWatch for monitoring
   * 
   * PERFORMANCE:
   * - Async/non-blocking
   * - ~10ms latency typical
   */
  async publishEvent(event: BaseDomainEvent): Promise<void> {
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
   */
  async publishEvents(events: BaseDomainEvent[]): Promise<void> {
    if (events.length === 0) return;

    // EventBridge allows max 10 events per batch
    const batchSize = 10;
    const batches: BaseDomainEvent[][] = [];

    for (let i = 0; i < events.length; i += batchSize) {
      batches.push(events.slice(i, i + batchSize));
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

