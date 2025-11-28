/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance Events Service - EventBridge publisher for Finance & Billing bounded context
 */

import { Injectable, Logger } from '@nestjs/common';
import { EventBridgeClient, PutEventsCommand, PutEventsRequestEntry } from '@aws-sdk/client-eventbridge';

export interface BaseDomainEvent {
  eventType: string;
  tenantId: string;
  timestamp: string;
}

/**
 * Domain Events Published by Finance Service
 */
export type FinanceDomainEvent =
  | InvoiceGeneratedEvent
  | InvoiceUpdatedEvent
  | PaymentReceivedEvent
  | PaymentRefundedEvent
  | InvoiceOverdueEvent
  | LateFeeAppliedEvent
  | DiscountAppliedEvent
  | ScholarshipAwardedEvent;

export interface InvoiceGeneratedEvent extends BaseDomainEvent {
  eventType: 'InvoiceGenerated';
  invoiceId: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  invoiceNumber: string;
  totalAmount: number;
  dueDate: string;
  lineItems: Array<{
    description: string;
    amount: number;
  }>;
}

export interface InvoiceUpdatedEvent extends BaseDomainEvent {
  eventType: 'InvoiceUpdated';
  invoiceId: string;
  studentId: string;
  changes: Record<string, any>;
}

export interface PaymentReceivedEvent extends BaseDomainEvent {
  eventType: 'PaymentReceived';
  paymentId: string;
  invoiceId: string;
  studentId: string;
  schoolId: string;
  amount: number;
  paymentMethod: string;
  transactionId?: string;
}

export interface PaymentRefundedEvent extends BaseDomainEvent {
  eventType: 'PaymentRefunded';
  paymentId: string;
  invoiceId: string;
  studentId: string;
  refundAmount: number;
  reason: string;
}

export interface InvoiceOverdueEvent extends BaseDomainEvent {
  eventType: 'InvoiceOverdue';
  invoiceId: string;
  studentId: string;
  schoolId: string;
  dueDate: string;
  daysOverdue: number;
  balanceDue: number;
}

export interface LateFeeAppliedEvent extends BaseDomainEvent {
  eventType: 'LateFeeApplied';
  invoiceId: string;
  studentId: string;
  schoolId: string;
  lateFeeAmount: number;
  daysOverdue: number;
}

export interface DiscountAppliedEvent extends BaseDomainEvent {
  eventType: 'DiscountApplied';
  invoiceId: string;
  studentId: string;
  discountId: string;
  discountAmount: number;
  discountType: string;
}

export interface ScholarshipAwardedEvent extends BaseDomainEvent {
  eventType: 'ScholarshipAwarded';
  scholarshipId: string;
  studentId: string;
  schoolId: string;
  academicYearId: string;
  amount: number;
  scholarshipType: string;
}

@Injectable()
export class FinanceEventsService {
  private readonly logger = new Logger(FinanceEventsService.name);
  private readonly eventBridge: EventBridgeClient;
  private readonly eventBusName: string;
  private readonly eventSource: string = 'edforge.finance-service';

  constructor() {
    this.eventBridge = new EventBridgeClient({
      region: process.env.AWS_REGION || 'us-east-1'
    });
    this.eventBusName = process.env.EVENT_BUS_NAME || 'default';
    this.logger.log(`Finance Events Service initialized with bus: ${this.eventBusName}`);
  }

  private async publishEvent(event: FinanceDomainEvent): Promise<void> {
    try {
      const entry: PutEventsRequestEntry = {
        Source: this.eventSource,
        DetailType: event.eventType,
        Detail: JSON.stringify(event),
        EventBusName: this.eventBusName !== 'default' ? this.eventBusName : undefined
      };

      const command = new PutEventsCommand({
        Entries: [entry]
      });

      const response = await this.eventBridge.send(command);

      if (response.FailedEntryCount && response.FailedEntryCount > 0) {
        const error = response.Entries?.[0]?.ErrorMessage || 'Unknown error';
        this.logger.error(`Failed to publish ${event.eventType} event: ${error}`);
        throw new Error(`Failed to publish event: ${error}`);
      }

      this.logger.debug(`Published ${event.eventType} event for tenant ${event.tenantId}`);
    } catch (error: any) {
      this.logger.error(`Error publishing ${event.eventType} event: ${error.message}`, error.stack);
      throw error;
    }
  }

  async publishInvoiceGenerated(event: Omit<InvoiceGeneratedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'InvoiceGenerated',
      timestamp: new Date().toISOString()
    } as InvoiceGeneratedEvent);
  }

  async publishInvoiceUpdated(event: Omit<InvoiceUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'InvoiceUpdated',
      timestamp: new Date().toISOString()
    } as InvoiceUpdatedEvent);
  }

  async publishPaymentReceived(event: Omit<PaymentReceivedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'PaymentReceived',
      timestamp: new Date().toISOString()
    });
  }

  async publishPaymentRefunded(event: Omit<PaymentRefundedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'PaymentRefunded',
      timestamp: new Date().toISOString()
    });
  }

  async publishInvoiceOverdue(event: Omit<InvoiceOverdueEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'InvoiceOverdue',
      timestamp: new Date().toISOString()
    });
  }

  async publishLateFeeApplied(event: Omit<LateFeeAppliedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'LateFeeApplied',
      timestamp: new Date().toISOString()
    });
  }

  async publishDiscountApplied(event: Omit<DiscountAppliedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'DiscountApplied',
      timestamp: new Date().toISOString()
    });
  }

  async publishScholarshipAwarded(event: Omit<ScholarshipAwardedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'ScholarshipAwarded',
      timestamp: new Date().toISOString()
    });
  }
}

