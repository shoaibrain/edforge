/**
 * Overdue Detection Service
 *
 * Periodically queries for invoices with 'issued' or 'partially_paid' status
 * that are past their due date, then marks them as 'overdue'.
 *
 * Uses GSI1 scan with sort key prefix filtering instead of a full table SCAN.
 * GSI1SK for invoices is: INVOICE#{status}#{dueDate}
 * This allows filtering to only 'issued' and 'partially_paid' status invoices
 * with minimal RCU consumption via ProjectionExpression.
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

/** Maximum items to process per run — safety guard against runaway scans */
const MAX_ITEMS = 50_000;

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
   * Find and mark overdue invoices using GSI1 scan.
   *
   * Scans GSI1 for invoices whose gsi1sk starts with 'INVOICE#issued' or
   * 'INVOICE#partially_paid', filtered by dueDate < today.
   * Uses ProjectionExpression to minimize RCU and a MAX_ITEMS guard.
   */
  async detectOverdue(): Promise<{ marked: number; scanned: number }> {
    this.logger.log({ action: 'overdue.detection_start' });
    let marked = 0;
    let scanned = 0;

    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const client = this.dynamoDBClient.getSystemClient();
      const tableName = this.dynamoDBClient.getTableName();

      // Scan GSI1 for issued and partially_paid invoices with dueDate < today.
      // GSI1SK format: INVOICE#{status}#{dueDate}
      // Using begins_with on gsi1sk narrows the scan to relevant entities.
      let lastKey: Record<string, any> | undefined;

      do {
        const result = await client.send(new ScanCommand({
          TableName: tableName,
          IndexName: 'GSI1',
          FilterExpression:
            '(begins_with(gsi1sk, :issuedPrefix) OR begins_with(gsi1sk, :partialPrefix)) AND dueDate < :today',
          ExpressionAttributeValues: {
            ':issuedPrefix': 'INVOICE#issued',
            ':partialPrefix': 'INVOICE#partially_paid',
            ':today': today,
          },
          // Only fetch fields needed for the update — minimizes RCU
          ProjectionExpression: 'tenantId, entityKey, entityType, invoiceId, schoolId, dueDate, #status, #v, gsi1pk, gsi1sk',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#v': 'version',
          },
          ExclusiveStartKey: lastKey,
          Limit: 500,
        }));

        const invoices = (result.Items || []) as InvoiceEntity[];
        scanned += invoices.length;

        for (const invoice of invoices) {
          if (scanned >= MAX_ITEMS) break;

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
      } while (lastKey && scanned < MAX_ITEMS);

      if (scanned >= MAX_ITEMS) {
        this.logger.warn({
          action: 'overdue.detection_limit_reached',
          maxItems: MAX_ITEMS,
          message: 'Overdue detection reached item limit. Some invoices may not have been processed.',
        });
      }

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
    const now = new Date().toISOString();
    await this.dynamoDBClient.updateItem(
      client,
      invoice.tenantId,
      invoice.entityKey,
      'SET #status = :overdue, gsi1sk = :gsi1sk, updatedAt = :now, #v = #v + :one, statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :historyEntry)',
      {
        ':overdue': 'overdue',
        ':gsi1sk': GSIKeyBuilder.entitySort('INVOICE', `overdue#${invoice.dueDate}`),
        ':now': now,
        ':one': 1,
        ':currentVersion': invoice.version,
        ':emptyList': [],
        ':historyEntry': [{ from: invoice.status, to: 'overdue', changedAt: now, changedBy: 'system' }],
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );
  }
}
