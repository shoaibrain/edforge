import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { SequenceService } from '../common/services/sequence.service';
import { InvoicesService } from '../invoices/invoices.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import { GatewayAdapterRegistryService } from '../payment-gateways/adapters/gateway-adapter-registry.service';
import { PaymentGatewaysService } from '../payment-gateways/payment-gateways.service';
import type { GatewayVerifyResult } from '../payment-gateways/adapters/gateway-adapter.interface';
import {
  PaymentEntity,
  RefundData,
  createPaymentEntity,
} from '../common/entities/payment.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext } from '../common/entities/base.entity';
import { paymentEntityToDto } from '../common/mappers/payment.mapper';
import type {
  Payment,
  Receipt,
  RecordManualPaymentDto,
  CreateRefundDto,
  InitiatePaymentRequest,
  InitiatePaymentResponse,
  VerifyPaymentResponse,
} from '@aibrains/shared-types';

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
    private readonly sequenceService: SequenceService,
    private readonly invoicesService: InvoicesService,
    private readonly studentAccountsService: StudentAccountsService,
    private readonly gatewayRegistry: GatewayAdapterRegistryService,
    private readonly gatewayConfigService: PaymentGatewaysService,
  ) {}

  /**
   * Record a manual (offline) payment — cash, bank_transfer, cheque.
   * Atomically: create payment + update invoice + record ledger entry.
   */
  async recordManualPayment(
    schoolId: string,
    dto: RecordManualPaymentDto,
    context: RequestContext,
  ): Promise<Payment> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Idempotency check
    if (dto.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(schoolId, dto.idempotencyKey, context);
      if (existing) return paymentEntityToDto(existing);
    }

    // 2. Validate invoice
    const invoice = await this.invoicesService.getEntity(schoolId, dto.invoiceId, context);

    if (invoice.status === 'paid') {
      throw new BadRequestException('Invoice is already fully paid');
    }
    if (invoice.status === 'cancelled' || invoice.status === 'written_off') {
      throw new BadRequestException(`Cannot pay a ${invoice.status} invoice`);
    }
    if (dto.amount > invoice.amountDue) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds amount due (${invoice.amountDue})`,
      );
    }

    // 3. Create payment entity
    const paymentEntity = createPaymentEntity(
      context.tenantId,
      schoolId,
      {
        invoiceId: dto.invoiceId,
        studentAccountId: invoice.studentAccountId,
        studentId: invoice.studentId,
        amount: dto.amount,
        gateway: dto.gateway,
        paidBy: context.userId,
        idempotencyKey: dto.idempotencyKey,
      },
      context.userId,
    );

    // 4. Complete the payment immediately (manual payments)
    const now = new Date().toISOString();
    paymentEntity.status = 'completed';
    paymentEntity.paidAt = dto.paidDate || now;
    paymentEntity.gsi1sk = GSIKeyBuilder.entitySort('PAYMENT', `completed#${paymentEntity.paidAt}`);

    // 5. Generate receipt number
    paymentEntity.receiptNumber = await this.sequenceService.nextReceiptNumber(
      client,
      context.tenantId,
      schoolId,
    );

    if (dto.referenceNumber) {
      paymentEntity.gatewayTransactionId = dto.referenceNumber;
    }
    if (dto.notes) {
      paymentEntity.metadata = { ...paymentEntity.metadata, notes: dto.notes };
    }

    // 6. Persist payment
    await this.dynamoDBClient.putItem(client, paymentEntity);

    // 7. Update invoice (amountPaid, amountDue, status)
    await this.invoicesService.applyPayment(schoolId, dto.invoiceId, dto.amount, context);

    // 8. Record ledger entry (credit to student account)
    const accountKey = EntityKeyBuilder.billingAccount(schoolId, invoice.studentId);
    const account = await this.dynamoDBClient.getItem<any>(client, context.tenantId, accountKey);

    if (account) {
      await this.studentAccountsService.recordLedgerEntry(
        account,
        'payment',
        paymentEntity.paymentId,
        `Payment ${paymentEntity.receiptNumber} via ${dto.gateway}`,
        0,
        dto.amount,
        context,
      );
    }

    // 9. Publish event
    this.eventsService.publishPaymentCompleted(
      context.tenantId,
      schoolId,
      paymentEntity.paymentId,
      dto.invoiceId,
      dto.amount,
      dto.gateway,
    ).catch(err => this.logger.error(`Failed to publish PaymentCompleted: ${err.message}`));

    return paymentEntityToDto(paymentEntity);
  }

  async get(
    schoolId: string,
    paymentId: string,
    context: RequestContext,
  ): Promise<Payment> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.payment(schoolId, paymentId);

    const entity = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!entity) throw new NotFoundException(`Payment ${paymentId} not found`);

    return paymentEntityToDto(entity);
  }

  async listBySchool(
    schoolId: string,
    context: RequestContext,
    options: { status?: string; gateway?: string; limit?: number; cursor?: string } = {},
  ): Promise<{ items: Payment[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};

    if (options.status) {
      filterParts.push('#status = :status');
      filterValues[':status'] = options.status;
    }
    if (options.gateway) {
      filterParts.push('gateway = :gateway');
      filterValues[':gateway'] = options.gateway;
    }

    const result = await this.dynamoDBClient.queryGSI<PaymentEntity>(
      client,
      'GSI1',
      gsi1pk,
      'PAYMENT',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      filterParts.some(p => p.includes('#status')) ? { '#status': 'status' } : undefined,
      options.limit || 50,
      false,
      options.cursor ? JSON.parse(Buffer.from(options.cursor, 'base64').toString()) : undefined,
    );

    return {
      items: result.items.map(paymentEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async listByInvoice(
    schoolId: string,
    invoiceId: string,
    context: RequestContext,
  ): Promise<Payment[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const result = await this.dynamoDBClient.queryGSI<PaymentEntity>(
      client,
      'GSI1',
      gsi1pk,
      'PAYMENT',
      'begins_with',
      'invoiceId = :invoiceId',
      { ':invoiceId': invoiceId },
    );

    return result.items.map(paymentEntityToDto);
  }

  async getReceipt(
    schoolId: string,
    paymentId: string,
    context: RequestContext,
  ): Promise<Receipt> {
    const payment = await this.get(schoolId, paymentId, context);

    if (payment.status !== 'completed') {
      throw new BadRequestException('Receipt is only available for completed payments');
    }

    // Fetch the invoice for line item details
    const invoice = await this.invoicesService.get(schoolId, payment.invoiceId, context);

    return {
      receiptNumber: payment.receiptNumber || `RCP-${paymentId.substring(0, 8)}`,
      paymentId: payment.id,
      invoiceNumber: invoice.invoiceNumber,
      transactionId: payment.gatewayTransactionId || payment.id,
      studentName: invoice.studentName,
      studentId: invoice.studentId,
      schoolName: invoice.schoolName,
      paidDate: payment.paidAt || payment.createdAt,
      amount: payment.amount,
      currency: 'NPR',
      gateway: payment.gateway,
      gatewayDisplayName: payment.gateway.charAt(0).toUpperCase() + payment.gateway.slice(1),
      lineItems: invoice.lineItems.map(li => ({
        description: li.description,
        amount: li.amount,
        taxAmount: li.taxAmount,
        total: li.total,
      })),
      subtotal: invoice.subtotal,
      taxTotal: invoice.taxTotal,
      discountTotal: invoice.discountTotal,
      grandTotal: invoice.grandTotal,
      taxBreakdown: {
        taxableAmount: invoice.subtotal - invoice.discountTotal,
        taxAmount: invoice.taxTotal,
      },
      paidBy: payment.paidBy || 'Unknown',
    };
  }

  /**
   * Initiate a gateway payment session.
   * Creates a pending payment, calls the gateway adapter for redirect info.
   */
  async initiatePayment(
    schoolId: string,
    dto: InitiatePaymentRequest,
    context: RequestContext,
  ): Promise<InitiatePaymentResponse> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Validate invoice
    const invoice = await this.invoicesService.getEntity(schoolId, dto.invoiceId, context);

    if (invoice.status === 'paid') {
      throw new BadRequestException('Invoice is already fully paid');
    }
    if (invoice.status === 'cancelled' || invoice.status === 'written_off') {
      throw new BadRequestException(`Cannot pay a ${invoice.status} invoice`);
    }
    if (dto.amount > invoice.amountDue) {
      throw new BadRequestException(
        `Payment amount (${dto.amount}) exceeds amount due (${invoice.amountDue})`,
      );
    }

    // 2. Create a pending payment
    const sessionId = uuid();
    const paymentEntity = createPaymentEntity(
      context.tenantId,
      schoolId,
      {
        invoiceId: dto.invoiceId,
        studentAccountId: invoice.studentAccountId,
        studentId: invoice.studentId,
        amount: dto.amount,
        gateway: dto.gateway,
        gatewaySessionId: sessionId,
        paidBy: context.userId,
      },
      context.userId,
    );

    paymentEntity.metadata = {
      returnUrl: dto.returnUrl,
      cancelUrl: dto.cancelUrl,
    };

    await this.dynamoDBClient.putItem(client, paymentEntity);

    // 3. Call gateway adapter if available
    if (this.gatewayRegistry.hasAdapter(dto.gateway)) {
      const gatewayConfig = await this.gatewayConfigService.getEntity(schoolId, dto.gateway, context);

      if (!gatewayConfig.isEnabled) {
        throw new BadRequestException(`Gateway '${dto.gateway}' is not enabled for this school`);
      }

      const adapter = this.gatewayRegistry.getAdapter(dto.gateway);
      const adapterResult = await adapter.initiatePayment(
        {
          transactionId: sessionId,
          amount: dto.amount,
          taxAmount: 0,
          successUrl: dto.returnUrl,
          failureUrl: dto.cancelUrl,
          productName: `Invoice payment - ${dto.invoiceId.substring(0, 8)}`,
        },
        gatewayConfig,
      );

      // Store gateway-specific session ID if different from ours (e.g. Khalti pidx)
      if (adapterResult.gatewaySessionId && adapterResult.gatewaySessionId !== sessionId) {
        await this.dynamoDBClient.updateItem(
          client,
          context.tenantId,
          paymentEntity.entityKey,
          'SET metadata.gatewayPidx = :pidx',
          { ':pidx': adapterResult.gatewaySessionId },
        );
      }

      return {
        paymentSessionId: sessionId,
        redirectUrl: adapterResult.redirectUrl,
        expiresAt: adapterResult.expiresAt || new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        method: adapterResult.method,
        ...(adapterResult.formData ? { formData: adapterResult.formData } : {}),
      };
    }

    // Fallback for gateways without adapters (e.g. future gateways)
    const callbackBase = process.env.PAYMENT_CALLBACK_URL || dto.returnUrl;
    return {
      paymentSessionId: sessionId,
      redirectUrl: `${callbackBase}?sessionId=${sessionId}&gateway=${dto.gateway}&amount=${dto.amount}`,
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      method: 'redirect' as const,
    };
  }

  /**
   * Verify a payment after gateway callback redirect.
   * Calls the gateway adapter to verify, then marks completed or failed.
   */
  async verifyPayment(
    sessionId: string,
    callbackData: Record<string, string>,
    context: RequestContext,
  ): Promise<VerifyPaymentResponse> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Find the payment by gateway session ID
    const result = await this.dynamoDBClient.query<PaymentEntity>(
      client,
      context.tenantId,
      'PAYMENT',
      'gatewaySessionId = :sessionId',
      { ':sessionId': sessionId },
    );

    if (result.items.length === 0) {
      throw new NotFoundException(`Payment session ${sessionId} not found`);
    }

    const payment = result.items[0];

    // If already completed/failed, return current state (idempotent)
    if (payment.status !== 'pending') {
      const paymentDto = paymentEntityToDto(payment);
      const invoice = await this.invoicesService.get(payment.schoolId, payment.invoiceId, context);
      return {
        payment: paymentDto,
        invoice: {
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          status: invoice.status,
          amountDue: invoice.amountDue,
          grandTotal: invoice.grandTotal,
        },
        receipt: payment.status === 'completed'
          ? await this.getReceipt(payment.schoolId, payment.paymentId, context)
          : null,
        status: payment.status as 'completed' | 'failed' | 'cancelled',
      };
    }

    // Call gateway adapter for real verification
    if (this.gatewayRegistry.hasAdapter(payment.gateway)) {
      const gatewayConfig = await this.gatewayConfigService.getEntity(
        payment.schoolId,
        payment.gateway,
        context,
      );
      const adapter = this.gatewayRegistry.getAdapter(payment.gateway);

      let verifyResult: GatewayVerifyResult;
      try {
        verifyResult = await adapter.verifyPayment(
          { transactionId: sessionId, amount: payment.amount, callbackData },
          gatewayConfig,
        );
      } catch (error: any) {
        this.logger.error(`Gateway verification error for ${sessionId}: ${error.message}`);
        verifyResult = {
          success: false,
          status: 'failed',
          failureReason: `Gateway error: ${error.message}`,
        };
      }

      if (verifyResult.success) {
        return this.completePayment(payment, verifyResult.gatewayTransactionId, context);
      } else if (verifyResult.status === 'pending') {
        // Still pending at gateway — return current state without updating
        const paymentDto = paymentEntityToDto(payment);
        const invoice = await this.invoicesService.get(payment.schoolId, payment.invoiceId, context);
        return {
          payment: paymentDto,
          invoice: {
            id: invoice.id,
            invoiceNumber: invoice.invoiceNumber,
            status: invoice.status,
            amountDue: invoice.amountDue,
            grandTotal: invoice.grandTotal,
          },
          receipt: null,
          status: 'failed', // report as failed for now; frontend can retry
        };
      } else {
        return this.failPayment(payment, verifyResult.failureReason, context);
      }
    }

    // Fallback: auto-complete for gateways without adapters
    return this.completePayment(payment, undefined, context);
  }

  /**
   * Mark a pending payment as completed, apply to invoice, record ledger.
   */
  private async completePayment(
    payment: PaymentEntity,
    gatewayTransactionId: string | undefined,
    context: RequestContext,
  ): Promise<VerifyPaymentResponse> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();
    const receiptNumber = await this.sequenceService.nextReceiptNumber(
      client,
      context.tenantId,
      payment.schoolId,
    );

    let updateExpr = 'SET #status = :newStatus, paidAt = :now, receiptNumber = :receipt, updatedAt = :now, #v = #v + :one, gsi1sk = :newGsi1sk';
    const exprValues: Record<string, any> = {
      ':newStatus': 'completed',
      ':now': now,
      ':receipt': receiptNumber,
      ':one': 1,
      ':currentVersion': payment.version,
      ':newGsi1sk': GSIKeyBuilder.entitySort('PAYMENT', `completed#${now}`),
    };

    if (gatewayTransactionId) {
      updateExpr += ', gatewayTransactionId = :gtxId';
      exprValues[':gtxId'] = gatewayTransactionId;
    }

    const updated = await this.dynamoDBClient.updateItem<PaymentEntity>(
      client,
      context.tenantId,
      payment.entityKey,
      updateExpr,
      exprValues,
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );

    // Apply payment to invoice
    await this.invoicesService.applyPayment(
      payment.schoolId,
      payment.invoiceId,
      payment.amount,
      context,
    );

    // Record ledger entry
    const accountKey = EntityKeyBuilder.billingAccount(payment.schoolId, payment.studentId);
    const account = await this.dynamoDBClient.getItem<any>(client, context.tenantId, accountKey);
    if (account) {
      await this.studentAccountsService.recordLedgerEntry(
        account,
        'payment',
        payment.paymentId,
        `Payment ${receiptNumber} via ${payment.gateway}`,
        0,
        payment.amount,
        context,
      );
    }

    // Publish event
    this.eventsService.publishPaymentCompleted(
      context.tenantId,
      payment.schoolId,
      payment.paymentId,
      payment.invoiceId,
      payment.amount,
      payment.gateway,
    ).catch(err => this.logger.error(`Failed to publish PaymentCompleted: ${err.message}`));

    const paymentDto = paymentEntityToDto(updated);
    const invoice = await this.invoicesService.get(payment.schoolId, payment.invoiceId, context);

    return {
      payment: paymentDto,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        amountDue: invoice.amountDue,
        grandTotal: invoice.grandTotal,
      },
      receipt: await this.getReceipt(payment.schoolId, payment.paymentId, context),
      status: 'completed',
    };
  }

  /**
   * Mark a pending payment as failed.
   */
  private async failPayment(
    payment: PaymentEntity,
    reason: string | undefined,
    context: RequestContext,
  ): Promise<VerifyPaymentResponse> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const now = new Date().toISOString();

    await this.dynamoDBClient.updateItem<PaymentEntity>(
      client,
      context.tenantId,
      payment.entityKey,
      'SET #status = :newStatus, updatedAt = :now, metadata.failureReason = :reason, #v = #v + :one',
      {
        ':newStatus': 'failed',
        ':now': now,
        ':reason': reason || 'Payment verification failed',
        ':one': 1,
        ':currentVersion': payment.version,
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );

    const paymentDto = paymentEntityToDto({ ...payment, status: 'failed' });
    const invoice = await this.invoicesService.get(payment.schoolId, payment.invoiceId, context);

    return {
      payment: paymentDto,
      invoice: {
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        amountDue: invoice.amountDue,
        grandTotal: invoice.grandTotal,
      },
      receipt: null,
      status: 'failed',
    };
  }

  async voidPayment(
    schoolId: string,
    paymentId: string,
    reason: string,
    context: RequestContext,
  ): Promise<Payment> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.payment(schoolId, paymentId);

    const existing = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) throw new NotFoundException(`Payment ${paymentId} not found`);

    if (existing.status !== 'completed') {
      throw new BadRequestException(`Cannot void a ${existing.status} payment`);
    }

    const updated = await this.dynamoDBClient.updateItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
      'SET #status = :newStatus, updatedAt = :now, metadata.voidReason = :reason, #v = #v + :one',
      {
        ':newStatus': 'cancelled',
        ':now': new Date().toISOString(),
        ':reason': reason,
        ':one': 1,
        ':currentVersion': existing.version,
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );

    return paymentEntityToDto(updated);
  }

  async refund(
    schoolId: string,
    paymentId: string,
    dto: CreateRefundDto,
    context: RequestContext,
  ): Promise<Payment> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.payment(schoolId, paymentId);

    const existing = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) throw new NotFoundException(`Payment ${paymentId} not found`);

    if (existing.status !== 'completed' && existing.status !== 'partially_refunded') {
      throw new BadRequestException(`Cannot refund a ${existing.status} payment`);
    }

    const totalRefunded = existing.refunds.reduce((sum, r) => sum + (r.status === 'completed' ? r.amount : 0), 0);
    if (totalRefunded + dto.amount > existing.amount) {
      throw new BadRequestException(
        `Refund amount (${dto.amount}) exceeds refundable amount (${existing.amount - totalRefunded})`,
      );
    }

    const refund: RefundData = {
      id: uuid(),
      paymentId: existing.paymentId,
      amount: dto.amount,
      reason: dto.reason,
      status: 'completed',
      refundedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };

    const newRefunds = [...existing.refunds, refund];
    const newTotalRefunded = totalRefunded + dto.amount;
    const newStatus = newTotalRefunded >= existing.amount ? 'refunded' : 'partially_refunded';

    const updated = await this.dynamoDBClient.updateItem<PaymentEntity>(
      client,
      context.tenantId,
      entityKey,
      'SET #status = :newStatus, refunds = :refunds, updatedAt = :now, #v = #v + :one',
      {
        ':newStatus': newStatus,
        ':refunds': newRefunds,
        ':now': new Date().toISOString(),
        ':one': 1,
        ':currentVersion': existing.version,
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );

    // Record refund ledger entry
    const accountKey = EntityKeyBuilder.billingAccount(schoolId, existing.studentId);
    const account = await this.dynamoDBClient.getItem<any>(client, context.tenantId, accountKey);
    if (account) {
      await this.studentAccountsService.recordLedgerEntry(
        account,
        'refund',
        refund.id,
        `Refund for payment ${existing.receiptNumber}: ${dto.reason}`,
        dto.amount,
        0,
        context,
      );
    }

    this.eventsService.publishRefundProcessed(
      context.tenantId,
      schoolId,
      paymentId,
      refund.id,
      dto.amount,
    ).catch(err => this.logger.error(`Failed to publish RefundProcessed: ${err.message}`));

    return paymentEntityToDto(updated);
  }

  private async findByIdempotencyKey(
    schoolId: string,
    idempotencyKey: string,
    context: RequestContext,
  ): Promise<PaymentEntity | null> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const result = await this.dynamoDBClient.queryGSI<PaymentEntity>(
      client,
      'GSI1',
      gsi1pk,
      'PAYMENT',
      'begins_with',
      'idempotencyKey = :idempKey',
      { ':idempKey': idempotencyKey },
      undefined,
      1,
    );

    return result.items.length > 0 ? result.items[0] : null;
  }
}
