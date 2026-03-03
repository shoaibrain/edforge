/**
 * Payment Sweep Service
 *
 * Periodically checks for abandoned pending gateway payments (older than 30 minutes)
 * and marks them as failed. This prevents stale pending records from accumulating.
 *
 * Pending gateway payments do NOT pre-debit invoices, so no invoice reversal is needed
 * when expiring them — we simply mark the payment as 'failed'.
 *
 * Uses the system DynamoDB client (not tenant-scoped TVM) since this is a
 * background job with IAM role permissions, not a user-initiated request.
 *
 * Runs every 30 minutes via setInterval (no @nestjs/schedule dependency needed).
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DynamoDBDocumentClient, ScanCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from './dynamodb-client.service';
import { PaymentEntity } from '../entities/payment.entity';
import { GSIKeyBuilder } from '../entities/base.entity';

/** Payments pending longer than this are considered abandoned (30 min) */
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

/** Sweep interval (30 min) */
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

@Injectable()
export class PaymentSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentSweepService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  onModuleInit() {
    // Only run sweep in production-like environments
    if (process.env.DISABLE_PAYMENT_SWEEP === 'true') {
      this.logger.log('Payment sweep disabled by DISABLE_PAYMENT_SWEEP env var');
      return;
    }

    this.logger.log(`Payment sweep scheduled every ${SWEEP_INTERVAL_MS / 60000} minutes`);
    this.intervalHandle = setInterval(() => {
      this.sweep().catch(err =>
        this.logger.error({ action: 'payment.sweep_error', error: err.message }),
      );
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Find and expire stale pending payments.
   * This is safe to call concurrently — each update uses optimistic locking.
   *
   * Scans the table for PAYMENT entities with status 'pending' and createdAt
   * before the cutoff time, then marks each as 'failed' with a failure reason.
   */
  async sweep(): Promise<{ processed: number; expired: number }> {
    this.logger.log({ action: 'payment.sweep_start' });
    let processed = 0;
    let expired = 0;

    try {
      const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
      const client = this.dynamoDBClient.getSystemClient();
      const tableName = this.dynamoDBClient.getTableName();

      // Scan for pending payments older than cutoff.
      // Filter: entityType = PAYMENT AND status = pending AND createdAt < cutoff
      let lastKey: Record<string, any> | undefined;

      do {
        const result = await client.send(new ScanCommand({
          TableName: tableName,
          FilterExpression:
            'entityType = :paymentType AND #status = :pending AND createdAt < :cutoff',
          ExpressionAttributeValues: {
            ':paymentType': 'PAYMENT',
            ':pending': 'pending',
            ':cutoff': cutoff,
          },
          ExpressionAttributeNames: {
            '#status': 'status',
          },
          ExclusiveStartKey: lastKey,
          Limit: 500, // Process in manageable pages
        }));

        const payments = (result.Items || []) as PaymentEntity[];
        processed += payments.length;

        for (const payment of payments) {
          try {
            await this.expirePayment(client, payment);
            expired++;

            this.logger.log({
              action: 'payment.sweep_expired',
              paymentId: payment.paymentId,
              schoolId: payment.schoolId,
              invoiceId: payment.invoiceId,
              gateway: payment.gateway,
              createdAt: payment.createdAt,
            });
          } catch (err: any) {
            // ConditionalCheckFailedException means another process already updated it — skip
            if (err.name === 'ConditionalCheckFailedException') {
              this.logger.debug({
                action: 'payment.sweep_skip_version_conflict',
                paymentId: payment.paymentId,
              });
              continue;
            }
            this.logger.warn({
              action: 'payment.sweep_expire_failed',
              paymentId: payment.paymentId,
              error: err.message,
            });
          }
        }

        lastKey = result.LastEvaluatedKey;
      } while (lastKey);

      this.logger.log({
        action: 'payment.sweep_complete',
        processed,
        expired,
        cutoffTime: cutoff,
      });
    } catch (err: any) {
      this.logger.error({
        action: 'payment.sweep_failed',
        error: err.message,
      });
    }

    return { processed, expired };
  }

  /**
   * Mark a single stale pending payment as failed.
   * Uses optimistic locking via version condition to prevent concurrent overwrites.
   * Updates GSI1SK to reflect the new status for index-based queries.
   */
  private async expirePayment(
    client: DynamoDBDocumentClient,
    payment: PaymentEntity,
  ): Promise<void> {
    const now = new Date().toISOString();

    await this.dynamoDBClient.updateItem(
      client,
      payment.tenantId,
      payment.entityKey,
      'SET #status = :failed, metadata.failureReason = :reason, gsi1sk = :gsi1sk, updatedAt = :now, #v = #v + :one',
      {
        ':failed': 'failed',
        ':reason': 'Payment session expired',
        ':gsi1sk': GSIKeyBuilder.entitySort('PAYMENT', `failed#${now}`),
        ':now': now,
        ':one': 1,
        ':currentVersion': payment.version,
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );
  }
}
