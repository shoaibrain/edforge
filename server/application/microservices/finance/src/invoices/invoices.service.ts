import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { TenantSettingsService } from '../common/services/tenant-settings.service';
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
import { renderInvoiceToPdfBuffer } from './invoice-pdf.renderer';
import type {
  InvoiceTemplateConfig,
  Archetype as PdfArchetype,
} from '@aibrains/pdf-renderer';

/**
 * Derive a BCP-47 locale string from a template's `labelLanguages` tuple.
 * Defensive against drift at the JSON boundary — `templateConfig` comes
 * from identity as `Record<string, unknown>` and the cast above only buys
 * static-type safety, not runtime-shape safety. A malformed editor save
 * (future C.2.x) or shape drift would otherwise crash every PDF request
 * with a `Cannot read properties of undefined (reading '0')` 500.
 *
 * Rules:
 *   - Non-array OR empty → `'en-US'` (safest fallback; matches GENERIC
 *     descriptor default and the V1 formatCurrency locale for NPR).
 *   - Primary language `'ne'` → `'ne-NP'` (Nepal locale formats numbers
 *     in south-asian grouping when paired with `template.numberFormat`).
 *   - Otherwise → `'en-US'`.
 */
function resolvePrimaryLocale(labelLanguages: unknown): string {
  if (!Array.isArray(labelLanguages) || labelLanguages.length === 0) {
    return 'en-US';
  }
  return labelLanguages[0] === 'ne' ? 'ne-NP' : 'en-US';
}

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
    private readonly identityClient: IdentityClientService,
    private readonly tenantSettings: TenantSettingsService,
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

    // 1b. Validate grade level compatibility (skip if gradeLevel not provided — e.g. admin override)
    if (dto.gradeLevel) {
      for (const fs of feeStructures) {
        if (fs.gradeLevels.length > 0 && !fs.gradeLevels.includes(dto.gradeLevel)) {
          throw new BadRequestException(
            `Fee structure "${fs.name}" (${fs.feeStructureId}) is not applicable to grade ${dto.gradeLevel}. Valid grades: ${fs.gradeLevels.join(', ')}`,
          );
        }
      }
    }

    // 1c. Prevent duplicate one-time fee invoices (skip for enrollment-triggered invoices which use enrollmentId idempotency)
    if (!dto.enrollmentId) {
      const oneTimeFees = feeStructures.filter(fs => fs.frequency === 'one_time');
      if (oneTimeFees.length > 0 && dto.academicYear) {
        const existingInvoices = await this.listForStudents(
          schoolId, [dto.studentId], context, { academicYear: dto.academicYear, limit: 100 },
        );
        const existingFeeIds = new Set(
          existingInvoices.items.flatMap(inv =>
            (inv.lineItems || []).map((li: any) => li.feeStructureId).filter(Boolean),
          ),
        );
        const duplicateFees = oneTimeFees.filter(fs => existingFeeIds.has(fs.feeStructureId));
        if (duplicateFees.length > 0) {
          throw new BadRequestException(
            `Duplicate one-time fee(s) for this student and academic year: ${duplicateFees.map(f => `"${f.name}" (${f.feeStructureId})`).join(', ')}`,
          );
        }
      }
    }

    // 2. Build discount map
    const discountMap = new Map<string, { amount: number; reason?: string }>();
    if (dto.discounts) {
      for (const d of dto.discounts) {
        discountMap.set(d.feeStructureId, { amount: d.amount, reason: d.reason });
      }
    }

    // 3. Calculate line items (snapshot fee structure version for immutability)
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
        feeStructureVersion: fs.version,
        feeType: fs.feeType,
        description: fs.name,
        amount: fs.amount,
        quantity,
        discount: discountAmt,
        discountReason: discount?.reason,
        taxRate: fs.taxRate,
        taxType: fs.taxType,
        taxAmount: Math.round(taxAmount * 100) / 100,
        total: Math.round(total * 100) / 100,
      };
    });

    // 4. Calculate totals
    const subtotal = lineItems.reduce((sum, li) => sum + li.amount * li.quantity, 0);
    const discountTotal = lineItems.reduce((sum, li) => sum + li.discount, 0);
    const taxTotal = lineItems.reduce((sum, li) => sum + li.taxAmount, 0);
    const grandTotal = lineItems.reduce((sum, li) => sum + li.total, 0);

    // 4b. Compute tax summary grouped by tax type
    const taxGroups = new Map<string, { taxableAmount: number; taxRate: number; taxAmount: number }>();
    for (const li of lineItems) {
      const tt = li.taxType || 'none';
      const existing = taxGroups.get(tt) || { taxableAmount: 0, taxRate: li.taxRate, taxAmount: 0 };
      existing.taxableAmount += (li.amount * li.quantity) - li.discount;
      existing.taxAmount += li.taxAmount;
      taxGroups.set(tt, existing);
    }
    const taxSummary = Array.from(taxGroups.entries()).map(([taxType, data]) => ({
      taxType,
      taxableAmount: Math.round(data.taxableAmount * 100) / 100,
      taxRate: data.taxRate,
      taxAmount: Math.round(data.taxAmount * 100) / 100,
    }));

    // 5. Resolve student identity and validate existence
    const contextWithSchool = { ...context, schoolId };
    const studentInfo = await this.identityClient.getStudentInfo(dto.studentId, contextWithSchool);
    if (!studentInfo) {
      throw new NotFoundException(`Student not found: ${dto.studentId}`);
    }
    const resolvedStudentName = `${studentInfo.firstName} ${studentInfo.lastName}`.trim();

    // 5a. Sprint A.1 — snapshot gradeLevel at issue time.
    //
    // Resolution order:
    //   1. `dto.gradeLevel`        — admin override (set in fee-discount /
    //                                 mid-year correction flows). Wins.
    //   2. `studentInfo.gradeLevel`— default; capture the student's
    //                                 current grade now. Survives promotion.
    //   3. neither                 — undefined; mark `unresolved` so the
    //                                 listing UI can bucket it separately.
    //
    // The resolution status is the entity-side companion to gradeLevel:
    // `'resolved'` for paths 1 & 2; `'unresolved'` for path 3 (gradeLevel
    // stays undefined so it's sparse on the future GSI14 — Sprint A.3).
    const snapshotGradeLevel: string | undefined =
      dto.gradeLevel || studentInfo.gradeLevel || undefined;
    const gradeLevelResolutionStatus: 'resolved' | 'unresolved' =
      snapshotGradeLevel ? 'resolved' : 'unresolved';
    if (gradeLevelResolutionStatus === 'unresolved') {
      this.logger.warn(
        `generate: gradeLevel unresolved for studentId=${dto.studentId} ` +
          `schoolId=${schoolId} (dto + studentInfo both empty). ` +
          `Invoice will be issued with no gradeLevel snapshot; operator can ` +
          `surface it via the "Unknown" filter bucket.`,
      );
    }

    // 6. Resolve student account
    const account = await this.studentAccountsService.getOrCreate(
      schoolId,
      dto.studentId,
      resolvedStudentName,
      context,
    );

    // 7. Get school name from identity service
    let schoolName = schoolId;
    try {
      const resolvedName = await this.identityClient.getSchoolName(schoolId, context);
      if (resolvedName) schoolName = resolvedName;
    } catch { /* use schoolId as fallback */ }

    // 8. Generate invoice number
    const invoiceNumber = await this.sequenceService.nextInvoiceNumber(
      client,
      context.tenantId,
      schoolId,
    );

    const now = new Date().toISOString();
    const issuedDate = dto.issuedDate || now.split('T')[0];
    const shouldAutoIssue = dto.autoIssue === true;
    const status = shouldAutoIssue ? 'issued' : 'draft';

    // 8a. Resolve tenant currency (Sprint C2.T1).
    // Cached per-tenant 5min in TenantSettingsService — bulk-generate paths
    // pay one HTTP hop, not N.
    const currency = await this.tenantSettings.getCurrency(context);

    // 9. Create invoice entity
    const entity = createInvoiceEntity(
      context.tenantId,
      schoolId,
      {
        invoiceNumber,
        studentAccountId: account.accountId,
        studentId: account.studentId,
        studentName: resolvedStudentName,
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
        status,
        notes: dto.notes,
        taxSummary,
        enrollmentId: dto.enrollmentId,
        gradeLevel: snapshotGradeLevel,
        gradeLevelResolutionStatus,
        statusHistory: shouldAutoIssue
          ? [{ from: 'draft', to: 'issued', changedAt: now, changedBy: context.userId }]
          : [],
        currency,
      },
      context.userId,
    );

    await this.dynamoDBClient.putItem(client, entity);

    // If auto-issued, create ledger debit entry inline
    if (shouldAutoIssue) {
      const accountKey = EntityKeyBuilder.billingAccount(schoolId, account.studentId);
      const billingAccount = await this.dynamoDBClient.getItem<any>(client, context.tenantId, accountKey);
      if (billingAccount) {
        await this.studentAccountsService.recordLedgerEntry(
          billingAccount,
          'invoice',
          entity.invoiceId,
          `Invoice ${invoiceNumber} auto-issued on enrollment`,
          entity.grandTotal,
          0,
          context,
        );
      }
    }

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

  /**
   * Render the invoice as a PDF buffer. Sprint C.1.5 — the **first
   * user-visible PDF in prod**.
   *
   * Orchestration only — every piece of rendering logic lives in
   * `renderInvoiceToPdfBuffer`. This method:
   *   1. Loads the persisted Invoice (404 if missing)
   *   2. Parallel-fetches branding + template config from identity
   *   3. Calls the pure renderer
   *   4. Emits a structured `pdf_generated` audit log entry (fire-and-forget;
   *      finance can't write directly to identity's AuditLog table, so V1
   *      uses CloudWatch structured logging — operators can grep + future
   *      analytics Lambda can consume). When `PDF_TIMING_ENABLED=true` is
   *      set on the task definition, the log line carries per-call stage
   *      timings: `stageDdbMs`, `stageBrandingMs`, `stageTemplateMs`,
   *      `stageIdentityWallMs` (the Promise.all wall-clock), `stageRenderMs`.
   *      Drives the Finance bulk-ops Sprint 0.1 latency spike; gated so it
   *      is off by default in prod per the locked sprint plan.
   *
   * Ownership enforcement happens at the CONTROLLER (mirror of the existing
   * `get` endpoint pattern — see invoices.controller.ts:148-149); this
   * service method assumes the caller has already gated access.
   *
   * `fallbackArchetype: 'PABSON'` is passed to `getCurrentTemplate` so that
   * if identity is mid-deploy and 5xx-ing, PABSON tenants still get the
   * dual-language / dual-date defaults rather than degrading to GENERIC.
   * This is the V1 conservative choice (most pilot tenants are PABSON);
   * future PR can switch to dynamic archetype lookup via Tenant metadata.
   */
  async getPdf(
    schoolId: string,
    invoiceId: string,
    context: RequestContext,
    options?: { fallbackArchetype?: PdfArchetype },
  ): Promise<Buffer> {
    const tStart = Date.now();
    const invoice = await this.getEntity(schoolId, invoiceId, context);
    const tAfterDdb = Date.now();

    // Parallel fetch: branding sub-document + template config.
    // Branding errors are swallowed → render with branding:null + no logo,
    // since a missing/erroring branding response shouldn't block PDF
    // generation. Template errors fall through to the C.1.4 5xx fallback
    // (descriptor.defaults) — same graceful-degradation principle.
    //
    // Sprint 0.1: each call is individually timed inside the Promise.all so
    // the spike can attribute latency to branding vs template specifically,
    // not just to the combined wall-clock. The two start timestamps are
    // captured at scheduling time (effectively the same instant as `tAfterDdb`
    // since `Promise.all` schedules both synchronously), and each call's
    // `.then` records its own duration when it resolves.
    const brandingStart = Date.now();
    const brandingPromise = this.identityClient
      .getBranding(schoolId, context)
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `getPdf: branding fetch failed schoolId=${schoolId} invoiceId=${invoiceId}: ` +
            `${message.slice(0, 200)} — rendering without branding`,
        );
        return { branding: null, urls: undefined };
      })
      .then((result) => ({ result, ms: Date.now() - brandingStart }));

    const templateStart = Date.now();
    const templatePromise = this.identityClient
      .getCurrentTemplate(schoolId, 'INVOICE', context, {
        fallbackArchetype: options?.fallbackArchetype ?? 'PABSON',
      })
      .then((result) => ({ result, ms: Date.now() - templateStart }));

    const [brandingTimed, templateTimed] = await Promise.all([
      brandingPromise,
      templatePromise,
    ]);
    const brandingResult = brandingTimed.result;
    const templateResponse = templateTimed.result;
    const tAfterIdentity = Date.now();

    // The InvoiceTemplateConfig shape is a structural subtype of
    // PdfTemplateConfig + extra fields; identity returns a Record<string,
    // unknown> over the wire. Cast at the boundary; the C.1.1 + C.1.3
    // contract guarantees the shape.
    const templateConfig = templateResponse.templateConfig as unknown as InvoiceTemplateConfig;

    const buffer = await renderInvoiceToPdfBuffer({
      invoice,
      branding: brandingResult.branding,
      urls: brandingResult.urls,
      templateConfig,
      // V1: derive locale from template's labelLanguages — primary language
      // wins. PABSON dual-language ['en', 'ne'] → 'en-US' (since en-US is
      // the format-locale used by formatCurrency for NPR). Future PR can
      // resolve to the tenant's WorkspaceSettings.defaultLocale.
      locale: resolvePrimaryLocale(templateConfig.labelLanguages),
    });
    const tAfterRender = Date.now();

    // Fire-and-forget structured audit log. CloudWatch metric filter +
    // alarm can target this string in ops; analytics Lambda can later
    // subscribe to log events. NOT a DDB audit row (cross-service writes
    // to identity's AuditLog table aren't part of the V1 architecture).
    //
    // Stage-level timings are gated behind PDF_TIMING_ENABLED so the
    // log shape stays identical to the pre-Sprint-0.1 audit line by
    // default — the spike flips the flag on dev-pabson-primary's task
    // definition, captures measurements, then flips it back.
    const timingEnabled = process.env.PDF_TIMING_ENABLED === 'true';
    this.logger.log(
      JSON.stringify({
        event: 'pdf_generated',
        docType: 'INVOICE',
        schoolId,
        invoiceId,
        invoiceNumber: invoice.invoiceNumber,
        userId: context.userId,
        tenantId: context.tenantId,
        sizeBytes: buffer.length,
        templateSource: templateResponse.source,
        templateId: templateResponse.templateId,
        durationMs: tAfterRender - tStart,
        ...(timingEnabled && {
          stageDdbMs: tAfterDdb - tStart,
          stageBrandingMs: brandingTimed.ms,
          stageTemplateMs: templateTimed.ms,
          stageIdentityWallMs: tAfterIdentity - tAfterDdb,
          stageRenderMs: tAfterRender - tAfterIdentity,
        }),
      }),
    );

    return buffer;
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

      // Append to statusHistory (backward-compatible with existing invoices lacking the field)
      setParts.push('statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :historyEntry)');
      exprValues[':emptyList'] = [];
      exprValues[':historyEntry'] = [{
        from: existing.status,
        to: dto.status,
        changedAt: new Date().toISOString(),
        changedBy: context.userId,
      }];
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
  /**
   * Sprint C2.B.T4 — build the apply-payment Update TransactItem WITHOUT
   * executing it. Lets `PaymentsService.recordManualPayment` and
   * `completePayment` fold the invoice update into a single
   * TransactWriteItems alongside the Payment Put + LedgerEntry Put +
   * BillingAccount Update — closing the BUG-F3 silent-failure window.
   *
   * Pre-Sprint C2.T4 the invoice status precondition was a read-time
   * guard (a TOCTOU window where status could change between the read
   * and the write). The transactional version below adds the status
   * check as a `ConditionExpression`, so concurrent state drift fails
   * the entire transaction loud and atomic.
   *
   * Caller passes the pre-fetched `invoice` so the build doesn't issue
   * its own GetItem (cheap; the caller already needs the invoice for
   * amount + currency validation upstream).
   */
  buildApplyPaymentTransactItem(
    invoice: InvoiceEntity,
    paymentAmount: number,
    context: RequestContext,
  ): {
    item: NonNullable<TransactWriteCommandInput['TransactItems']>[number];
    newStatus: InvoiceEntity['status'];
    newAmountPaid: number;
    newAmountDue: number;
  } {
    // Read-time guard for callers that want to fail fast with a 400 before
    // building the transaction (e.g. a status drift that's already visible
    // at GetItem time). The transaction itself ALSO carries the status as
    // a ConditionExpression so a concurrent change between this build and
    // the transactWrite still rejects atomically.
    const payableStatuses = ['issued', 'partially_paid', 'overdue'] as const;
    if (!payableStatuses.includes(invoice.status as typeof payableStatuses[number])) {
      throw new BadRequestException(
        `Cannot apply payment to invoice in '${invoice.status}' status. Invoice must be issued, partially_paid, or overdue.`,
      );
    }

    const newAmountPaid = Math.round((invoice.amountPaid + paymentAmount) * 100) / 100;
    const newAmountDue = Math.round(Math.max(0, invoice.grandTotal - newAmountPaid) * 100) / 100;
    const newStatus: InvoiceEntity['status'] = newAmountDue <= 0 ? 'paid' : 'partially_paid';
    const now = new Date().toISOString();

    return {
      item: {
        Update: {
          TableName: this.dynamoDBClient.getTableName(),
          Key: { tenantId: invoice.tenantId, entityKey: invoice.entityKey },
          UpdateExpression:
            'SET amountPaid = :amountPaid, amountDue = :amountDue, #status = :newStatus, updatedAt = :now, gsi1sk = :gsi1sk, #v = #v + :one, statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :historyEntry)',
          ExpressionAttributeValues: {
            ':amountPaid': newAmountPaid,
            ':amountDue': newAmountDue,
            ':newStatus': newStatus,
            ':now': now,
            ':gsi1sk': GSIKeyBuilder.entitySort('INVOICE', `${newStatus}#${invoice.dueDate}`),
            ':one': 1,
            ':currentVersion': invoice.version,
            ':emptyList': [],
            ':historyEntry': [
              { from: invoice.status, to: newStatus, changedAt: now, changedBy: context.userId },
            ],
            ':issued': 'issued',
            ':partially_paid': 'partially_paid',
            ':overdue': 'overdue',
          },
          ExpressionAttributeNames: { '#status': 'status', '#v': 'version' },
          ConditionExpression:
            '#v = :currentVersion AND #status IN (:issued, :partially_paid, :overdue)',
        },
      },
      newStatus,
      newAmountPaid,
      newAmountDue,
    };
  }

  /**
   * Standalone wrapper: apply a payment to an invoice (fetches + builds +
   * executes). Used by callers that don't fold into a larger transaction.
   *
   * After Sprint C2.B.T4 the canonical payment flow uses
   * `buildApplyPaymentTransactItem` directly so payment + invoice +
   * ledger + account writes all commit together. This wrapper remains for
   * any future caller (and for symmetry with `recordLedgerEntry`).
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

    const { item, newAmountPaid, newAmountDue, newStatus } = this.buildApplyPaymentTransactItem(
      invoice,
      paymentAmount,
      context,
    );
    await this.dynamoDBClient.transactWrite(client, [item]);

    // Re-fetch the post-update entity for the standalone caller's return value.
    return {
      ...invoice,
      amountPaid: newAmountPaid,
      amountDue: newAmountDue,
      status: newStatus,
      version: invoice.version + 1,
      updatedAt: new Date().toISOString(),
    };
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

    const now = new Date().toISOString();

    const updated = await this.dynamoDBClient.updateItem<InvoiceEntity>(
      client,
      context.tenantId,
      entityKey,
      'SET amountPaid = :amountPaid, amountDue = :amountDue, #status = :newStatus, updatedAt = :now, gsi1sk = :gsi1sk, #v = #v + :one, statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :historyEntry)',
      {
        ':amountPaid': Math.round(newAmountPaid * 100) / 100,
        ':amountDue': Math.round(Math.max(0, newAmountDue) * 100) / 100,
        ':newStatus': newStatus,
        ':now': now,
        ':gsi1sk': GSIKeyBuilder.entitySort('INVOICE', `${newStatus}#${invoice.dueDate}`),
        ':one': 1,
        ':currentVersion': invoice.version,
        ':emptyList': [],
        ':historyEntry': [{ from: invoice.status, to: newStatus, changedAt: now, changedBy: context.userId }],
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
      studentIds: string[];
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
    for (let i = 0; i < dto.studentIds.length; i += BATCH_SIZE) {
      const batch = dto.studentIds.slice(i, i + BATCH_SIZE);

      const results = await Promise.allSettled(
        batch.map(async (studentId: string) => {
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
              studentId: studentId,
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
    const escapeCsv = (s: string) => `"${(s || '').replace(/"/g, '""')}"`;

    // CSV header
    yield 'Invoice #,Student,Grand Total,Amount Paid,Amount Due,Status,Due Date,Issued Date,Academic Year\n';

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
        yield `${escapeCsv(entity.invoiceNumber)},${escapeCsv(entity.studentName)},${entity.grandTotal},${entity.amountPaid},${entity.amountDue},${escapeCsv(entity.status)},${escapeCsv(entity.dueDate)},${escapeCsv(entity.issuedDate)},${escapeCsv(entity.academicYear || '')}\n`;
        totalRows++;
      }

      // Hotfix 2026-05-24 — base64 decode (see dashboard.service.ts:387
      // for the contract reference). Same bug pattern, same fix.
      lastKey = result.lastEvaluatedKey
        ? JSON.parse(Buffer.from(result.lastEvaluatedKey, 'base64').toString())
        : undefined;
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
