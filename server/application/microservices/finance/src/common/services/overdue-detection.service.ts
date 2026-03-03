/**
 * Overdue Detection Service
 *
 * Periodically scans invoices with 'issued' or 'partially_paid' status
 * and marks those past their due date as 'overdue'.
 *
 * Runs every 60 minutes via setInterval (same pattern as PaymentSweepService).
 * Disable with DISABLE_OVERDUE_DETECTION=true env var.
 *
 * Uses the system DynamoDB client (not tenant-scoped TVM) since this is a
 * background job with IAM role permissions, not a user-initiated request.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from './dynamodb-client.service';
import { FinanceEventsService } from './finance-events.service';
import { InvoiceEntity } from '../entities/invoice.entity';
import { GSIKeyBuilder } from '../entities/base.entity';

/** Check interval: every 60 minutes */
const DETECTION_INTERVAL_MS = 60 * 60 * 1000;

@Injectable()
export class OverdueDetectionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OverdueDetectionService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
  ) {}

  onModuleInit() {
    if (process.env.DISABLE_OVERDUE_DETECTION === 'true') {
      this.logger.log('Overdue detection disabled by DISABLE_OVERDUE_DETECTION env var');
      return;
    }

    this.logger.log(`Overdue detection scheduled every ${DETECTION_INTERVAL_MS / 60000} minutes`);
    this.intervalHandle = setInterval(() => {
      this.detectOverdue().catch(err =>
        this.logger.error({ action: 'overdue.detection_error', error: err.message }),
      );
    }, DETECTION_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Scan for overdue invoices using the system client.
   * Scans the table for INVOICE entities in 'issued' or 'partially_paid' status
   * with dueDate before today, then marks them as 'overdue'.
   */
  async detectOverdue(): Promise<{ marked: number; scanned: number }> {
    this.logger.log({ action: 'overdue.detection_start' });
    let marked = 0;
    let scanned = 0;

    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const client = this.dynamoDBClient.getSystemClient();
      const tableName = this.dynamoDBClient.getTableName();

      // Scan for invoices that are candidates for overdue marking.
      // Filter: entityType = INVOICE AND status IN (issued, partially_paid) AND dueDate < today
      let lastKey: Record<string, any> | undefined;

      do {
        const result = await client.send(new ScanCommand({
          TableName: tableName,
          FilterExpression:
            'entityType = :invoiceType AND (#status = :issued OR #status = :partiallyPaid) AND dueDate < :today',
          ExpressionAttributeValues: {
            ':invoiceType': 'INVOICE',
            ':issued': 'issued',
            ':partiallyPaid': 'partially_paid',
            ':today': today,
          },
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExclusiveStartKey: lastKey,
          Limit: 500, // Process in manageable pages
        }));

        const invoices = (result.Items || []) as InvoiceEntity[];
        scanned += invoices.length;

        for (const invoice of invoices) {
          try {
            await this.markOverdue(client, invoice);
            marked++;

            this.eventsService.publishInvoiceStatusChanged(
              invoice.tenantId,
              invoice.schoolId,
              invoice.invoiceId,
              invoice.status,
              'overdue',
            ).catch(err => this.logger.error(`Failed to publish InvoiceOverdue: ${err.message}`));
          } catch (err: any) {
            // ConditionalCheckFailedException = another process updated it — skip
            if (err.name === 'ConditionalCheckFailedException') continue;
            this.logger.warn({
              action: 'overdue.mark_failed',
              invoiceId: invoice.invoiceId,
              error: err.message,
            });
          }
        }

        lastKey = result.LastEvaluatedKey;
      } while (lastKey);

      this.logger.log({
        action: 'overdue.detection_complete',
        marked,
        scanned,
      });
    } catch (err: any) {
      this.logger.error({
        action: 'overdue.detection_failed',
        error: err.message,
      });
    }

    return { marked, scanned };
  }

  private async markOverdue(
    client: DynamoDBDocumentClient,
    invoice: InvoiceEntity,
  ): Promise<void> {
    await this.dynamoDBClient.updateItem(
      client,
      invoice.tenantId,
      invoice.entityKey,
      'SET #status = :overdue, gsi1sk = :gsi1sk, updatedAt = :now, #v = #v + :one',
      {
        ':overdue': 'overdue',
        ':gsi1sk': GSIKeyBuilder.entitySort('INVOICE', `overdue#${invoice.dueDate}`),
        ':now': new Date().toISOString(),
        ':one': 1,
        ':currentVersion': invoice.version,
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );
  }
}
