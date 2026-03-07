/**
 * Payment Sweep Service
 *
 * Periodically checks for abandoned pending gateway payments (older than 30 minutes)
 * and resolves them by checking the gateway first:
 *   - If gateway says completed → mark as completed + log for reconciliation
 *   - If gateway says failed/not_found or check fails → mark as failed
 *
 * Pending gateway payments do NOT pre-debit invoices, so no invoice reversal is needed
 * when expiring them — we simply mark the payment as 'failed'.
 *
 * When the sweep marks a payment as completed (via gateway verification), it sets
 * `metadata.sweepReconciled = true` as a flag. The admin reconciliation endpoint
 * (Sprint 2) handles applying the payment to the invoice and recording the ledger entry.
 *
 * Uses the system DynamoDB client (not tenant-scoped TVM) since this is a
 * background job with IAM role permissions, not a user-initiated request.
 *
 * Runs every 30 minutes via setInterval (no @nestjs/schedule dependency needed).
 */

import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { DynamoDBDocumentClient, ScanCommand, GetCommand } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from './dynamodb-client.service';
import { GatewayAdapterRegistryService } from '../../payment-gateways/adapters/gateway-adapter-registry.service';
import { SequenceService } from './sequence.service';
import { PaymentEntity } from '../entities/payment.entity';
import { GatewayConfigEntity } from '../entities/gateway-config.entity';
import { EntityKeyBuilder, GSIKeyBuilder } from '../entities/base.entity';
import type { GatewayVerifyResult } from '../../payment-gateways/adapters/gateway-adapter.interface';

/** Payments pending longer than this are considered abandoned (30 min) */
const STALE_THRESHOLD_MS = 30 * 60 * 1000;

/** Sweep interval (30 min) */
const SWEEP_INTERVAL_MS = 30 * 60 * 1000;

/** Timeout for gateway verification call (10 seconds) */
const GATEWAY_VERIFY_TIMEOUT_MS = 10_000;

/** Maximum items to process per run — safety guard against runaway scans */
const MAX_ITEMS = 50_000;

@Injectable()
export class PaymentSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaymentSweepService.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly gatewayRegistry: GatewayAdapterRegistryService,
    private readonly sequenceService: SequenceService,
  ) {}

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
   * Find and resolve stale pending payments.
   * This is safe to call concurrently — each update uses optimistic locking.
   *
   * For each stale pending payment:
   * 1. Check the gateway for real payment status
   * 2. If completed at gateway → mark completed + log for reconciliation
   * 3. If failed/not found/timeout → mark as failed (expired)
   */
  async sweep(): Promise<{ processed: number; expired: number; completed: number }> {
    this.logger.log({ action: 'payment.sweep_start' });
    let processed = 0;
    let expired = 0;
    let completed = 0;

    try {
      const cutoff = new Date(Date.now() - STALE_THRESHOLD_MS).toISOString();
      const client = this.dynamoDBClient.getSystemClient();
      const tableName = this.dynamoDBClient.getTableName();

      // Scan GSI1 for pending payments older than cutoff.
      // GSI1SK for payments is: PAYMENT#{status}#{timestamp}
      // Using begins_with on gsi1sk narrows to pending payments only.
      let lastKey: Record<string, any> | undefined;

      do {
        const result = await client.send(new ScanCommand({
          TableName: tableName,
          IndexName: 'GSI1',
          FilterExpression:
            'begins_with(gsi1sk, :pendingPrefix) AND createdAt < :cutoff',
          ExpressionAttributeValues: {
            ':pendingPrefix': 'PAYMENT#pending',
            ':cutoff': cutoff,
          },
          ProjectionExpression: 'tenantId, entityKey, entityType, paymentId, schoolId, invoiceId, gateway, amount, #status, #v, gatewaySessionId, createdAt, gsi1pk, gsi1sk, studentId',
          ExpressionAttributeNames: {
            '#status': 'status',
            '#v': 'version',
          },
          ExclusiveStartKey: lastKey,
          Limit: 500, // Process in manageable pages
        }));

        const payments = (result.Items || []) as PaymentEntity[];
        processed += payments.length;

        for (const payment of payments) {
          try {
            // Check gateway before expiring
            const gatewayResult = await this.checkGatewayStatus(client, payment);

            if (gatewayResult?.success) {
              // Gateway says completed — mark as completed
              await this.completePaymentFromSweep(client, payment, gatewayResult.gatewayTransactionId);
              completed++;

              this.logger.warn({
                action: 'payment.sweep_completed_from_gateway',
                paymentId: payment.paymentId,
                schoolId: payment.schoolId,
                invoiceId: payment.invoiceId,
                gateway: payment.gateway,
                amount: payment.amount,
                gatewayTransactionId: gatewayResult.gatewayTransactionId,
                message: 'Payment completed at gateway but callback was missed. Invoice/ledger reconciliation required.',
              });
            } else {
              // Gateway says failed/not_found or check failed — expire
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
            }
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
              action: 'payment.sweep_resolve_failed',
              paymentId: payment.paymentId,
              error: err.message,
            });
          }
        }

        lastKey = result.LastEvaluatedKey;
      } while (lastKey && processed < MAX_ITEMS);

      if (processed >= MAX_ITEMS) {
        this.logger.warn({
          action: 'payment.sweep_limit_reached',
          maxItems: MAX_ITEMS,
          message: 'Payment sweep reached item limit. Some payments may not have been processed.',
        });
      }

      this.logger.log({
        action: 'payment.sweep_complete',
        processed,
        expired,
        completed,
        cutoffTime: cutoff,
      });
    } catch (err: any) {
      this.logger.error({
        action: 'payment.sweep_failed',
        error: err.message,
      });
    }

    return { processed, expired, completed };
  }

  /**
   * Check the gateway for the real status of a pending payment.
   * Returns the GatewayVerifyResult or null if no adapter exists or check fails.
   */
  private async checkGatewayStatus(
    client: DynamoDBDocumentClient,
    payment: PaymentEntity,
  ): Promise<GatewayVerifyResult | null> {
    if (!this.gatewayRegistry.hasAdapter(payment.gateway)) {
      return null;
    }

    try {
      // Load gateway config directly from DynamoDB via system client
      const tableName = this.dynamoDBClient.getTableName();
      const configKey = EntityKeyBuilder.gatewayConfig(payment.schoolId, payment.gateway);

      const configResult = await client.send(new GetCommand({
        TableName: tableName,
        Key: {
          tenantId: payment.tenantId,
          entityKey: configKey,
        },
      }));

      if (!configResult.Item) {
        this.logger.debug({
          action: 'payment.sweep_no_gateway_config',
          paymentId: payment.paymentId,
          gateway: payment.gateway,
          schoolId: payment.schoolId,
        });
        return null;
      }

      const gatewayConfig = configResult.Item as GatewayConfigEntity;
      if (!gatewayConfig.isEnabled) {
        return null;
      }

      const adapter = this.gatewayRegistry.getAdapter(payment.gateway);
      const sessionId = payment.gatewaySessionId || payment.paymentId;

      // Race against timeout to prevent sweep from hanging on slow gateways
      const verifyResult = await Promise.race([
        adapter.verifyPayment(
          { transactionId: sessionId, amount: payment.amount, callbackData: {} },
          gatewayConfig,
        ),
        new Promise<GatewayVerifyResult>((_, reject) =>
          setTimeout(() => reject(new Error('Gateway verify timeout')), GATEWAY_VERIFY_TIMEOUT_MS),
        ),
      ]);

      return verifyResult;
    } catch (err: any) {
      this.logger.warn({
        action: 'payment.sweep_gateway_check_failed',
        paymentId: payment.paymentId,
        gateway: payment.gateway,
        error: err.message,
      });
      // On error, return null — payment will be expired (safe default)
      return null;
    }
  }

  /**
   * Mark a payment as completed when the gateway confirms it.
   * Updates payment status + receipt number. Sets sweepReconciled flag
   * so the admin reconciliation endpoint can apply invoice/ledger updates.
   */
  private async completePaymentFromSweep(
    client: DynamoDBDocumentClient,
    payment: PaymentEntity,
    gatewayTransactionId?: string,
  ): Promise<void> {
    const now = new Date().toISOString();

    const receiptNumber = await this.sequenceService.nextReceiptNumber(
      client,
      payment.tenantId,
      payment.schoolId,
    );

    let updateExpr = 'SET #status = :completed, paidAt = :now, receiptNumber = :receipt, gsi1sk = :gsi1sk, updatedAt = :now, #v = #v + :one, metadata.sweepReconciled = :sweepFlag';
    const exprValues: Record<string, any> = {
      ':completed': 'completed',
      ':now': now,
      ':receipt': receiptNumber,
      ':gsi1sk': GSIKeyBuilder.entitySort('PAYMENT', `completed#${now}`),
      ':one': 1,
      ':currentVersion': payment.version,
      ':sweepFlag': true,
    };

    if (gatewayTransactionId) {
      updateExpr += ', gatewayTransactionId = :gtxId';
      exprValues[':gtxId'] = gatewayTransactionId;
    }

    await this.dynamoDBClient.updateItem(
      client,
      payment.tenantId,
      payment.entityKey,
      updateExpr,
      exprValues,
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );
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
