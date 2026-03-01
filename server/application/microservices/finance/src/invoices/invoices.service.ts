import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { SequenceService } from '../common/services/sequence.service';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import {
  InvoiceEntity,
  InvoiceLineItemData,
  createInvoiceEntity,
} from '../common/entities/invoice.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext, decodeCursor } from '../common/entities/base.entity';
import { invoiceEntityToDto } from '../common/mappers/invoice.mapper';
import type { Invoice, GenerateInvoiceDto, UpdateInvoiceDto } from '@aibrains/shared-types';

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
    private readonly identityClient: IdentityClientService,
    private readonly sequenceService: SequenceService,
    private readonly feeStructuresService: FeeStructuresService,
    private readonly studentAccountsService: StudentAccountsService,
  ) {}

  async generate(
    schoolId: string,
    dto: GenerateInvoiceDto,
    context: RequestContext,
  ): Promise<Invoice> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Fetch fee structures
    const feeStructures = await this.feeStructuresService.getByIds(
      schoolId,
      dto.feeStructureIds,
      context,
    );

    if (feeStructures.length !== dto.feeStructureIds.length) {
      const foundIds = new Set(feeStructures.map(f => f.feeStructureId));
      const missing = dto.feeStructureIds.filter(id => !foundIds.has(id));
      throw new NotFoundException(`Fee structures not found: ${missing.join(', ')}`);
    }

    // 2. Build discount map
    const discountMap = new Map<string, { amount: number; reason?: string }>();
    if (dto.discounts) {
      for (const d of dto.discounts) {
        discountMap.set(d.feeStructureId, { amount: d.amount, reason: d.reason });
      }
    }

    // 3. Calculate line items
    const lineItems: InvoiceLineItemData[] = feeStructures.map(fs => {
      const discount = discountMap.get(fs.feeStructureId);
      const discountAmt = discount?.amount ?? 0;
      const quantity = 1;
      const subtotal = fs.amount * quantity;
      const afterDiscount = subtotal - discountAmt;
      const taxAmount = afterDiscount > 0 ? Math.round(afterDiscount * fs.taxRate) / 100 : 0;
      const total = afterDiscount + taxAmount;

      return {
        id: uuid(),
        feeStructureId: fs.feeStructureId,
        description: fs.name,
        amount: fs.amount,
        quantity,
        discount: discountAmt,
        discountReason: discount?.reason,
        taxRate: fs.taxRate,
        taxAmount: Math.round(taxAmount * 100) / 100,
        total: Math.round(total * 100) / 100,
      };
    });

    // 4. Calculate totals
    const subtotal = lineItems.reduce((sum, li) => sum + li.amount * li.quantity, 0);
    const discountTotal = lineItems.reduce((sum, li) => sum + li.discount, 0);
    const taxTotal = lineItems.reduce((sum, li) => sum + li.taxAmount, 0);
    const grandTotal = lineItems.reduce((sum, li) => sum + li.total, 0);

    // 5. Resolve student account
    const account = await this.studentAccountsService.getOrCreate(
      schoolId,
      dto.studentAccountId,
      '', // Will be resolved from account if existing
      context,
    );

    // 6. Get school name from identity service
    let schoolName = schoolId;
    try {
      const resolvedName = await this.identityClient.getSchoolName(schoolId, context);
      if (resolvedName) schoolName = resolvedName;
    } catch { /* use schoolId as fallback */ }

    // 7. Generate invoice number
    const invoiceNumber = await this.sequenceService.nextInvoiceNumber(
      client,
      context.tenantId,
      schoolId,
    );

    const now = new Date().toISOString();
    const issuedDate = now.split('T')[0];

    // 8. Create invoice entity (starts as draft)
    const entity = createInvoiceEntity(
      context.tenantId,
      schoolId,
      {
        invoiceNumber,
        studentAccountId: account.accountId,
        studentId: account.studentId,
        studentName: account.studentName,
        schoolName,
        academicYear: dto.academicYear,
        billingPeriod: dto.billingPeriod,
        lineItems,
        subtotal: Math.round(subtotal * 100) / 100,
        taxTotal: Math.round(taxTotal * 100) / 100,
        discountTotal: Math.round(discountTotal * 100) / 100,
        grandTotal: Math.round(grandTotal * 100) / 100,
        dueDate: dto.dueDate,
        issuedDate,
        status: 'draft',
        notes: dto.notes,
      },
      context.userId,
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.eventsService.publishInvoiceGenerated(
      context.tenantId,
      schoolId,
      entity.invoiceId,
      invoiceNumber,
      account.studentId,
      entity.grandTotal,
    ).catch(err => this.logger.error(`Failed to publish InvoiceGenerated: ${err.message}`));

    return invoiceEntityToDto(entity);
  }

  async list(
    schoolId: string,
    context: RequestContext,
    options: {
      status?: string;
      studentId?: string;
      academicYear?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<{ items: Invoice[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // If studentId provided, query GSI2 for student-scoped invoices
    if (options.studentId) {
      const gsi2pk = GSIKeyBuilder.studentScope(context.tenantId, options.studentId);
      const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
        client,
        'GSI2',
        gsi2pk,
        'INVOICE',
        'begins_with',
        undefined,
        undefined,
        undefined,
        options.limit || 50,
        false, // newest first
        decodeCursor(options.cursor),
      );

      return {
        items: result.items.map(invoiceEntityToDto),
        lastEvaluatedKey: result.lastEvaluatedKey,
        hasMore: result.hasMore,
      };
    }

    // Otherwise query GSI1 for school-scoped invoices
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};

    if (options.status) {
      filterParts.push('#status = :status');
      filterValues[':status'] = options.status;
    }
    if (options.academicYear) {
      filterParts.push('academicYear = :academicYear');
      filterValues[':academicYear'] = options.academicYear;
    }

    const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
      client,
      'GSI1',
      gsi1pk,
      'INVOICE',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      filterParts.some(p => p.includes('#status')) ? { '#status': 'status' } : undefined,
      options.limit || 50,
      false,
      decodeCursor(options.cursor),
    );

    return {
      items: result.items.map(invoiceEntityToDto),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async get(
    schoolId: string,
    invoiceId: string,
    context: RequestContext,
  ): Promise<Invoice> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.invoice(schoolId, invoiceId);

    const entity = await this.dynamoDBClient.getItem<InvoiceEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!entity) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    return invoiceEntityToDto(entity);
  }

  async getEntity(
    schoolId: string,
    invoiceId: string,
    context: RequestContext,
  ): Promise<InvoiceEntity> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.invoice(schoolId, invoiceId);

    const entity = await this.dynamoDBClient.getItem<InvoiceEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (!entity) throw new NotFoundException(`Invoice ${invoiceId} not found`);
    return entity;
  }

  async update(
    schoolId: string,
    invoiceId: string,
    dto: UpdateInvoiceDto,
    context: RequestContext,
  ): Promise<Invoice> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.invoice(schoolId, invoiceId);

    const existing = await this.dynamoDBClient.getItem<InvoiceEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!existing) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    // Validate status transitions
    if (dto.status) {
      this.validateStatusTransition(existing.status, dto.status);
    }

    const setParts: string[] = ['updatedAt = :updatedAt', 'updatedBy = :updatedBy', '#v = #v + :one'];
    const exprValues: Record<string, any> = {
      ':updatedAt': new Date().toISOString(),
      ':updatedBy': context.userId,
      ':one': 1,
      ':currentVersion': existing.version,
    };
    const exprNames: Record<string, string> = { '#v': 'version' };

    if (dto.status) {
      setParts.push('#status = :newStatus');
      exprValues[':newStatus'] = dto.status;
      exprNames['#status'] = 'status';

      // Update GSI1SK with new status
      setParts.push('gsi1sk = :gsi1sk');
      exprValues[':gsi1sk'] = GSIKeyBuilder.entitySort('INVOICE', `${dto.status}#${existing.dueDate}`);
    }
    if (dto.notes !== undefined) {
      setParts.push('notes = :notes');
      exprValues[':notes'] = dto.notes;
    }
    if (dto.dueDate) {
      setParts.push('dueDate = :dueDate');
      exprValues[':dueDate'] = dto.dueDate;
    }

    const updated = await this.dynamoDBClient.updateItem<InvoiceEntity>(
      client,
      context.tenantId,
      entityKey,
      `SET ${setParts.join(', ')}`,
      exprValues,
      '#v = :currentVersion',
      exprNames,
    );

    if (dto.status) {
      this.eventsService.publishInvoiceStatusChanged(
        context.tenantId,
        schoolId,
        invoiceId,
        existing.status,
        dto.status,
      ).catch(err => this.logger.error(`Failed to publish InvoiceStatusChanged: ${err.message}`));
    }

    return invoiceEntityToDto(updated);
  }

  /**
   * Issue a draft invoice — transitions to 'issued' and posts to ledger.
   */
  async issue(
    schoolId: string,
    invoiceId: string,
    context: RequestContext,
  ): Promise<Invoice> {
    const entity = await this.getEntity(schoolId, invoiceId, context);

    if (entity.status !== 'draft') {
      throw new BadRequestException(`Cannot issue invoice in '${entity.status}' status. Only draft invoices can be issued.`);
    }

    // Update status to issued
    const updatedInvoice = await this.update(schoolId, invoiceId, { status: 'issued' }, context);

    // Post debit to student account ledger
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const accountKey = EntityKeyBuilder.billingAccount(schoolId, entity.studentId);
    const account = await this.dynamoDBClient.getItem<any>(client, context.tenantId, accountKey);

    if (account) {
      await this.studentAccountsService.recordLedgerEntry(
        account,
        'invoice',
        invoiceId,
        `Invoice ${entity.invoiceNumber} issued`,
        entity.grandTotal,
        0,
        context,
      );
    }

    return updatedInvoice;
  }

  /**
   * Apply payment to an invoice — updates amountPaid, amountDue, and status.
   * Only allows payments on invoices in payable statuses.
   */
  async applyPayment(
    schoolId: string,
    invoiceId: string,
    paymentAmount: number,
    context: RequestContext,
  ): Promise<InvoiceEntity> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.invoice(schoolId, invoiceId);

    const invoice = await this.dynamoDBClient.getItem<InvoiceEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    // Guard: only accept payments on payable invoices
    const payableStatuses = ['issued', 'partially_paid', 'overdue'];
    if (!payableStatuses.includes(invoice.status)) {
      throw new BadRequestException(
        `Cannot apply payment to invoice in '${invoice.status}' status. Invoice must be issued, partially_paid, or overdue.`,
      );
    }

    const newAmountPaid = invoice.amountPaid + paymentAmount;
    const newAmountDue = invoice.grandTotal - newAmountPaid;
    const newStatus = newAmountDue <= 0 ? 'paid' : 'partially_paid';

    const updated = await this.dynamoDBClient.updateItem<InvoiceEntity>(
      client,
      context.tenantId,
      entityKey,
      'SET amountPaid = :amountPaid, amountDue = :amountDue, #status = :newStatus, updatedAt = :now, gsi1sk = :gsi1sk, #v = #v + :one',
      {
        ':amountPaid': Math.round(newAmountPaid * 100) / 100,
        ':amountDue': Math.round(Math.max(0, newAmountDue) * 100) / 100,
        ':newStatus': newStatus,
        ':now': new Date().toISOString(),
        ':gsi1sk': GSIKeyBuilder.entitySort('INVOICE', `${newStatus}#${invoice.dueDate}`),
        ':one': 1,
        ':currentVersion': invoice.version,
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );

    return updated;
  }

  /**
   * Reverse a payment on an invoice — reduces amountPaid, increases amountDue.
   * Used when voiding or refunding a payment.
   */
  async reversePaymentOnInvoice(
    schoolId: string,
    invoiceId: string,
    reversalAmount: number,
    context: RequestContext,
  ): Promise<InvoiceEntity> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.invoice(schoolId, invoiceId);

    const invoice = await this.dynamoDBClient.getItem<InvoiceEntity>(
      client,
      context.tenantId,
      entityKey,
    );
    if (!invoice) throw new NotFoundException(`Invoice ${invoiceId} not found`);

    const newAmountPaid = Math.max(0, invoice.amountPaid - reversalAmount);
    const newAmountDue = Math.round((invoice.grandTotal - newAmountPaid) * 100) / 100;

    // Determine new status based on remaining payment
    let newStatus: string;
    if (newAmountPaid <= 0) {
      newStatus = 'issued';
    } else if (newAmountDue > 0) {
      newStatus = 'partially_paid';
    } else {
      newStatus = 'paid';
    }

    const updated = await this.dynamoDBClient.updateItem<InvoiceEntity>(
      client,
      context.tenantId,
      entityKey,
      'SET amountPaid = :amountPaid, amountDue = :amountDue, #status = :newStatus, updatedAt = :now, gsi1sk = :gsi1sk, #v = #v + :one',
      {
        ':amountPaid': Math.round(newAmountPaid * 100) / 100,
        ':amountDue': Math.round(Math.max(0, newAmountDue) * 100) / 100,
        ':newStatus': newStatus,
        ':now': new Date().toISOString(),
        ':gsi1sk': GSIKeyBuilder.entitySort('INVOICE', `${newStatus}#${invoice.dueDate}`),
        ':one': 1,
        ':currentVersion': invoice.version,
      },
      '#v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );

    return updated;
  }

  private validateStatusTransition(current: string, target: string): void {
    const allowed: Record<string, string[]> = {
      draft: ['issued', 'cancelled'],
      issued: ['partially_paid', 'paid', 'overdue', 'cancelled'],
      partially_paid: ['paid', 'overdue', 'cancelled'],
      overdue: ['partially_paid', 'paid', 'written_off', 'cancelled'],
      paid: [],
      cancelled: [],
      written_off: [],
    };

    if (!allowed[current]?.includes(target)) {
      throw new BadRequestException(
        `Cannot transition invoice from '${current}' to '${target}'. Allowed: ${(allowed[current] || []).join(', ') || 'none'}`,
      );
    }
  }
}
