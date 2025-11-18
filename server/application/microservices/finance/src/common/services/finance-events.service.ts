/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Finance Events Service - EventBridge publisher for Finance & Billing bounded context
 */

import { Injectable } from '@nestjs/common';
import { EventServiceBase, BaseDomainEvent } from '@app/events';

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
export class FinanceEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.finance-service';

  async publishInvoiceGenerated(event: Omit<InvoiceGeneratedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'InvoiceGenerated',
      timestamp: new Date().toISOString()
    });
  }

  async publishInvoiceUpdated(event: Omit<InvoiceUpdatedEvent, 'eventType' | 'timestamp'>): Promise<void> {
    await this.publishEvent({
      ...event,
      eventType: 'InvoiceUpdated',
      timestamp: new Date().toISOString()
    });
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

