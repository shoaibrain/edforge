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

  /**
   * List invoices for specific students (used for parent/student scoping).
   * Queries GSI2 per student and merges results.
   */
  async listForStudents(
    schoolId: string,
    studentIds: string[],
    context: RequestContext,
    options: {
      status?: string;
      academicYear?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<{ items: Invoice[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const allItems: Invoice[] = [];

    for (const studentId of studentIds) {
      const gsi2pk = GSIKeyBuilder.studentScope(context.tenantId, studentId);

      const filterParts: string[] = [];
      const filterValues: Record<string, any> = {};
      const filterNames: Record<string, string> = {};

      if (options.status) {
        filterParts.push('#status = :status');
        filterValues[':status'] = options.status;
        filterNames['#status'] = 'status';
      }
      if (options.academicYear) {
        filterParts.push('academicYear = :academicYear');
        filterValues[':academicYear'] = options.academicYear;
      }

      const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
        client,
        'GSI2',
        gsi2pk,
        'INVOICE',
        'begins_with',
        filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
        Object.keys(filterValues).length > 0 ? filterValues : undefined,
        Object.keys(filterNames).length > 0 ? filterNames : undefined,
        options.limit || 50,
        false,
        decodeCursor(options.cursor),
      );

      allItems.push(...result.items.map(invoiceEntityToDto));
    }

    // Sort by createdAt descending and apply limit
    allItems.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const limit = options.limit || 50;
    const items = allItems.slice(0, limit);

    return {
      items,
      hasMore: allItems.length > limit,
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

  /**
   * Bulk generate invoices for a list of student accounts.
   * Uses Promise.allSettled with batched concurrency for throughput.
   * Skips students with existing active invoices for the same fee structures + billing period.
   */
  async generateBulk(
    schoolId: string,
    dto: {
      studentAccountIds: string[];
      feeStructureIds: string[];
      academicYear: string;
      billingPeriod?: string;
      dueDate: string;
      notes?: string;
    },
    context: RequestContext,
  ): Promise<{ generated: number; skipped: number; errors: string[] }> {
    const BATCH_SIZE = 10;
    let generated = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Fetch fee structures once (shared across all students)
    const feeStructures = await this.feeStructuresService.getByIds(
      schoolId,
      dto.feeStructureIds,
      context,
    );
    if (feeStructures.length === 0) {
      throw new BadRequestException('No valid fee structures found');
    }

    // Process students in batches
    for (let i = 0; i < dto.studentAccountIds.length; i += BATCH_SIZE) {
      const batch = dto.studentAccountIds.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (studentId) => {
          // Duplicate detection: check for existing active invoice with same fee structures + billing period
          const isDuplicate = await this.hasDuplicateInvoice(
            schoolId,
            studentId,
            dto.feeStructureIds,
            dto.billingPeriod,
            context,
          );
          if (isDuplicate) {
            return 'skipped';
          }

          // Generate invoice for this student
          await this.generate(
            schoolId,
            {
              studentAccountId: studentId,
              feeStructureIds: dto.feeStructureIds,
              academicYear: dto.academicYear,
              billingPeriod: dto.billingPeriod,
              dueDate: dto.dueDate,
              notes: dto.notes,
            },
            context,
          );
          return 'generated';
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          if (result.value === 'generated') generated++;
          else skipped++;
        } else {
          errors.push(result.reason?.message || 'Unknown error');
        }
      }
    }

    this.logger.log(
      `Bulk generation complete: ${generated} generated, ${skipped} skipped, ${errors.length} errors`,
    );
    return { generated, skipped, errors };
  }

  /**
   * Bulk issue draft invoices — transitions each to 'issued' and posts ledger entries.
   */
  async bulkIssue(
    schoolId: string,
    invoiceIds: string[],
    context: RequestContext,
  ): Promise<{ issued: number; failed: number; errors: string[] }> {
    let issued = 0;
    let failed = 0;
    const errors: string[] = [];

    const BATCH_SIZE = 10;
    for (let i = 0; i < invoiceIds.length; i += BATCH_SIZE) {
      const batch = invoiceIds.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (invoiceId) => {
          await this.issue(schoolId, invoiceId, context);
        }),
      );

      for (const result of results) {
        if (result.status === 'fulfilled') {
          issued++;
        } else {
          failed++;
          errors.push(result.reason?.message || 'Unknown error');
        }
      }
    }

    this.logger.log(
      `Bulk issue complete: ${issued} issued, ${failed} failed`,
    );
    return { issued, failed, errors };
  }

  /**
   * Stream all invoices as CSV for export.
   * Returns a Node.js Readable stream with CSV data.
   */
  async *streamInvoicesCsvRows(
    schoolId: string,
    context: RequestContext,
  ): AsyncGenerator<string> {
    // CSV header
    yield 'Invoice #,Student,Grand Total,Amount Paid,Amount Due,Status,Due Date,Issued Date\n';

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    let lastKey: Record<string, any> | undefined;
    let totalRows = 0;
    const MAX_ROWS = 10000;

    do {
      const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
        client,
        'GSI1',
        gsi1pk,
        'INVOICE',
        'begins_with',
        undefined,
        undefined,
        undefined,
        100, // Page size
        false,
        lastKey,
      );

      for (const entity of result.items) {
        if (totalRows >= MAX_ROWS) break;
        const escapeCsv = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;
        yield `${escapeCsv(entity.invoiceNumber)},${escapeCsv(entity.studentName)},${entity.grandTotal},${entity.amountPaid},${entity.amountDue},${escapeCsv(entity.status)},${escapeCsv(entity.dueDate)},${escapeCsv(entity.issuedDate)}\n`;
        totalRows++;
      }

      lastKey = result.lastEvaluatedKey ? JSON.parse(result.lastEvaluatedKey) : undefined;
    } while (lastKey && totalRows < MAX_ROWS);
  }

  /**
   * Check for duplicate invoice: same student + fee structures + billing period in active status.
   */
  private async hasDuplicateInvoice(
    _schoolId: string,
    studentId: string,
    feeStructureIds: string[],
    billingPeriod: string | undefined,
    context: RequestContext,
  ): Promise<boolean> {
    if (!billingPeriod) return false; // No billing period → no duplicate check

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi2pk = GSIKeyBuilder.studentScope(context.tenantId, studentId);

    const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
      client,
      'GSI2',
      gsi2pk,
      'INVOICE',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100,
      false,
    );

    const activeStatuses = new Set(['draft', 'issued', 'partially_paid', 'overdue']);

    return result.items.some(inv => {
      if (!activeStatuses.has(inv.status)) return false;
      if (inv.billingPeriod !== billingPeriod) return false;
      // Check if invoice covers the same fee structures
      const invFeeIds = new Set(inv.lineItems.map(li => li.feeStructureId));
      return feeStructureIds.every(id => invFeeIds.has(id));
    });
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
