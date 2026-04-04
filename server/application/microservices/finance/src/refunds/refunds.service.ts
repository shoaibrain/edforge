import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { RefundRequestEntity, RefundStatus, createRefundRequestEntity } from '../common/entities/refund-request.entity';
import { PaymentEntity } from '../common/entities/payment.entity';
import { createCreditNoteEntity } from '../common/entities/credit-note.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext, decodeCursor } from '../common/entities/base.entity';
import { refundRequestEntityToDto } from '../common/mappers/refund-request.mapper';
import { AuditLoggerService, AuditAction } from '@app/logger';
import type { RefundRequest, CreateRefundRequestDto } from '@aibrains/shared-types';

@Injectable()
export class RefundsService {
  private readonly logger = new Logger(RefundsService.name);
  private readonly auditLogger = new AuditLoggerService('finance-service');

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
  ) {}

  // ---------------------------------------------------------------------------
  // Status transition validation
  // ---------------------------------------------------------------------------

  private validateTransition(current: RefundStatus, target: RefundStatus): void {
    const allowed: Record<RefundStatus, RefundStatus[]> = {
      requested: ['pending_approval'],
      pending_approval: ['approved', 'rejected'],
      approved: ['processing'],
      processing: ['completed'],
      completed: [],
      rejected: [],
    };
    if (!allowed[current]?.includes(target)) {
      throw new BadRequestException(`Cannot transition from ${current} to ${target}`);
    }
  }

  // ---------------------------------------------------------------------------
  // CRUD
  // ---------------------------------------------------------------------------

  async create(
    schoolId: string,
    dto: CreateRefundRequestDto,
    context: RequestContext,
  ): Promise<RefundRequest> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Validate payment exists and amount is within bounds
    const paymentKey = EntityKeyBuilder.payment(schoolId, dto.paymentId);
    const payment = await this.dynamoDBClient.getItem<PaymentEntity>(
      client,
      context.tenantId,
      paymentKey,
    );
    if (!payment) {
      throw new NotFoundException(`Payment ${dto.paymentId} not found`);
    }
    if (dto.amount > payment.amount) {
      throw new BadRequestException(
        `Refund amount (${dto.amount}) exceeds payment amount (${payment.amount})`,
      );
    }

    const entity = createRefundRequestEntity(
      context.tenantId,
      schoolId,
      {
        paymentId: dto.paymentId,
        invoiceId: dto.invoiceId,
        studentId: payment.studentId,
        amount: dto.amount,
        currency: payment.currency,
        reason: dto.reason,
      },
      context.userId,
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.auditLogger.log(
      AuditAction.REFUND_REQUESTED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'REFUND_REQUEST', id: entity.refundId },
      { schoolId, paymentId: dto.paymentId, amount: dto.amount, reason: dto.reason },
    );

    return refundRequestEntityToDto(entity);
  }

  async list(
    schoolId: string,
    context: RequestContext,
    options: { status?: string; limit?: number; cursor?: string } = {},
  ): Promise<{ items: RefundRequest[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};

    if (options.status) {
      filterParts.push('#s = :status');
      filterValues[':status'] = options.status;
    }

    const filterExprNames: Record<string, string> | undefined = options.status
      ? { '#s': 'status' }
      : undefined;

    const result = await this.dynamoDBClient.queryGSI<RefundRequestEntity>(
      client,
      'GSI1',
      gsi1pk,
      'REFUND',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      filterExprNames,
      options.limit || 50,
      true,
      decodeCursor(options.cursor),
    );

    return {
      items: result.items.map(refundRequestEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async get(
    schoolId: string,
    refundId: string,
    context: RequestContext,
  ): Promise<RefundRequest> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.refundRequest(schoolId, refundId);

    const entity = await this.dynamoDBClient.getItem<RefundRequestEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!entity) {
      throw new NotFoundException(`Refund request ${refundId} not found`);
    }

    return refundRequestEntityToDto(entity);
  }

  // ---------------------------------------------------------------------------
  // Status transition helpers
  // ---------------------------------------------------------------------------

  private async getExistingEntity(
    client: any,
    tenantId: string,
    schoolId: string,
    refundId: string,
  ): Promise<RefundRequestEntity> {
    const entityKey = EntityKeyBuilder.refundRequest(schoolId, refundId);
    const entity = await this.dynamoDBClient.getItem<RefundRequestEntity>(
      client,
      tenantId,
      entityKey,
    );
    if (!entity) {
      throw new NotFoundException(`Refund request ${refundId} not found`);
    }
    return entity;
  }

  private async applyTransition(
    client: any,
    context: RequestContext,
    schoolId: string,
    existing: RefundRequestEntity,
    targetStatus: RefundStatus,
    extraFields: Record<string, any> = {},
  ): Promise<RefundRequest> {
    this.validateTransition(existing.status, targetStatus);

    const now = new Date().toISOString();
    const entityKey = EntityKeyBuilder.refundRequest(schoolId, existing.refundId);
    const setParts = ['#s = :newStatus', 'updatedAt = :now', 'updatedBy = :userId', 'gsi1sk = :gsi1sk', '#v = #v + :one'];
    const exprValues: Record<string, any> = {
      ':newStatus': targetStatus,
      ':now': now,
      ':userId': context.userId,
      ':gsi1sk': `REFUND#${targetStatus}#${existing.requestedAt}`,
      ':currentVersion': existing.version,
      ':expectedStatus': existing.status,
      ':one': 1,
    };
    const exprNames: Record<string, string> = { '#s': 'status', '#v': 'version' };

    for (const [key, value] of Object.entries(extraFields)) {
      const attr = `:${key}`;
      setParts.push(`${key} = ${attr}`);
      exprValues[attr] = value;
    }

    const updated = await this.dynamoDBClient.updateItem<RefundRequestEntity>(
      client,
      context.tenantId,
      entityKey,
      `SET ${setParts.join(', ')}`,
      exprValues,
      '#v = :currentVersion AND #s = :expectedStatus',
      exprNames,
    );

    return refundRequestEntityToDto(updated);
  }

  // ---------------------------------------------------------------------------
  // Workflow transitions
  // ---------------------------------------------------------------------------

  async approve(
    schoolId: string,
    refundId: string,
    context: RequestContext,
    notes?: string,
  ): Promise<RefundRequest> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.getExistingEntity(client, context.tenantId, schoolId, refundId);

    const extraFields: Record<string, any> = {
      approvedBy: context.userId,
      approvedAt: new Date().toISOString(),
    };
    if (notes) {
      extraFields.approvalNotes = notes;
    }

    const result = await this.applyTransition(client, context, schoolId, existing, 'approved', extraFields);

    this.auditLogger.log(
      AuditAction.REFUND_APPROVED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'REFUND_REQUEST', id: refundId },
      { schoolId, notes },
    );

    return result;
  }

  async reject(
    schoolId: string,
    refundId: string,
    reason: string,
    context: RequestContext,
  ): Promise<RefundRequest> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.getExistingEntity(client, context.tenantId, schoolId, refundId);

    const result = await this.applyTransition(client, context, schoolId, existing, 'rejected', {
      rejectedReason: reason,
    });

    this.auditLogger.log(
      AuditAction.REFUND_REJECTED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'REFUND_REQUEST', id: refundId },
      { schoolId, reason },
    );

    return result;
  }

  async process(
    schoolId: string,
    refundId: string,
    context: RequestContext,
  ): Promise<RefundRequest> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.getExistingEntity(client, context.tenantId, schoolId, refundId);

    return this.applyTransition(client, context, schoolId, existing, 'processing');
  }

  async complete(
    schoolId: string,
    refundId: string,
    gatewayRefundId: string | undefined,
    context: RequestContext,
  ): Promise<RefundRequest> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.getExistingEntity(client, context.tenantId, schoolId, refundId);

    const extraFields: Record<string, any> = {
      processedAt: new Date().toISOString(),
    };
    if (gatewayRefundId) {
      extraFields.gatewayRefundId = gatewayRefundId;
    }

    const result = await this.applyTransition(client, context, schoolId, existing, 'completed', extraFields);

    // Create a credit note automatically for the refunded amount
    const creditNoteEntity = createCreditNoteEntity(
      context.tenantId,
      schoolId,
      {
        studentAccountId: `${schoolId}#${existing.studentId}`,
        studentId: existing.studentId,
        amount: existing.amount,
        currency: existing.currency,
        type: 'refund',
        description: `Refund for payment ${existing.paymentId} — ${existing.reason}`,
        effectiveDate: new Date().toISOString(),
      },
      context.userId,
    );
    await this.dynamoDBClient.putItem(client, creditNoteEntity);

    this.eventsService.publishRefundProcessed(
      context.tenantId,
      schoolId,
      existing.paymentId,
      existing.refundId,
      existing.amount,
    ).catch(err => this.logger.error(`Failed to publish RefundProcessed: ${err.message}`));

    this.auditLogger.log(
      AuditAction.REFUND_COMPLETED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'REFUND_REQUEST', id: refundId },
      { schoolId, amount: existing.amount, gatewayRefundId, creditNoteId: creditNoteEntity.creditNoteId },
    );

    return result;
  }
}
