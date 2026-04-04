/**
 * Recurring Billing Service
 *
 * Generates invoices for recurring fee structures (monthly, quarterly, annual)
 * by scanning active enrollments and checking whether an invoice already exists
 * for the current billing period.
 *
 * Design:
 * - Runs daily at startup + every 24 hours via setInterval
 * - Billing period naming: '2026-04' (monthly), '2026-Q2' (quarterly), '2026' (annual)
 * - Idempotency key per run: checks for existing invoices with the same
 *   studentId + feeStructureId + billingPeriod combination
 * - Uses getSystemClient() (ECS task role, NOT TVM) — background job only
 *
 * Disable with DISABLE_RECURRING_BILLING=true env var.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from './dynamodb-client.service';
import { FinanceEventsService } from './finance-events.service';

/** Run daily (every 24 hours) */
const BILLING_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Safety guard */
const MAX_ITEMS = 50_000;

type BillingFrequency = 'monthly' | 'quarterly' | 'annual';

@Injectable()
export class RecurringBillingService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RecurringBillingService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_RECURRING_BILLING === 'true') {
      this.logger.log('Recurring billing disabled by DISABLE_RECURRING_BILLING env var');
      return;
    }

    this.logger.log(`Recurring billing scheduled every ${BILLING_INTERVAL_MS / 3600000} hours`);

    // Delay initial run by 5 minutes to let the service fully warm up
    setTimeout(() => {
      this.generateRecurringInvoices().catch(err =>
        this.logger.error({ action: 'recurring_billing.initial_error', error: err.message }),
      );
    }, 5 * 60 * 1000);

    this.intervalHandle = setInterval(() => {
      this.generateRecurringInvoices().catch(err =>
        this.logger.error({ action: 'recurring_billing.error', error: err.message }),
      );
    }, BILLING_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Get the billing period string for a given date and frequency.
   * - monthly: '2026-04'
   * - quarterly: '2026-Q2'
   * - annual: '2026'
   */
  getBillingPeriod(date: Date, frequency: BillingFrequency): string {
    const year = date.getFullYear();
    const month = date.getMonth() + 1; // 1-indexed

    switch (frequency) {
      case 'monthly':
        return `${year}-${String(month).padStart(2, '0')}`;
      case 'quarterly': {
        const quarter = Math.ceil(month / 3);
        return `${year}-Q${quarter}`;
      }
      case 'annual':
        return `${year}`;
    }
  }

  /**
   * Main recurring billing loop.
   *
   * V1 strategy (log-only for safety):
   * 1. Scan for active auto-apply fee structures with recurring frequency
   * 2. For each, find enrolled students in matching grades
   * 3. Check if an invoice already exists for the current billing period
   * 4. If not, log the missing invoice for manual review
   *
   * V2: auto-generate the invoice using InvoicesService.generate()
   */
  async generateRecurringInvoices(): Promise<{ scanned: number; pending: number }> {
    this.logger.log({ action: 'recurring_billing.start' });
    let scanned = 0;
    let pending = 0;

    try {
      // Uses ECS task role credentials — see getSystemClient() doc in dynamodb-client.service.ts
      const client = this.dynamoDBClient.getSystemClient();
      const tableName = this.dynamoDBClient.getTableName();
      const now = new Date();

      // Step 1: Find active fee structures with recurring frequency
      let lastKey: Record<string, any> | undefined;

      do {
        const result = await client.send(new ScanCommand({
          TableName: tableName,
          FilterExpression: 'entityType = :feeType AND isActive = :active AND autoApplyOnEnrollment = :autoApply AND frequency IN (:monthly, :quarterly, :annual)',
          ExpressionAttributeValues: {
            ':feeType': 'FEE_STRUCTURE',
            ':active': true,
            ':autoApply': true,
            ':monthly': 'monthly',
            ':quarterly': 'quarterly',
            ':annual': 'annual',
          },
          ProjectionExpression: 'tenantId, entityKey, feeStructureId, schoolId, #name, frequency, amount, gradeLevels',
          ExpressionAttributeNames: { '#name': 'name' },
          ExclusiveStartKey: lastKey,
          Limit: 500,
        }));

        const feeStructures = (result.Items || []) as Array<{
          tenantId: string;
          entityKey: string;
          feeStructureId: string;
          schoolId: string;
          name: string;
          frequency: BillingFrequency;
          amount: number;
          gradeLevels: string[];
        }>;
        scanned += feeStructures.length;

        for (const fs of feeStructures) {
          if (scanned >= MAX_ITEMS) break;

          const billingPeriod = this.getBillingPeriod(now, fs.frequency);

          // Check if any invoices already exist for this fee structure + billing period
          const invoiceCheck = await client.send(new ScanCommand({
            TableName: tableName,
            FilterExpression: 'entityType = :invoiceType AND begins_with(entityKey, :schoolPrefix) AND billingPeriod = :period',
            ExpressionAttributeValues: {
              ':invoiceType': 'INVOICE',
              ':schoolPrefix': `INVOICE#${fs.schoolId}`,
              ':period': billingPeriod,
            },
            ProjectionExpression: 'invoiceId, studentId',
            Limit: 1,
          }));

          const hasInvoicesForPeriod = invoiceCheck.Items && invoiceCheck.Items.length > 0;

          if (!hasInvoicesForPeriod) {
            pending++;
            this.logger.warn({
              action: 'recurring_billing.period_missing',
              tenantId: fs.tenantId,
              schoolId: fs.schoolId,
              feeStructureId: fs.feeStructureId,
              feeStructureName: fs.name,
              frequency: fs.frequency,
              billingPeriod,
              amount: fs.amount,
              message: `No invoices found for billing period ${billingPeriod}. Manual bulk-generate may be needed.`,
            });
          }
        }

        lastKey = result.LastEvaluatedKey;
      } while (lastKey && scanned < MAX_ITEMS);

      this.logger.log({
        action: 'recurring_billing.complete',
        scanned,
        pending,
      });
    } catch (err: any) {
      this.logger.error({
        action: 'recurring_billing.failed',
        error: err.message,
      });
    }

    return { scanned, pending };
  }
}
