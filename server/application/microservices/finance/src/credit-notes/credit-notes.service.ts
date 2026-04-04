import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { CreditNoteEntity, createCreditNoteEntity } from '../common/entities/credit-note.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext, decodeCursor } from '../common/entities/base.entity';
import { creditNoteEntityToDto } from '../common/mappers/credit-note.mapper';
import { AuditLoggerService, AuditAction } from '@app/logger';
import type { CreditNote, CreateCreditNoteDto, ApplyCreditNoteDto } from '@aibrains/shared-types';

@Injectable()
export class CreditNotesService {
  private readonly logger = new Logger(CreditNotesService.name);
  private readonly auditLogger = new AuditLoggerService('finance-service');

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
  ) {}

  async create(
    schoolId: string,
    dto: CreateCreditNoteDto,
    context: RequestContext,
  ): Promise<CreditNote> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Verify the student's billing account exists
    const billingAccountKey = EntityKeyBuilder.billingAccount(schoolId, dto.studentId);
    const billingAccount = await this.dynamoDBClient.getItem(
      client,
      context.tenantId,
      billingAccountKey,
    );
    if (!billingAccount) {
      throw new NotFoundException(`Billing account for student ${dto.studentId} not found in school ${schoolId}`);
    }

    const entity = createCreditNoteEntity(
      context.tenantId,
      schoolId,
      {
        studentAccountId: (billingAccount as any).studentAccountId || billingAccountKey,
        studentId: dto.studentId,
        amount: dto.amount,
        currency: dto.currency,
        type: dto.type,
        description: dto.description,
        fundingSource: dto.fundingSource,
        effectiveDate: dto.effectiveDate,
        expiryDate: dto.expiryDate,
      },
      context.userId,
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.auditLogger.log(
      AuditAction.CREDIT_NOTE_CREATED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'CREDIT_NOTE', id: entity.creditNoteId, name: entity.description },
      { schoolId, studentId: dto.studentId, amount: entity.amount, type: entity.type },
    );

    return creditNoteEntityToDto(entity);
  }

  async list(
    schoolId: string,
    context: RequestContext,
    options: {
      status?: string;
      type?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<{ items: CreditNote[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    // Build filter expression
    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};

    if (options.status) {
      filterParts.push('#st = :status');
      filterValues[':status'] = options.status;
    }
    if (options.type) {
      filterParts.push('#tp = :type');
      filterValues[':type'] = options.type;
    }

    const result = await this.dynamoDBClient.queryGSI<CreditNoteEntity>(
      client,
      'GSI1',
      gsi1pk,
      'CREDIT_NOTE',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      // Expression attribute names to avoid reserved-word collisions
      filterParts.length > 0
        ? {
            ...(options.status ? { '#st': 'status' } : {}),
            ...(options.type ? { '#tp': 'type' } : {}),
          }
        : undefined,
      options.limit || 50,
      true,
      decodeCursor(options.cursor),
    );

    return {
      items: result.items.map(creditNoteEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async get(
    schoolId: string,
    creditNoteId: string,
    context: RequestContext,
  ): Promise<CreditNote> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.creditNote(schoolId, creditNoteId);

    const entity = await this.dynamoDBClient.getItem<CreditNoteEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!entity) {
      throw new NotFoundException(`Credit note ${creditNoteId} not found`);
    }

    return creditNoteEntityToDto(entity);
  }

  async getByStudent(
    studentId: string,
    context: RequestContext,
  ): Promise<{ items: CreditNote[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi2pk = GSIKeyBuilder.studentScope(context.tenantId, studentId);

    const result = await this.dynamoDBClient.queryGSI<CreditNoteEntity>(
      client,
      'GSI2',
      gsi2pk,
      'CREDIT_NOTE',
      'begins_with',
    );

    return {
      items: result.items.map(creditNoteEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async apply(
    schoolId: string,
    creditNoteId: string,
    dto: ApplyCreditNoteDto,
    context: RequestContext,
  ): Promise<CreditNote> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.creditNote(schoolId, creditNoteId);

    const entity = await this.dynamoDBClient.getItem<CreditNoteEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!entity) {
      throw new NotFoundException(`Credit note ${creditNoteId} not found`);
    }

    if (entity.status !== 'active') {
      throw new BadRequestException(`Credit note is not active (current status: ${entity.status})`);
    }

    // Check expiry date
    if (entity.expiryDate && new Date(entity.expiryDate) < new Date()) {
      throw new BadRequestException(`Credit note has expired (expiry: ${entity.expiryDate})`);
    }

    if (entity.remainingAmount < dto.amount) {
      throw new BadRequestException(
        `Insufficient credit: remaining ${entity.remainingAmount}, requested ${dto.amount}`,
      );
    }

    // Verify the target invoice exists
    const invoiceKey = EntityKeyBuilder.invoice(schoolId, dto.invoiceId);
    const invoice = await this.dynamoDBClient.getItem(
      client,
      context.tenantId,
      invoiceKey,
    );
    if (!invoice) {
      throw new NotFoundException(`Invoice ${dto.invoiceId} not found`);
    }

    const newRemainingAmount = entity.remainingAmount - dto.amount;
    const newStatus = newRemainingAmount === 0 ? 'applied' : 'active';
    const now = new Date().toISOString();

    const application = {
      invoiceId: dto.invoiceId,
      amount: dto.amount,
      appliedAt: now,
    };

    const updatedAppliedToInvoices = [...entity.appliedToInvoices, application];

    // Atomic transaction: update credit note AND reduce invoice amountDue
    const tableName = this.dynamoDBClient.getTableName();
    await this.dynamoDBClient.transactWrite(client, [
      {
        Update: {
          TableName: tableName,
          Key: { tenantId: context.tenantId, entityKey },
          UpdateExpression:
            'SET remainingAmount = :remaining, #st = :status, appliedToInvoices = :applied, ' +
            'gsi1sk = :gsi1sk, updatedAt = :now, updatedBy = :userId, #v = #v + :one',
          ConditionExpression: '#v = :currentVersion AND remainingAmount >= :applyAmount AND #st = :expectedStatus',
          ExpressionAttributeNames: { '#v': 'version', '#st': 'status' },
          ExpressionAttributeValues: {
            ':remaining': newRemainingAmount,
            ':status': newStatus,
            ':applied': updatedAppliedToInvoices,
            ':gsi1sk': `CREDIT_NOTE#${newStatus}#${entity.effectiveDate}`,
            ':now': now,
            ':userId': context.userId,
            ':one': 1,
            ':currentVersion': entity.version,
            ':applyAmount': dto.amount,
            ':expectedStatus': 'active',
          },
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: { tenantId: context.tenantId, entityKey: invoiceKey },
          UpdateExpression: 'SET amountDue = amountDue - :creditAmount, updatedAt = :now',
          ExpressionAttributeValues: {
            ':creditAmount': dto.amount,
            ':now': now,
          },
        },
      },
    ]);

    this.auditLogger.log(
      AuditAction.CREDIT_NOTE_APPLIED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'CREDIT_NOTE', id: creditNoteId },
      { schoolId, invoiceId: dto.invoiceId, amount: dto.amount, newStatus, remainingAmount: newRemainingAmount },
    );

    return creditNoteEntityToDto({
      ...entity,
      remainingAmount: newRemainingAmount,
      status: newStatus as any,
      appliedToInvoices: updatedAppliedToInvoices,
      gsi1sk: `CREDIT_NOTE#${newStatus}#${entity.effectiveDate}`,
      updatedAt: now,
      updatedBy: context.userId,
      version: entity.version + 1,
    });
  }

  async cancel(
    schoolId: string,
    creditNoteId: string,
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.creditNote(schoolId, creditNoteId);

    const entity = await this.dynamoDBClient.getItem<CreditNoteEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!entity) {
      throw new NotFoundException(`Credit note ${creditNoteId} not found`);
    }

    if (entity.status !== 'active') {
      throw new BadRequestException(`Cannot cancel credit note with status: ${entity.status}`);
    }

    const now = new Date().toISOString();

    await this.dynamoDBClient.updateItem<CreditNoteEntity>(
      client,
      context.tenantId,
      entityKey,
      'SET #st = :status, gsi1sk = :gsi1sk, updatedAt = :now, updatedBy = :userId, #v = #v + :one',
      {
        ':status': 'cancelled',
        ':gsi1sk': `CREDIT_NOTE#cancelled#${entity.effectiveDate}`,
        ':now': now,
        ':userId': context.userId,
        ':one': 1,
        ':currentVersion': entity.version,
      },
      '#v = :currentVersion',
      { '#v': 'version', '#st': 'status' },
    );

    this.auditLogger.log(
      AuditAction.CREDIT_NOTE_CANCELLED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'CREDIT_NOTE', id: creditNoteId },
      { schoolId, previousStatus: entity.status, newStatus: 'cancelled' },
    );
  }
}
