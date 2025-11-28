/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * EventBridge Mock Service - In-memory event capture for testing
 */

import { Injectable } from '@nestjs/common';
import { PutEventsCommandInput, PutEventsCommandOutput } from '@aws-sdk/client-eventbridge';

export interface CapturedEvent {
  source: string;
  'detail-type': string;
  detail: any;
  time: string;
}

/**
 * In-memory EventBridge mock for unit and integration testing
 * Captures events for verification in tests
 */
@Injectable()
export class MockEventBridgeService {
  private events: CapturedEvent[] = [];

  /**
   * Clear all captured events
   */
  clear(): void {
    this.events = [];
  }

  /**
   * Get all captured events
   */
  getEvents(): CapturedEvent[] {
    return [...this.events];
  }

  /**
   * Get events by source
   */
  getEventsBySource(source: string): CapturedEvent[] {
    return this.events.filter(e => e.source === source);
  }

  /**
   * Get events by detail-type
   */
  getEventsByDetailType(detailType: string): CapturedEvent[] {
    return this.events.filter(e => e['detail-type'] === detailType);
  }

  /**
   * Put events (simulates EventBridge PutEvents)
   */
  async putEvents(params: PutEventsCommandInput): Promise<PutEventsCommandOutput> {
    const entries = params.Entries || [];
    const successfulEntries: any[] = [];
    const failedEntries: any[] = [];

    for (const entry of entries) {
      try {
        const event: CapturedEvent = {
          source: entry.Source || '',
          'detail-type': entry.DetailType || '',
          detail: typeof entry.Detail === 'string' ? JSON.parse(entry.Detail) : entry.Detail,
          time: entry.Time || new Date().toISOString()
        };
        
        this.events.push(event);
        successfulEntries.push({ EventId: this.generateEventId() });
      } catch (error) {
        failedEntries.push({
          ErrorCode: 'ValidationException',
          ErrorMessage: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return {
      FailedEntryCount: failedEntries.length,
      Entries: successfulEntries.map((e, i) => ({
        EventId: e.EventId,
        ErrorCode: undefined,
        ErrorMessage: undefined
      }))
    };
  }

  /**
   * Verify event was published
   */
  verifyEventPublished(source: string, detailType: string, detailMatcher?: (detail: any) => boolean): boolean {
    return this.events.some(event => {
      if (event.source !== source || event['detail-type'] !== detailType) {
        return false;
      }
      if (detailMatcher) {
        return detailMatcher(event.detail);
      }
      return true;
    });
  }

  /**
   * Get event count
   */
  getEventCount(): number {
    return this.events.length;
  }

  /**
   * Generate mock event ID
   */
  private generateEventId(): string {
    return `mock-event-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

