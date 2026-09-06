/**
 * Billing Reconciliation Service
 *
 * Periodically scans for students with billing accounts but no invoices,
 * which indicates a failed enrollment-to-billing webhook. V1: log-only,
 * no auto-retry or auto-invoice creation.
 *
 * Uses the system DynamoDB client (not tenant-scoped TVM) since this is a
 * background job with IAM role permissions, not a user-initiated request.
 *
 * Runs every 60 minutes via setInterval (same pattern as OverdueDetectionService).
 * Disable with DISABLE_BILLING_RECONCILIATION=true env var.
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { QueryCommand, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from './dynamodb-client.service';
import { isLambdaRuntime } from '@app/common-utils';

/** Check interval: every 60 minutes */
const RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000;

/** Only flag accounts created more than 10 minutes ago — avoids false positives from in-flight enrollments */
const ACCOUNT_AGE_THRESHOLD_MS = 10 * 60 * 1000;

/** Safety guard against runaway scans */
const MAX_ITEMS = 50_000;

@Injectable()
export class BillingReconciliationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BillingReconciliationService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
  ) {}

  onModuleInit() {
    if (isLambdaRuntime()) {
      this.logger.log('Billing reconciliation timer not started: Lambda runtime (EventBridge Scheduler owns this cadence)');
      return;
    }
    if (process.env.DISABLE_BILLING_RECONCILIATION === 'true') {
      this.logger.log('Billing reconciliation disabled by DISABLE_BILLING_RECONCILIATION env var');
      return;
    }

    this.logger.log(`Billing reconciliation scheduled every ${RECONCILIATION_INTERVAL_MS / 60000} minutes`);
    this.intervalHandle = setInterval(() => {
      this.runOnce().catch(err =>
        this.logger.error({ action: 'billing_reconciliation.error', error: err.message }),
      );
    }, RECONCILIATION_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Find billing accounts that have no corresponding invoices.
   *
   * Strategy:
   * 1. Scan for all BILLING_ACCOUNT entities
   * 2. For each, query for INVOICE entities with the same studentId
   * 3. If no invoices found and account is older than threshold, log as unbilled
   *
   * V1: log-only. Future: auto-retry the enrollment webhook.
   */
  /**
   * Cost-redesign C3.2 — the unit of work the timer runs, callable by name
   * from the scheduled Lambda entry (finance/src/scheduled.ts). The interval
   * and the startup timer call this, never the method below directly.
   */
  /**
   * Issue #467 — does this student have any invoice at this school?
   *
   * This was a table `Scan` with a `FilterExpression` and `Limit: 1`.
   * DynamoDB applies `Limit` BEFORE the filter, so it read one arbitrary
   * row of the whole table and then filtered it away — the answer was
   * "no invoices" for essentially every student, and this money-integrity
   * alarm fired constantly on students who were correctly billed.
   *
   * Now a student-scoped GSI2 query. GSI2 spans a student's invoices across
   * schools, so the school stays a filter; the partition is small (a
   * student's own invoices), so this is cheap and pages rarely.
   */
  private async studentHasInvoices(
    client: ReturnType<DynamoDBClientService['getSystemClient']>,
    tableName: string,
    tenantId: string,
    studentId: string,
    schoolId: string,
  ): Promise<boolean> {
    const PAGE_SIZE = 100;
    const MAX_PAGES = 25;
    let lastKey: Record<string, any> | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.send(new QueryCommand({
        TableName: tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'gsi2pk = :pk AND begins_with(gsi2sk, :sk)',
        FilterExpression: 'begins_with(entityKey, :schoolPrefix)',
        ExpressionAttributeValues: {
          ':pk': `TENANT#${tenantId}#STUDENT#${studentId}`,
          ':sk': 'INVOICE',
          ':schoolPrefix': `INVOICE#${schoolId}`,
        },
        ProjectionExpression: 'invoiceId',
        Limit: PAGE_SIZE,
        ExclusiveStartKey: lastKey,
      }));

      if ((result.Items || []).length > 0) return true;
      if (!result.LastEvaluatedKey) return false;
      lastKey = result.LastEvaluatedKey;
    }

    this.logger.warn({
      action: 'billing_reconciliation.student_check_capped',
      tenantId,
      studentId,
      schoolId,
      message:
        'Invoice existence check hit the page cap; treating the student as ' +
        'billed so this run cannot raise a false unbilled alert.',
    });
    return true;
  }

  runOnce(): ReturnType<BillingReconciliationService['reconcile']> {
    return this.reconcile();
  }

  async reconcile(): Promise<{ scanned: number; unbilled: number }> {
    this.logger.log({ action: 'billing_reconciliation.start' });
    let scanned = 0;
    let unbilled = 0;

    try {
      // Uses ECS task role credentials, not tenant-scoped TVM.
      // See getSystemClient() comment in dynamodb-client.service.ts.
      const client = this.dynamoDBClient.getSystemClient();
      const tableName = this.dynamoDBClient.getTableName();
      const cutoffTime = new Date(Date.now() - ACCOUNT_AGE_THRESHOLD_MS).toISOString();

      let lastKey: Record<string, any> | undefined;

      do {
        // Scan for billing account entities created before the cutoff
        const result = await client.send(new ScanCommand({
          TableName: tableName,
          FilterExpression: 'entityType = :accountType AND createdAt < :cutoff',
          ExpressionAttributeValues: {
            ':accountType': 'BILLING_ACCOUNT',
            ':cutoff': cutoffTime,
          },
          ProjectionExpression: 'tenantId, entityKey, studentId, schoolId, createdAt',
          ExclusiveStartKey: lastKey,
          Limit: 500,
        }));

        const accounts = (result.Items || []) as Array<{
          tenantId: string;
          entityKey: string;
          studentId: string;
          schoolId: string;
          createdAt: string;
        }>;
        scanned += accounts.length;

        for (const account of accounts) {
          if (scanned >= MAX_ITEMS) break;

          // Check if this student has any invoices in this school
          const studentHasInvoices = await this.studentHasInvoices(
            client, tableName, account.tenantId, account.studentId, account.schoolId,
          );

          if (!studentHasInvoices) {
            unbilled++;
            this.logger.warn({
              action: 'billing_reconciliation.unbilled_student',
              tenantId: account.tenantId,
              studentId: account.studentId,
              schoolId: account.schoolId,
              accountCreatedAt: account.createdAt,
              message: 'Student has billing account but no invoices — possible webhook failure',
            });
          }
        }

        lastKey = result.LastEvaluatedKey;
      } while (lastKey && scanned < MAX_ITEMS);

      if (scanned >= MAX_ITEMS) {
        this.logger.warn({
          action: 'billing_reconciliation.limit_reached',
          maxItems: MAX_ITEMS,
        });
      }

      this.logger.log({
        action: 'billing_reconciliation.complete',
        scanned,
        unbilled,
      });
    } catch (err: any) {
      this.logger.error({
        action: 'billing_reconciliation.failed',
        error: err.message,
      });
    }

    return { scanned, unbilled };
  }
}
