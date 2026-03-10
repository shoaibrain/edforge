/**
 * Finance Events Service
 *
 * Publishes domain events to EventBridge for the finance service.
 * All events are fire-and-forget — failures are logged but don't block the request.
 */

import { Injectable } from '@nestjs/common';
import { EventServiceBase } from '@app/events';

@Injectable()
export class FinanceEventsService extends EventServiceBase {
  protected readonly eventSource = 'edforge.finance-service';

  async publishFeeStructureCreated(
    tenantId: string,
    schoolId: string,
    feeStructureId: string,
    name: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'FeeStructureCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      feeStructureId,
      name,
    });
  }

  async publishFeeStructureUpdated(
    tenantId: string,
    schoolId: string,
    feeStructureId: string,
    updatedFields: string[],
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'FeeStructureUpdated',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      feeStructureId,
      updatedFields,
    });
  }

  async publishFeeStructureVersioned(
    tenantId: string,
    schoolId: string,
    previousFeeStructureId: string,
    newFeeStructureId: string,
    version: number,
    changedFields: string[],
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'FeeStructureVersioned',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      previousFeeStructureId,
      newFeeStructureId,
      version,
      changedFields,
    });
  }

  async publishInvoiceGenerated(
    tenantId: string,
    schoolId: string,
    invoiceId: string,
    invoiceNumber: string,
    studentId: string,
    grandTotal: number,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'InvoiceGenerated',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      invoiceId,
      invoiceNumber,
      studentId,
      grandTotal,
    });
  }

  async publishInvoiceStatusChanged(
    tenantId: string,
    schoolId: string,
    invoiceId: string,
    previousStatus: string,
    newStatus: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'InvoiceStatusChanged',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      invoiceId,
      previousStatus,
      newStatus,
    });
  }

  async publishPaymentCompleted(
    tenantId: string,
    schoolId: string,
    paymentId: string,
    invoiceId: string,
    amount: number,
    gateway: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'PaymentCompleted',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      paymentId,
      invoiceId,
      amount,
      gateway,
    });
  }

  async publishPaymentFailed(
    tenantId: string,
    schoolId: string,
    paymentId: string,
    invoiceId: string,
    reason: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'PaymentFailed',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      paymentId,
      invoiceId,
      reason,
    });
  }

  async publishRefundProcessed(
    tenantId: string,
    schoolId: string,
    paymentId: string,
    refundId: string,
    amount: number,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'RefundProcessed',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      paymentId,
      refundId,
      amount,
    });
  }

  async publishBillingAccountCreated(
    tenantId: string,
    schoolId: string,
    studentId: string,
    accountId: string,
    invoiceId?: string,
  ): Promise<void> {
    await this.publishEvent({
      eventType: 'BillingAccountCreated',
      timestamp: new Date().toISOString(),
      tenantId,
      schoolId,
      studentId,
      accountId,
      invoiceId,
    });
  }
}
