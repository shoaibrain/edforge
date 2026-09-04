/**
 * Overdue Detection Service
 *
 * Periodically queries for invoices with 'issued' status that are past
 * their due date, then marks them as 'overdue'.
 *
 * EPIC-FB FB-0.1 (live finding L2, risk R5): the sweep is restricted to
 * `issued → overdue`. It previously ALSO flipped `partially_paid → overdue`,
 * erasing the partial-payment signal from `status`. Past-due partials now
 * surface through the derived read-side `isOverdue` flag (invoice.mapper.ts)
 * and the overdue-aware list/dashboard filters — status keeps carrying the
 * payment-progress signal.
 *
 * Uses GSI1 scan with sort key prefix filtering instead of a full table SCAN.
 * GSI1SK for invoices is: INVOICE#{status}#{dueDate}
 * This allows filtering to only 'issued' status invoices with minimal RCU
 * consumption via ProjectionExpression.
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
import { isLambdaRuntime } from '@app/common-utils';

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
    if (isLambdaRuntime()) {
      this.logger.log('Overdue detection timer not started: Lambda runtime (EventBridge Scheduler owns this cadence)');
      return;
    }
    if (process.env.DISABLE_OVERDUE_DETECTION === 'true') {
      this.logger.log('Overdue detection disabled by DISABLE_OVERDUE_DETECTION env var');
      return;
    }

    this.logger.log(`Overdue detection scheduled every ${DETECTION_INTERVAL_MS / 60000} minutes`);
    this.intervalHandle = setInterval(() => {
      this.runOnce().catch(err =>
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
   * Scans GSI1 for invoices whose gsi1sk starts with 'INVOICE#issued',
   * filtered by dueDate < today.
   * Uses ProjectionExpression to minimize RCU and a MAX_ITEMS guard.
   */
  /**
   * Cost-redesign C3.2 — the unit of work the timer runs, callable by name
   * from the scheduled Lambda entry (finance/src/scheduled.ts). The interval
   * and the startup timer call this, never the method below directly.
   */
  runOnce(): ReturnType<OverdueDetectionService['detectOverdue']> {
    return this.detectOverdue();
  }

  async detectOverdue(): Promise<{ marked: number; scanned: number }> {
    this.logger.log({ action: 'overdue.detection_start' });
    let marked = 0;
    let scanned = 0;

    try {
      const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
      const client = this.dynamoDBClient.getSystemClient();
      const tableName = this.dynamoDBClient.getTableName();

      // Scan GSI1 for issued invoices with dueDate < today.
      // GSI1SK format: INVOICE#{status}#{dueDate}
      // Using begins_with on gsi1sk narrows the scan to relevant entities.
      // FB-0.1: partially_paid is deliberately NOT swept — see file header.
      let lastKey: Record<string, any> | undefined;

      do {
        const result = await client.send(new ScanCommand({
          TableName: tableName,
          IndexName: 'GSI1',
          FilterExpression:
            'begins_with(gsi1sk, :issuedPrefix) AND dueDate < :today',
          ExpressionAttributeValues: {
            ':issuedPrefix': 'INVOICE#issued',
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

          // FB-0.1 belt-and-braces: only `issued` rows transition. The scan
          // filter already excludes other statuses, but a row whose status
          // changed between the GSI projection and this loop must not be
          // flipped (the markOverdue version condition is the hard guard;
          // this skip avoids even attempting the write).
          if (invoice.status !== 'issued') continue;

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
