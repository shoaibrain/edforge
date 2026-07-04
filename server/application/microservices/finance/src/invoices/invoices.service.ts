import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, PayloadTooLargeException } from '@nestjs/common';
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { AuditLoggerService, AuditAction } from '@app/logger';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { PdfLogoOptimizerService } from '../common/services/pdf-logo-optimizer.service';
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
import { invoiceEntityToDto, todayIsoDate } from '../common/mappers/invoice.mapper';
import { FinanceErrors } from '../common/errors/finance-errors';
import {
  AgreementResolverService,
  AgreementResolutionMemo,
} from '../agreements/agreement-resolver.service';
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

/**
 * EPIC-FB FB-3.3 — the agreement pricing decision for one student on one
 * billing date, computed by `planAgreementPricing` and consumed by the
 * line-item build in `generate()` / `generateForBulkWorker()`. `null`
 * everywhere means "standard path, byte-identical output" (golden spec).
 */
interface AgreementPricingPlan {
  agreementId: string;
  agreementVersion: number;
  /** Requested fee structures with feeType ∈ coveredFeeTypes — produce NO standard lines. */
  suppressedFeeStructureIds: string[];
  /** The covered feeTypes actually present in the request (partition result). */
  coveredFeeTypes: string[];
  /** Replacement lines (fixed_total allocation OR per_student matching lines). */
  agreementLines: InvoiceLineItemData[];
}

/** Statuses that end an invoice's financial life for the duplicate-billing guard. */
const AGREEMENT_GUARD_DEAD_STATUSES = new Set(['cancelled', 'written_off']);

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);
  private readonly auditLogger = new AuditLoggerService('finance-service');

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
    private readonly identityClient: IdentityClientService,
    private readonly tenantSettings: TenantSettingsService,
    private readonly sequenceService: SequenceService,
    private readonly feeStructuresService: FeeStructuresService,
    private readonly studentAccountsService: StudentAccountsService,
    private readonly pdfLogoOptimizer: PdfLogoOptimizerService,
    // Optional (`?`) ONLY so the many pre-FB spec harnesses that construct
    // this service manually with 8 positional mocks keep compiling —
    // mirror of BulkInvoiceGenerateWorker.metrics. At runtime Nest DI
    // always supplies the provider (declared in every module that
    // locally provides InvoicesService; pinned by module-wiring.spec.ts).
    private readonly agreementResolver?: AgreementResolverService,
  ) {}

  /**
   * EPIC-FB settled semantics (epic §3.3; FB-3.3/FB-3.4) — the ONE
   * agreement hook shared by all three generation paths (manual single,
   * bulk worker, enrollment webhook). For billing date D = the invoice's
   * issue/billing date:
   *
   *   1. BILLING_AGREEMENTS_ENABLED === 'false' → standard path; the
   *      resolver is never called (FB-3.9 flag-off contract).
   *   2. Resolve the student's active agreement on D via
   *      AgreementResolverService (memoized per bulk run — pass ONE
   *      caller-owned `memo` Map per job).
   *   3. No agreement → return null; output stays BYTE-IDENTICAL to the
   *      pre-agreement standard path (pinned by the golden spec).
   *   4. Agreement + overrideAgreement:true → standard fees exactly as
   *      requested; emit AGREEMENT_BYPASSED audit (controller has already
   *      enforced billing:manage for the flag).
   *   5. Agreement, no override → partition the requested fee structures
   *      by feeType ∈ coveredFeeTypes:
   *        - covered set empty → standard lines only, NO agreement fields;
   *        - else run the duplicate-billing guard (409 AGREEMENT_ACTIVE),
   *          then suppress the covered structures and build replacement
   *          lines (fixed_total → ONE line at the student's allocation;
   *          per_student → one line per matching lines[] entry with
   *          feeType ∈ covered).
   *
   * Callers run this hook BEFORE the Sprint A.1 gradeLevel snapshot block
   * (PR-CA convention) so snapshotting runs identically on agreement
   * invoices.
   */
  private async planAgreementPricing(
    schoolId: string,
    studentId: string,
    billingDate: string,
    billingPeriod: string | undefined,
    feeStructures: Array<{ feeStructureId: string; feeType?: string }>,
    overrideAgreement: boolean | undefined,
    context: RequestContext,
    memo?: AgreementResolutionMemo,
  ): Promise<AgreementPricingPlan | null> {
    if (process.env.BILLING_AGREEMENTS_ENABLED === 'false') return null;
    // Spec-harness tolerance only (see constructor note) — Nest DI always
    // wires the resolver in production.
    if (!this.agreementResolver) return null;

    const resolved = await this.agreementResolver.getActiveAgreementForStudent(
      studentId,
      schoolId,
      billingDate,
      context,
      memo,
    );
    if (!resolved) return null;
    const { agreement, allocationForStudent } = resolved;

    if (overrideAgreement === true) {
      this.auditLogger.log(
        AuditAction.AGREEMENT_BYPASSED,
        {
          tenantId: context.tenantId,
          userId: context.userId,
          userEmail: context.email,
          userRole: context.role,
        },
        { type: 'AGREEMENT', id: agreement.agreementId, name: agreement.title },
        {
          schoolId,
          studentId,
          requestedFeeStructureIds: feeStructures.map((fs) => fs.feeStructureId),
        },
      );
      return null;
    }

    const coveredTypeSet = new Set<string>(agreement.coveredFeeTypes as string[]);
    const suppressed = feeStructures.filter(
      (fs) => fs.feeType !== undefined && coveredTypeSet.has(fs.feeType),
    );
    if (suppressed.length === 0) return null;

    const suppressedFeeStructureIds = suppressed.map((fs) => fs.feeStructureId);
    const coveredFeeTypes = [...new Set(suppressed.map((fs) => fs.feeType as string))];

    await this.assertNoExistingAgreementInvoice(
      studentId,
      agreement.agreementId,
      billingPeriod,
      coveredFeeTypes,
      context,
    );

    const agreementLines: InvoiceLineItemData[] = [];
    const baseLine = {
      quantity: 1,
      discount: 0,
      discountReason: undefined,
      taxRate: 0,
      taxType: undefined,
      taxAmount: 0,
      agreementId: agreement.agreementId,
      agreementVersion: agreement.version,
      suppressedFeeStructureIds,
    };
    if (agreement.terms.agreementType === 'fixed_total') {
      // `null` allocation = member covered for suppression purposes but
      // with no replacement amount (resolver contract) — suppress only.
      if (allocationForStudent !== null) {
        const amount = Math.round(allocationForStudent * 100) / 100;
        agreementLines.push({
          ...baseLine,
          id: uuid(),
          feeStructureId: uuid(),
          description: `${agreement.title} (family agreement)`,
          amount,
          total: amount,
        });
      }
    } else {
      for (const line of agreement.terms.lines) {
        if (line.studentId !== studentId) continue;
        // Matching = feeType ∈ the partitioned covered set (settled
        // semantics 5b). Lump-sum lines (no feeType) never match.
        if (line.feeType === undefined || !coveredFeeTypes.includes(line.feeType)) continue;
        const amount = Math.round(line.amount * 100) / 100;
        agreementLines.push({
          ...baseLine,
          id: uuid(),
          feeStructureId: uuid(),
          feeType: line.feeType,
          description: `${agreement.title} — ${line.feeType} (family agreement)`,
          amount,
          total: amount,
        });
      }
    }

    return {
      agreementId: agreement.agreementId,
      agreementVersion: agreement.version,
      suppressedFeeStructureIds,
      coveredFeeTypes,
      agreementLines,
    };
  }

  /**
   * FB-3.4 duplicate-billing guard. GSI2 (student scope, same query shape
   * as `hasDuplicateInvoice`) — conflict when a non-cancelled/non-written-
   * off invoice already carries this agreementId AND (when the request has
   * a billingPeriod) the same billingPeriod; with no request billingPeriod
   * ANY live invoice for the agreement conflicts.
   */
  private async assertNoExistingAgreementInvoice(
    studentId: string,
    agreementId: string,
    billingPeriod: string | undefined,
    coveredFeeTypes: string[],
    context: RequestContext,
  ): Promise<void> {
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

    const conflict = result.items.find((inv) => {
      if (inv.agreementId !== agreementId) return false;
      if (AGREEMENT_GUARD_DEAD_STATUSES.has(inv.status)) return false;
      return billingPeriod ? inv.billingPeriod === billingPeriod : true;
    });

    if (conflict) {
      throw new ConflictException({
        code: FinanceErrors.AGREEMENT_ACTIVE,
        message:
          'These fee types are already priced by the family agreement; ' +
          'pass overrideAgreement to bill standard fees anyway.',
        agreementId,
        existingInvoiceId: conflict.invoiceId,
        existingInvoiceNumber: conflict.invoiceNumber,
        coveredFeeTypes,
      });
    }
  }

  async generate(
    schoolId: string,
    dto: GenerateInvoiceDto & { overrideAgreement?: boolean },
    context: RequestContext,
    agreementMemo?: AgreementResolutionMemo,
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

    // 1d. EPIC-FB settled semantics hook (epic §3.3; FB-3.3/FB-3.4) —
    // resolve the student's active agreement on the billing date and
    // partition the requested fee structures. Placed BEFORE the 5a
    // gradeLevel snapshot block (PR-CA convention) so snapshotting runs
    // identically on agreement invoices. `null` plan = standard path,
    // byte-identical output (golden spec).
    const billingDate = dto.issuedDate || new Date().toISOString().split('T')[0];
    const agreementPlan = await this.planAgreementPricing(
      schoolId,
      dto.studentId,
      billingDate,
      dto.billingPeriod,
      feeStructures,
      dto.overrideAgreement,
      context,
      agreementMemo,
    );
    const suppressedIdSet = new Set(agreementPlan?.suppressedFeeStructureIds ?? []);
    const billableFeeStructures = agreementPlan
      ? feeStructures.filter(fs => !suppressedIdSet.has(fs.feeStructureId))
      : feeStructures;

    // 2. Build discount map
    const discountMap = new Map<string, { amount: number; reason?: string }>();
    if (dto.discounts) {
      for (const d of dto.discounts) {
        discountMap.set(d.feeStructureId, { amount: d.amount, reason: d.reason });
      }
    }

    // 3. Calculate line items (snapshot fee structure version for immutability)
    const lineItems: InvoiceLineItemData[] = billableFeeStructures.map(fs => {
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

    // 3a. EPIC-FB — agreement replacement lines for the suppressed covered
    // structures (before custom lines so operator ad-hoc lines stay last).
    if (agreementPlan) {
      lineItems.push(...agreementPlan.agreementLines);
    }

    // 3b. Sprint C Phase 1 — append operator-supplied ad-hoc line items
    // (Step 2 "Custom line items" in the wizard). Synthetic feeStructureId
    // is a fresh UUID — non-resolvable, marked `isCustom: true` so consumers
    // skip the fee-structure lookup and render `description` verbatim. No
    // tax, no discount; the operator types the gross amount.
    if (dto.customLineItems && dto.customLineItems.length > 0) {
      for (const cli of dto.customLineItems) {
        const amt = Math.round(cli.amount * 100) / 100;
        lineItems.push({
          id: uuid(),
          feeStructureId: uuid(),
          feeStructureVersion: 1,
          feeType: 'custom',
          description: cli.name,
          amount: amt,
          quantity: 1,
          discount: 0,
          discountReason: undefined,
          taxRate: 0,
          taxType: undefined,
          taxAmount: 0,
          total: amt,
          isCustom: true,
        });
      }
    }

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
        ...(agreementPlan
          ? {
              feeOverrideMode: 'agreement' as const,
              agreementId: agreementPlan.agreementId,
              agreementVersion: agreementPlan.agreementVersion,
            }
          : {}),
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

  /**
   * FB-0.1(c) — status filter parts shared by every invoice list path.
   *
   * For `status === 'overdue'` the filter matches the DERIVED overdue set,
   * not just the stored status: the sweep no longer flips past-due
   * `partially_paid` rows to stored-overdue, so a plain `#status = :status`
   * filter would silently drop them from "overdue" views. The expansion is
   * a FilterExpression-only change on the SAME key condition (gsi pk +
   * begins_with 'INVOICE'), so pagination cursors are untouched — no
   * two-query merge needed. Past-due `issued` rows still reach the stored
   * set via the sweep, exactly as before.
   */
  private pushStatusFilter(
    status: string,
    filterParts: string[],
    filterValues: Record<string, any>,
    filterNames: Record<string, string>,
  ): void {
    filterNames['#status'] = 'status';
    if (status === 'overdue') {
      filterParts.push(
        '(#status = :status OR (#status = :partiallyPaid AND dueDate < :today))',
      );
      filterValues[':status'] = 'overdue';
      filterValues[':partiallyPaid'] = 'partially_paid';
      filterValues[':today'] = todayIsoDate();
    } else {
      filterParts.push('#status = :status');
      filterValues[':status'] = status;
    }
  }

  /**
   * FB-0.2 (live finding L1) — resolve the school's CURRENT display name
   * for read-time responses/renders. The stored `invoice.schoolName` is an
   * at-issuance archival snapshot; operator-facing reads prefer the live
   * name. Returns null on any failure (including identity being down) so
   * callers fall back to the stored snapshot — never throws.
   */
  private async resolveCurrentSchoolName(
    schoolId: string,
    context: RequestContext,
  ): Promise<string | null> {
    try {
      const name = await this.identityClient.getSchoolName(schoolId, context);
      if (!name) {
        this.logger.warn(
          `resolveCurrentSchoolName: school lookup returned no name for ` +
            `schoolId=${schoolId} — falling back to stored snapshot`,
        );
      }
      return name;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `resolveCurrentSchoolName: school lookup failed for schoolId=${schoolId}: ` +
          `${msg.slice(0, 200)} — falling back to stored snapshot`,
      );
      return null;
    }
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
    const currentSchoolName = await this.resolveCurrentSchoolName(schoolId, context);

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
        items: result.items.map(e => invoiceEntityToDto(e, { currentSchoolName })),
        lastEvaluatedKey: result.lastEvaluatedKey,
        hasMore: result.hasMore,
      };
    }

    // Otherwise query GSI1 for school-scoped invoices
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};
    const filterNames: Record<string, string> = {};

    if (options.status) {
      this.pushStatusFilter(options.status, filterParts, filterValues, filterNames);
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
      Object.keys(filterNames).length > 0 ? filterNames : undefined,
      options.limit || 50,
      false,
      decodeCursor(options.cursor),
    );

    return {
      items: result.items.map(e => invoiceEntityToDto(e, { currentSchoolName })),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * List invoices for a specific (school, gradeLevel) pair — Sprint A.4.
   *
   * Uses GSI14 (`gsi14pk = TENANT#tid#SCHOOL#sid#GRADE#grade`,
   * `gsi14sk = INVOICE#issuedDate`) so this is a single Query, NOT a
   * school-wide scan with a post-filter. Only invoices with a resolved
   * `gradeLevel` snapshot appear here — sparse-index by design. The
   * "Unknown" UI bucket (Sprint B.1) reads unresolved rows via a
   * separate path on the `gradeLevelResolutionStatus` attribute.
   *
   * The `INVOICE#` SK prefix lets GSI14 simultaneously serve payment
   * list-by-grade queries (Sprint A.4's PaymentsService counterpart)
   * — same PK, `PAYMENT#` prefix for the SK.
   *
   * Filters that aren't on the SK (status, academicYear) become
   * FilterExpression. Codex round-3 hardening on the helper now uses
   * `LastEvaluatedKey` for `hasMore` so a status-filtered page won't
   * silently starve.
   */
  async listBySchoolAndGrade(
    schoolId: string,
    gradeLevel: string,
    context: RequestContext,
    options: { status?: string; academicYear?: string; limit?: number; cursor?: string } = {},
  ): Promise<{ items: Invoice[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    if (!gradeLevel || !gradeLevel.trim()) {
      // Defensive: empty/whitespace gradeLevel would build a malformed
      // GSI key and return nothing useful. Reject at the boundary —
      // the caller (controller) should never reach here with empty,
      // but a misrouted internal call MUST NOT silently produce
      // garbage data.
      throw new BadRequestException(
        `listBySchoolAndGrade requires a non-empty gradeLevel; got ${JSON.stringify(gradeLevel)}`,
      );
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const currentSchoolName = await this.resolveCurrentSchoolName(schoolId, context);
    const gsi14pk = GSIKeyBuilder.schoolGradeScope(context.tenantId, schoolId, gradeLevel);

    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};
    const filterNames: Record<string, string> = {};

    if (options.status) {
      this.pushStatusFilter(options.status, filterParts, filterValues, filterNames);
    }
    if (options.academicYear) {
      filterParts.push('academicYear = :academicYear');
      filterValues[':academicYear'] = options.academicYear;
    }

    const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
      client,
      'GSI14',
      gsi14pk as string,
      'INVOICE',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      Object.keys(filterNames).length > 0 ? filterNames : undefined,
      options.limit || 50,
      false, // newest issuedDate first
      decodeCursor(options.cursor),
    );

    this.logger.log(
      `listBySchoolAndGrade entity=INVOICE schoolId=${schoolId} grade=${gradeLevel} returned=${result.items.length}`,
    );

    return {
      items: result.items.map(e => invoiceEntityToDto(e, { currentSchoolName })),
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
    const currentSchoolName = await this.resolveCurrentSchoolName(schoolId, context);
    const allItems: Invoice[] = [];

    for (const studentId of studentIds) {
      const gsi2pk = GSIKeyBuilder.studentScope(context.tenantId, studentId);

      const filterParts: string[] = [];
      const filterValues: Record<string, any> = {};
      const filterNames: Record<string, string> = {};

      if (options.status) {
        this.pushStatusFilter(options.status, filterParts, filterValues, filterNames);
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

      allItems.push(...result.items.map(e => invoiceEntityToDto(e, { currentSchoolName })));
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

  /**
   * EPIC-FB FB-4.6 — open (payable, amount still due) invoice ENTITIES for
   * one student at one school. Same GSI2 student-scope query shape as
   * `listForStudents`, narrowed to the family-payment need: status ∈
   * {issued, partially_paid, overdue} AND amountDue > 0, school-filtered
   * (GSI2 spans a student's invoices across schools; this endpoint is
   * school-scoped, so cross-school rows are excluded here).
   *
   * NEW read-only method by design — existing list/query helpers stay
   * untouched (Package E golden contract).
   */
  async listOpenInvoiceEntitiesForStudent(
    schoolId: string,
    studentId: string,
    context: RequestContext,
  ): Promise<InvoiceEntity[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi2pk = GSIKeyBuilder.studentScope(context.tenantId, studentId);

    const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
      client,
      'GSI2',
      gsi2pk,
      'INVOICE',
      'begins_with',
      'schoolId = :schoolId AND #status IN (:issued, :partially_paid, :overdue) AND amountDue > :zero',
      {
        ':schoolId': schoolId,
        ':issued': 'issued',
        ':partially_paid': 'partially_paid',
        ':overdue': 'overdue',
        ':zero': 0,
      },
      { '#status': 'status' },
      100,
      false,
    );

    return result.items;
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

    const currentSchoolName = await this.resolveCurrentSchoolName(schoolId, context);
    return invoiceEntityToDto(entity, { currentSchoolName });
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

    // FB-0.2 — current school name for the PDF header (stored snapshot is
    // the fallback). Joins the identity fan-out so it adds no wall-clock.
    const schoolNamePromise = this.resolveCurrentSchoolName(schoolId, context);

    const [brandingTimed, templateTimed, currentSchoolName] = await Promise.all([
      brandingPromise,
      templatePromise,
      schoolNamePromise,
    ]);
    const brandingResult = brandingTimed.result;
    const templateResponse = templateTimed.result;
    const tAfterIdentity = Date.now();

    // The InvoiceTemplateConfig shape is a structural subtype of
    // PdfTemplateConfig + extra fields; identity returns a Record<string,
    // unknown> over the wire. Cast at the boundary; the C.1.1 + C.1.3
    // contract guarantees the shape.
    const templateConfig = templateResponse.templateConfig as unknown as InvoiceTemplateConfig;

    // Plan §5d — logo optimization parity with the bulk workers.
    // Without this step, the individual-PDF endpoint embeds the raw
    // 1.73 MB 2000×2000 school logo as an uncompressed FlateDecode
    // XObject → ~1.8 MB PDF (97.8% of which is the logo). With this
    // step, the same PDF ends up ~200 KB. Fail-open: on any error the
    // optimizer returns the original URL unchanged so the render still
    // produces a working (but bloated) PDF. Individual endpoints have
    // a shorter latency SLA than bulk workers so we use the service's
    // default 3 s fetch timeout instead of the workers' 10 s.
    const optimizedLogoSrc = await this.pdfLogoOptimizer.optimize(
      brandingResult.urls?.logo,
    );
    const urlsWithOptimizedLogo = brandingResult.urls
      ? { ...brandingResult.urls, logo: optimizedLogoSrc }
      : undefined;

    const buffer = await renderInvoiceToPdfBuffer({
      invoice: currentSchoolName ? { ...invoice, schoolName: currentSchoolName } : invoice,
      branding: brandingResult.branding,
      urls: urlsWithOptimizedLogo,
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
   *
   * Sprint E.1a TOCTOU hardening (audit HIGH #2): pre-E.1a this method
   * did two SEPARATE writes — `update()` flipped the invoice status,
   * then `recordLedgerEntry` did its own `TransactWriteItems` for
   * ledger + account. If the second write failed (DDB blip, account
   * version drift), the invoice was `'issued'` with NO ledger entry —
   * a forensic mess at 1200 records. The pre-hardening shape was the
   * exact pattern that BUG-F3 fixed for `applyPayment` in Sprint C2.B.T4.
   *
   * Post-hardening: invoice status flip + ledger Put + account
   * balance/version Update commit as ONE 3-item `TransactWriteItems`.
   * Each carries a `ConditionExpression`: invoice still `'draft'`,
   * invoice version unchanged, account version unchanged. Any drift
   * fails the entire transaction atomically.
   *
   * Same `recordLedgerEntry → buildLedgerEntryTransactItems` shape that
   * `applyPayment` uses (Sprint C2.B.T4). The 3-item bundle is the same
   * pattern the operator's bulk-issue flow hits at scale after the
   * Sprint E worker creates drafts.
   */
  async issue(
    schoolId: string,
    invoiceId: string,
    context: RequestContext,
  ): Promise<Invoice> {
    const entity = await this.getEntity(schoolId, invoiceId, context);

    if (entity.status !== 'draft') {
      throw new BadRequestException(
        `Cannot issue invoice in '${entity.status}' status. Only draft invoices can be issued.`,
      );
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const accountKey = EntityKeyBuilder.billingAccount(schoolId, entity.studentId);
    const account = await this.dynamoDBClient.getItem<any>(
      client,
      context.tenantId,
      accountKey,
    );

    const now = new Date().toISOString();
    const newStatus: InvoiceEntity['status'] = 'issued';
    const historyEntry = {
      from: entity.status,
      to: newStatus,
      changedAt: now,
      changedBy: context.userId,
    };

    // Item (1): Invoice status flip, version-guarded + status-guarded.
    const invoiceUpdate: NonNullable<TransactWriteCommandInput['TransactItems']>[number] = {
      Update: {
        TableName: this.dynamoDBClient.getTableName(),
        Key: { tenantId: entity.tenantId, entityKey: entity.entityKey },
        UpdateExpression:
          'SET #status = :issued, gsi1sk = :gsi1sk, updatedAt = :now, updatedBy = :by, ' +
          'statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :historyEntry), ' +
          '#v = #v + :one',
        ExpressionAttributeValues: {
          ':issued': newStatus,
          ':draft': 'draft',
          ':gsi1sk': GSIKeyBuilder.entitySort('INVOICE', `${newStatus}#${entity.dueDate}`),
          ':now': now,
          ':by': context.userId,
          ':one': 1,
          ':currentVersion': entity.version,
          ':emptyList': [],
          ':historyEntry': [historyEntry],
        },
        ExpressionAttributeNames: { '#status': 'status', '#v': 'version' },
        ConditionExpression: '#status = :draft AND #v = :currentVersion',
      },
    };

    if (account) {
      // Items (2) + (3): ledger Put + account Update via the canonical
      // builder so the account-version check + balance math stay in
      // one place.
      const { items: ledgerItems } = this.studentAccountsService.buildLedgerEntryTransactItems(
        account,
        'invoice',
        invoiceId,
        `Invoice ${entity.invoiceNumber} issued`,
        entity.grandTotal,
        0,
        context,
      );
      await this.dynamoDBClient.transactWrite(client, [invoiceUpdate, ...ledgerItems]);
    } else {
      // No billing account on file — issue the invoice without a ledger entry.
      // (Today's pre-hardening behavior also skipped the ledger write in
      // this branch; we preserve it transactionally for atomicity.)
      await this.dynamoDBClient.transactWrite(client, [invoiceUpdate]);
    }

    this.eventsService
      .publishInvoiceStatusChanged(
        context.tenantId,
        schoolId,
        invoiceId,
        entity.status,
        newStatus,
      )
      .catch((err) =>
        this.logger.error(`Failed to publish InvoiceStatusChanged: ${err.message}`),
      );

    // Return the post-transition entity shape. We avoid an extra GetItem
    // by composing locally — the transactional write guarantees the
    // values we project here are the committed ones.
    return invoiceEntityToDto({
      ...entity,
      status: newStatus,
      version: entity.version + 1,
      updatedAt: now,
      updatedBy: context.userId,
      gsi1sk: GSIKeyBuilder.entitySort('INVOICE', `${newStatus}#${entity.dueDate}`),
      statusHistory: [...(entity.statusHistory ?? []), historyEntry],
    });
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
   * EPIC-FB FB-4.5 — build the reverse-payment Update TransactItem WITHOUT
   * executing it (transactional sibling of `reversePaymentOnInvoice`, same
   * math + status derivation). Lets `PaymentsService.voidPayment` / `refund`
   * fold N per-target invoice restores into ONE TransactWriteItems when
   * reversing a multi-target family payment — a partial reversal (some
   * invoices restored, others not) would be worse than the single-target
   * path's documented sequential drift.
   *
   * NEW method by design: the executing `reversePaymentOnInvoice` is
   * pre-existing behavior (single-target void/refund) and stays untouched.
   */
  buildReversePaymentTransactItem(
    invoice: InvoiceEntity,
    reversalAmount: number,
    context: RequestContext,
  ): {
    item: NonNullable<TransactWriteCommandInput['TransactItems']>[number];
    newStatus: string;
    newAmountPaid: number;
    newAmountDue: number;
  } {
    const newAmountPaid = Math.max(0, invoice.amountPaid - reversalAmount);
    const newAmountDue = Math.round((invoice.grandTotal - newAmountPaid) * 100) / 100;

    let newStatus: string;
    if (newAmountPaid <= 0) {
      newStatus = 'issued';
    } else if (newAmountDue > 0) {
      newStatus = 'partially_paid';
    } else {
      newStatus = 'paid';
    }

    const now = new Date().toISOString();

    return {
      item: {
        Update: {
          TableName: this.dynamoDBClient.getTableName(),
          Key: { tenantId: invoice.tenantId, entityKey: invoice.entityKey },
          UpdateExpression:
            'SET amountPaid = :amountPaid, amountDue = :amountDue, #status = :newStatus, updatedAt = :now, gsi1sk = :gsi1sk, #v = #v + :one, statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :historyEntry)',
          ExpressionAttributeValues: {
            ':amountPaid': Math.round(newAmountPaid * 100) / 100,
            ':amountDue': Math.round(Math.max(0, newAmountDue) * 100) / 100,
            ':newStatus': newStatus,
            ':now': now,
            ':gsi1sk': GSIKeyBuilder.entitySort('INVOICE', `${newStatus}#${invoice.dueDate}`),
            ':one': 1,
            ':currentVersion': invoice.version,
            ':emptyList': [],
            ':historyEntry': [
              { from: invoice.status, to: newStatus, changedAt: now, changedBy: context.userId },
            ],
          },
          ExpressionAttributeNames: { '#status': 'status', '#v': 'version' },
          ConditionExpression: '#v = :currentVersion',
        },
      },
      newStatus,
      newAmountPaid: Math.round(newAmountPaid * 100) / 100,
      newAmountDue: Math.round(Math.max(0, newAmountDue) * 100) / 100,
    };
  }

  /**
   * Bulk Ops Sprint C.3 — resolve a bulk-generate payload (legacy flat,
   * tagged `students`, or tagged `grades`) into a deduped studentIds[].
   *
   * The `grades` mode calls academics `GET /students?gradeLevel=X` once
   * per grade (or once with no filter for the `ALL` sentinel) and
   * merges the results. Partial failures on a single grade are logged
   * and skipped, NOT fatal — the operator gets a partial result rather
   * than nothing.
   *
   * Hard cap 5000 students total — beyond this, throws
   * PayloadTooLargeException. Sprint E adds the async path for larger
   * sets; this sync path is for ≤25.
   */
  async resolveStudentIdsForBulkGenerate(
    schoolId: string,
    dto: {
      selectionMode?: 'students' | 'grades';
      studentIds?: string[];
      gradeLevels?: string[];
    },
    context: RequestContext,
  ): Promise<string[]> {
    // Legacy flat shape — no discriminator, plain studentIds[].
    if (!dto.selectionMode && Array.isArray(dto.studentIds)) {
      return [...new Set(dto.studentIds)];
    }

    if (dto.selectionMode === 'students') {
      const ids = dto.studentIds ?? [];
      if (ids.length === 0) {
        throw new BadRequestException('selectionMode=students requires non-empty studentIds');
      }
      return [...new Set(ids)];
    }

    if (dto.selectionMode === 'grades') {
      const grades = dto.gradeLevels ?? [];
      if (grades.length === 0) {
        throw new BadRequestException('selectionMode=grades requires non-empty gradeLevels');
      }
      const isAllSentinel = grades.length === 1 && grades[0] === 'ALL';
      const targetGrades = isAllSentinel ? [undefined] : grades;
      const merged = new Set<string>();

      // Per-grade fetch (or single no-filter fetch for ALL). The
      // identityClient helper is itself partial-failure tolerant —
      // returns [] on per-call failure so one bad grade doesn't kill
      // the whole loop.
      for (const grade of targetGrades) {
        const ids = await this.identityClient.getStudentIdsByGrade(schoolId, grade, context);
        for (const id of ids) merged.add(id);
      }

      if (merged.size === 0) {
        throw new BadRequestException(
          `No students resolved for gradeLevels=[${grades.join(',')}]. ` +
            `Check that students are enrolled at the matching grade(s).`,
        );
      }
      if (merged.size > 5000) {
        throw new BadRequestException(
          `Bulk-generate cap exceeded: resolved ${merged.size} students > 5000 limit. ` +
            `Use a narrower grade selection or wait for Sprint E async path.`,
        );
      }
      return [...merged];
    }

    throw new BadRequestException(`Unknown bulk-generate selectionMode: ${(dto as any).selectionMode}`);
  }

  /**
   * Bulk generate invoices for a list of student accounts.
   * Uses Promise.allSettled with batched concurrency for throughput.
   * Skips students with existing active invoices for the same fee structures + billing period.
   *
   * Sprint C.4 — accepts the Sprint C.1 discriminated union (legacy flat,
   * tagged `students`, tagged `grades`). For `grades`, resolves to
   * studentIds[] via the academics API first. Sync threshold = 25
   * students; above that, the controller returns 413 directing the
   * operator to the async path (Sprint E).
   */
  /**
   * Bulk Ops Sprint C.6 — preview the result of a bulk-generate call
   * WITHOUT writing anything. Wizard's Step 4 confirm screen consumes
   * this to render "Will generate N invoices, M skipped (duplicates),
   * estimated K seconds" before the operator commits.
   *
   * Resolves studentIds[] via the same C.3 helper as generateBulk, then
   * checks each for an existing active invoice with the same fee
   * structures + billing period. Returns counts only — no entity payload,
   * no DDB writes.
   *
   * `estimatedDurationSec` is a rough projection: assumes ~300ms per
   * student (single-PDF render rate of the existing generate path under
   * the batched-Promise.allSettled(10) concurrency). Operators care more
   * about the order of magnitude than the precision.
   */
  async bulkPreview(
    schoolId: string,
    dto: {
      selectionMode?: 'students' | 'grades';
      studentIds?: string[];
      gradeLevels?: string[];
      feeStructureIds: string[];
      billingPeriod?: string;
    },
    context: RequestContext,
  ): Promise<{
    studentCount: number;
    eligibleCount: number;
    duplicateCount: number;
    estimatedDurationSec: number;
    studentsWithBalance?: number;
    studentsNotBilledThisPeriod?: number;
    studentsNewAdmission?: number;
    students?: Array<{ studentId: string; billingSource: 'standard' | 'agreement' | 'mixed' }>;
  }> {
    const studentIds = await this.resolveStudentIdsForBulkGenerate(schoolId, dto, context);

    // Duplicate detection is best-effort + counts-only — failures
    // collapse to "0 duplicates" rather than 500ing the preview.
    let duplicateCount = 0;
    if (dto.feeStructureIds.length > 0) {
      const dupResults = await Promise.allSettled(
        studentIds.map(studentId =>
          this.hasDuplicateInvoice(
            schoolId,
            studentId,
            dto.feeStructureIds,
            dto.billingPeriod,
            context,
          ),
        ),
      );
      for (const r of dupResults) {
        if (r.status === 'fulfilled' && r.value === true) duplicateCount++;
      }
    }

    const eligibleCount = studentIds.length - duplicateCount;
    // ~300ms/student average per generate path; rough enough for an
    // operator confirmation banner ("≈ 30 sec for 100 students").
    const estimatedDurationSec = Math.max(1, Math.ceil(eligibleCount * 0.3));

    // Sprint C Phase 1 — three derivable-segment counters powering the
    // wizard Step 1 rail's "balance due / new admission / not billed this
    // period" rows. All best-effort: any underlying query failure yields
    // `undefined` for that counter (frontend renders as "—") rather than
    // failing the whole preview. Background: smart-segment chips (transport
    // users / boarders / scholarship) need new student demographic fields
    // that don't exist yet — those wait for Phase 2. These three counters
    // are derivable today from finance state alone.
    const segCounters = await this.computePreviewSegmentCounters(
      schoolId,
      studentIds,
      dto.billingPeriod,
      context,
    );

    // EPIC-FB FB-3.7 — per-student billingSource projection of the settled-
    // semantics partition, on today's date (the bulk paths have no
    // issuedDate input): 'agreement' = every requested feeType covered by
    // the student's active agreement; 'mixed' = some; 'standard' = none /
    // no agreement. Additive + best-effort: flag-off or any resolution
    // failure omits the field entirely (pre-FB response shape).
    const students = await this.computePreviewBillingSources(
      schoolId,
      studentIds,
      dto.feeStructureIds,
      context,
    );

    this.logger.log(
      `bulkPreview schoolId=${schoolId} resolved=${studentIds.length} duplicates=${duplicateCount} eligible=${eligibleCount}`,
    );

    return {
      studentCount: studentIds.length,
      eligibleCount,
      duplicateCount,
      estimatedDurationSec,
      ...segCounters,
      ...(students ? { students } : {}),
    };
  }

  private async computePreviewBillingSources(
    schoolId: string,
    studentIds: string[],
    feeStructureIds: string[],
    context: RequestContext,
  ): Promise<Array<{ studentId: string; billingSource: 'standard' | 'agreement' | 'mixed' }> | undefined> {
    if (process.env.BILLING_AGREEMENTS_ENABLED === 'false') return undefined;
    if (!this.agreementResolver) return undefined;

    try {
      const requestedFeeTypes: string[] =
        feeStructureIds.length > 0
          ? [
              ...new Set(
                (await this.feeStructuresService.getByIds(schoolId, feeStructureIds, context))
                  .map((fs) => fs.feeType as string | undefined)
                  .filter((t) => typeof t === 'string' && t.length > 0) as string[],
              ),
            ]
          : [];

      const memo: AgreementResolutionMemo = new Map();
      const today = todayIsoDate();

      return await Promise.all(
        studentIds.map(async (studentId) => {
          const resolved = await this.agreementResolver!.getActiveAgreementForStudent(
            studentId,
            schoolId,
            today,
            context,
            memo,
          );
          let billingSource: 'standard' | 'agreement' | 'mixed' = 'standard';
          if (resolved && requestedFeeTypes.length > 0) {
            const coveredSet = new Set<string>(resolved.agreement.coveredFeeTypes as string[]);
            const coveredCount = requestedFeeTypes.filter((t) => coveredSet.has(t)).length;
            billingSource =
              coveredCount === 0
                ? 'standard'
                : coveredCount === requestedFeeTypes.length
                  ? 'agreement'
                  : 'mixed';
          }
          return { studentId, billingSource };
        }),
      );
    } catch (e: any) {
      this.logger.warn(
        `bulkPreview: billingSource resolution failed (school=${schoolId}): ${e?.message ?? e}`,
      );
      return undefined;
    }
  }

  /**
   * Sprint C Phase 1 — derivable segment counters for the wizard rail.
   *
   * Three counts surfaced inline next to the recipient list:
   *   - studentsWithBalance         — billing-account `balance > 0`
   *   - studentsNotBilledThisPeriod — none of student's invoices match billingPeriod
   *   - studentsNewAdmission        — student has zero invoices ever
   *
   * Implementation: 2 DDB-side queries shared across the 3 counters —
   * one student-accounts list (for balance) and one listForStudents (for
   * invoice history, which then buckets into "this period" + "ever"). Each
   * counter is independently best-effort — a failure in one branch logs a
   * warning and returns undefined for THAT counter only, never throws.
   *
   * Cost: bounded by `studentIds.length` (resolved set already capped at
   * 5000 by C.3); typical batch is < 500. The student-accounts list scans
   * up to 500 rows; listForStudents does N GSI2 queries internally — same
   * profile the bulk-generate worker uses for duplicate detection.
   */
  private async computePreviewSegmentCounters(
    schoolId: string,
    studentIds: string[],
    billingPeriod: string | undefined,
    context: RequestContext,
  ): Promise<{
    studentsWithBalance?: number;
    studentsNotBilledThisPeriod?: number;
    studentsNewAdmission?: number;
  }> {
    if (studentIds.length === 0) {
      return {
        studentsWithBalance: 0,
        studentsNotBilledThisPeriod: 0,
        studentsNewAdmission: 0,
      };
    }
    const studentIdSet = new Set(studentIds);
    const out: {
      studentsWithBalance?: number;
      studentsNotBilledThisPeriod?: number;
      studentsNewAdmission?: number;
    } = {};

    // 1. studentsWithBalance — list billing accounts with `balance > 0` and
    //    intersect with the resolved set. Uses the existing
    //    StudentAccountsService.list with the hasOutstandingBalance filter,
    //    which queries GSI1 by school scope.
    try {
      const accts = await this.studentAccountsService.list(schoolId, context, {
        hasOutstandingBalance: true,
        limit: Math.max(500, studentIds.length),
      });
      let n = 0;
      for (const a of accts.items) {
        if (studentIdSet.has(a.studentId)) n++;
      }
      out.studentsWithBalance = n;
    } catch (e: any) {
      this.logger.warn(
        `bulkPreview: studentsWithBalance failed (school=${schoolId}): ${e?.message ?? e}`,
      );
    }

    // 2 & 3 — share a single listForStudents call (no period filter); bucket
    //         client-side into "billed this period" + "billed ever" sets.
    try {
      const invQueryLimit = Math.max(100, studentIds.length * 2);
      const inv = await this.listForStudents(schoolId, studentIds, context, {
        limit: invQueryLimit,
      });
      const everBilled = new Set<string>();
      const billedInPeriod = new Set<string>();
      for (const i of inv.items) {
        if (i.studentId) {
          everBilled.add(i.studentId);
          if (billingPeriod && i.billingPeriod === billingPeriod) {
            billedInPeriod.add(i.studentId);
          }
        }
      }
      out.studentsNewAdmission = studentIds.filter(id => !everBilled.has(id)).length;
      // Only meaningful when a billingPeriod was supplied — otherwise the
      // "not billed in [period]" question has no anchor; leave undefined.
      if (billingPeriod) {
        out.studentsNotBilledThisPeriod = studentIds.filter(
          id => !billedInPeriod.has(id),
        ).length;
      }
    } catch (e: any) {
      this.logger.warn(
        `bulkPreview: studentsNotBilledThisPeriod+studentsNewAdmission failed ` +
          `(school=${schoolId}): ${e?.message ?? e}`,
      );
    }

    return out;
  }

  async generateBulk(
    schoolId: string,
    dto: {
      selectionMode?: 'students' | 'grades';
      studentIds?: string[];
      gradeLevels?: string[];
      feeStructureIds: string[];
      academicYear: string;
      billingPeriod?: string;
      dueDate: string;
      notes?: string;
      customLineItems?: Array<{ name: string; amount: number }>;
      skipZeroTotal?: boolean;
    },
    context: RequestContext,
  ): Promise<{ generated: number; skipped: number; errors: string[]; resolvedStudentCount?: number }> {
    const BATCH_SIZE = 10;
    const SYNC_LIMIT = 25;
    let generated = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Sprint C.3 — resolve target studentIds[] BEFORE fee-structure load
    // so a grade-resolution failure short-circuits early.
    const studentIds = await this.resolveStudentIdsForBulkGenerate(schoolId, dto, context);

    if (studentIds.length > SYNC_LIMIT) {
      throw new PayloadTooLargeException({
        code: 'BULK_GENERATE_SYNC_LIMIT_EXCEEDED',
        message:
          `Resolved ${studentIds.length} students > sync limit (${SYNC_LIMIT}). ` +
          `Use the async endpoint with ?async=true (Sprint E) or narrow the selection.`,
        resolvedStudentCount: studentIds.length,
        syncLimit: SYNC_LIMIT,
      });
    }

    // Fetch fee structures once (shared across all students)
    const feeStructures = await this.feeStructuresService.getByIds(
      schoolId,
      dto.feeStructureIds,
      context,
    );
    if (feeStructures.length === 0) {
      throw new BadRequestException('No valid fee structures found');
    }

    // Sprint C Phase 1 — skipZeroTotal pre-filter. Compute the projected
    // grand total per fee-structure set (custom lines + fee structures, no
    // tax math — that's the gross floor) and short-circuit students whose
    // projected total = 0. Counted as skipped, no `generate()` call made,
    // no DDB write. Today's fee structures have flat `amount` (no per-grade
    // band logic — that lands Phase 2), so the projection is the same for
    // every student in the batch; we compute it once.
    if (dto.skipZeroTotal) {
      const customSum = (dto.customLineItems ?? []).reduce(
        (s, l) => s + (Number(l.amount) || 0),
        0,
      );
      const projectedFeeSum = feeStructures.reduce(
        (s, fs) => s + (Number(fs.amount) || 0),
        0,
      );
      if (customSum + projectedFeeSum === 0) {
        skipped = studentIds.length;
        this.logger.log(
          `Bulk generation skipped all ${studentIds.length} students — ` +
            `projected total = 0 and skipZeroTotal:true.`,
        );
        return { generated: 0, skipped, errors, resolvedStudentCount: studentIds.length };
      }
    }

    // EPIC-FB FB-3.7 — one resolver memo per bulk run (resolver JSDoc
    // contract); repeat (student, date) resolutions are served from memory.
    const agreementMemo: AgreementResolutionMemo = new Map();

    // Process students in batches
    for (let i = 0; i < studentIds.length; i += BATCH_SIZE) {
      const batch = studentIds.slice(i, i + BATCH_SIZE);

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
              customLineItems: dto.customLineItems,
            },
            context,
            agreementMemo,
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
      `Bulk generation complete: ${generated} generated, ${skipped} skipped, ${errors.length} errors ` +
        `(${studentIds.length} students resolved)`,
    );
    return { generated, skipped, errors, resolvedStudentCount: studentIds.length };
  }

  /**
   * Sprint E.4 — per-student generate path used by `BulkInvoiceGenerateWorker`.
   *
   * Differences from `generate()`:
   *   - Caller pre-allocates the invoice number via
   *     `SequenceService.incrementSequenceBy` + `formatInvoiceNumber`, so
   *     this method does NOT call `nextInvoiceNumber` (collapses 1200
   *     individual hits on the per-school sequence row into ONE per-job
   *     reservation — Sprint E.1 audit BLOCKER #1).
   *   - Caller passes a per-job cached `schoolName` so this method does
   *     NOT re-fetch identity for every student (audit HIGH #3 — 1200
   *     students × 2 identity calls = 2400 HTTP).
   *   - Worker creates DRAFTS (operator decision 1 — operator reviews
   *     before issuing). `autoIssue` is hard-coded false here.
   *
   * Same validation/duplicate/discount semantics as `generate()` —
   * identical entity shape so a draft created by the worker is
   * indistinguishable from one created by the sync path.
   */
  async generateForBulkWorker(
    schoolId: string,
    dto: GenerateInvoiceDto & {
      preAllocatedInvoiceNumber: string;
      cachedSchoolName: string;
      cachedCurrency: string;
    },
    context: RequestContext,
    agreementMemo?: AgreementResolutionMemo,
  ): Promise<Invoice> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // 1. Fee structures (caller may have pre-fetched, but we re-validate
    // shape against the dto here; the per-job cache lives in the worker).
    const feeStructures = await this.feeStructuresService.getByIds(
      schoolId,
      dto.feeStructureIds,
      context,
    );
    if (feeStructures.length !== dto.feeStructureIds.length) {
      const foundIds = new Set(feeStructures.map((f) => f.feeStructureId));
      const missing = dto.feeStructureIds.filter((id) => !foundIds.has(id));
      throw new NotFoundException(`Fee structures not found: ${missing.join(', ')}`);
    }

    // 1b. EPIC-FB settled semantics hook — same partition/suppress/append
    // as generate(); the worker passes ONE memo per job. Runs before the
    // step-4 gradeLevel snapshot (PR-CA convention). A 409 AGREEMENT_ACTIVE
    // thrown here is recorded by the worker as a per-student failure.
    const billingDate = dto.issuedDate || new Date().toISOString().split('T')[0];
    const agreementPlan = await this.planAgreementPricing(
      schoolId,
      dto.studentId,
      billingDate,
      dto.billingPeriod,
      feeStructures,
      undefined,
      context,
      agreementMemo,
    );
    const suppressedIdSet = new Set(agreementPlan?.suppressedFeeStructureIds ?? []);
    const billableFeeStructures = agreementPlan
      ? feeStructures.filter((fs) => !suppressedIdSet.has(fs.feeStructureId))
      : feeStructures;

    // 2. Discount map + line items (identical to generate()).
    const discountMap = new Map<string, { amount: number; reason?: string }>();
    if (dto.discounts) {
      for (const d of dto.discounts) {
        discountMap.set(d.feeStructureId, { amount: d.amount, reason: d.reason });
      }
    }
    const lineItems: InvoiceLineItemData[] = billableFeeStructures.map((fs) => {
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
    if (agreementPlan) {
      lineItems.push(...agreementPlan.agreementLines);
    }
    if (dto.customLineItems && dto.customLineItems.length > 0) {
      for (const cli of dto.customLineItems) {
        const amt = Math.round(cli.amount * 100) / 100;
        lineItems.push({
          id: uuid(),
          feeStructureId: uuid(),
          feeStructureVersion: 1,
          feeType: 'custom',
          description: cli.name,
          amount: amt,
          quantity: 1,
          discount: 0,
          discountReason: undefined,
          taxRate: 0,
          taxType: undefined,
          taxAmount: 0,
          total: amt,
          isCustom: true,
        });
      }
    }

    // 3. Totals + tax summary (identical to generate()).
    const subtotal = lineItems.reduce((sum, li) => sum + li.amount * li.quantity, 0);
    const discountTotal = lineItems.reduce((sum, li) => sum + li.discount, 0);
    const taxTotal = lineItems.reduce((sum, li) => sum + li.taxAmount, 0);
    const grandTotal = lineItems.reduce((sum, li) => sum + li.total, 0);
    const taxGroups = new Map<string, { taxableAmount: number; taxRate: number; taxAmount: number }>();
    for (const li of lineItems) {
      const tt = li.taxType || 'none';
      const existing = taxGroups.get(tt) || { taxableAmount: 0, taxRate: li.taxRate, taxAmount: 0 };
      existing.taxableAmount += li.amount * li.quantity - li.discount;
      existing.taxAmount += li.taxAmount;
      taxGroups.set(tt, existing);
    }
    const taxSummary = Array.from(taxGroups.entries()).map(([taxType, data]) => ({
      taxType,
      taxableAmount: Math.round(data.taxableAmount * 100) / 100,
      taxRate: data.taxRate,
      taxAmount: Math.round(data.taxAmount * 100) / 100,
    }));

    // 4. Resolve student + account. The studentInfo HTTP call is per-
    //    student (we don't cache here because the worker passes
    //    studentInfo via the dto.gradeLevel field when known; the
    //    fall-back identity hop for grade resolution is unavoidable
    //    in V1).
    const contextWithSchool = { ...context, schoolId };
    const studentInfo = await this.identityClient.getStudentInfo(dto.studentId, contextWithSchool);
    if (!studentInfo) {
      throw new NotFoundException(`Student not found: ${dto.studentId}`);
    }
    const resolvedStudentName = `${studentInfo.firstName} ${studentInfo.lastName}`.trim();
    const snapshotGradeLevel: string | undefined =
      dto.gradeLevel || studentInfo.gradeLevel || undefined;
    const gradeLevelResolutionStatus: 'resolved' | 'unresolved' = snapshotGradeLevel
      ? 'resolved'
      : 'unresolved';

    const account = await this.studentAccountsService.getOrCreate(
      schoolId,
      dto.studentId,
      resolvedStudentName,
      context,
    );

    const now = new Date().toISOString();
    const issuedDate = dto.issuedDate || now.split('T')[0];

    // 5. Worker creates DRAFTS only (operator decision 1).
    const entity = createInvoiceEntity(
      context.tenantId,
      schoolId,
      {
        invoiceNumber: dto.preAllocatedInvoiceNumber,
        studentAccountId: account.accountId,
        studentId: account.studentId,
        studentName: resolvedStudentName,
        schoolName: dto.cachedSchoolName,
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
        taxSummary,
        enrollmentId: dto.enrollmentId,
        gradeLevel: snapshotGradeLevel,
        gradeLevelResolutionStatus,
        ...(agreementPlan
          ? {
              feeOverrideMode: 'agreement' as const,
              agreementId: agreementPlan.agreementId,
              agreementVersion: agreementPlan.agreementVersion,
            }
          : {}),
        statusHistory: [],
        currency: dto.cachedCurrency,
      },
      context.userId,
    );

    await this.dynamoDBClient.putItem(client, entity);

    this.eventsService
      .publishInvoiceGenerated(
        context.tenantId,
        schoolId,
        entity.invoiceId,
        dto.preAllocatedInvoiceNumber,
        account.studentId,
        entity.grandTotal,
      )
      .catch((err) => this.logger.error(`Failed to publish InvoiceGenerated: ${err.message}`));

    return invoiceEntityToDto(entity);
  }

  /**
   * Sprint E.4 — worker-facing duplicate-detection wrapper.
   *
   * Promotes the existing `private hasDuplicateInvoice` to a public
   * entry-point so `BulkInvoiceGenerateWorker` can call it pre-generate
   * (same shape the existing sync `generateBulk` uses). Keeping the
   * existing private method untouched preserves the existing call sites.
   */
  async checkDuplicateInvoice(
    schoolId: string,
    studentId: string,
    feeStructureIds: string[],
    billingPeriod: string | undefined,
    context: RequestContext,
  ): Promise<boolean> {
    return this.hasDuplicateInvoice(schoolId, studentId, feeStructureIds, billingPeriod, context);
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
   * EPIC-FB FB-0.3(a) — bulk-cancel stale draft invoices (live finding L3:
   * 94% of pilot invoices were drafts with no lifecycle policy).
   *
   * Only `status = 'draft'` rows are eligible — enforced twice: the GSI1
   * query targets the `INVOICE#draft#` sort-key prefix, and each cancel
   * carries a `#status = :draft` ConditionExpression so a draft issued
   * between query and write is skipped, never cancelled.
   *
   * `dryRun` (default true at the controller) reports what WOULD be
   * cancelled with zero writes. Non-dry-run cancels via the existing
   * status-transition shape (statusHistory entry with the acting operator
   * + reason 'bulk_draft_cleanup'), in batches of individual UpdateItems
   * (no transactWrite — items are independent, so per-item optimistic
   * conditions respect DDB limits without a 100-item ceiling).
   */
  async bulkCancelDrafts(
    schoolId: string,
    options: { olderThanDays?: number; academicYear?: string; dryRun: boolean },
    context: RequestContext,
  ): Promise<{ matched: number; cancelled: number; dryRun: boolean; sample: string[] }> {
    if (
      options.olderThanDays !== undefined &&
      (!Number.isInteger(options.olderThanDays) || options.olderThanDays < 0)
    ) {
      throw new BadRequestException('olderThanDays must be a non-negative integer');
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};
    if (options.academicYear) {
      filterParts.push('academicYear = :academicYear');
      filterValues[':academicYear'] = options.academicYear;
    }
    if (options.olderThanDays !== undefined) {
      // Draft "age" anchors on createdAt (drafts carry an issuedDate that is
      // just the creation day, so createdAt is the unambiguous clock).
      const cutoff = new Date(
        Date.now() - options.olderThanDays * 24 * 60 * 60 * 1000,
      ).toISOString();
      filterParts.push('createdAt <= :cutoff');
      filterValues[':cutoff'] = cutoff;
    }

    // Collect matching drafts. MAX_ITEMS guards against runaway partitions;
    // the live worst case (1,190 drafts) is well inside it.
    const MAX_ITEMS = 10_000;
    const matchedDrafts: InvoiceEntity[] = [];
    let lastKey: Record<string, any> | undefined;
    do {
      const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
        client,
        'GSI1',
        gsi1pk,
        'INVOICE#draft#',
        'begins_with',
        filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
        Object.keys(filterValues).length > 0 ? filterValues : undefined,
        undefined,
        500,
        false,
        lastKey,
      );
      matchedDrafts.push(...result.items);
      lastKey = result.lastEvaluatedKey
        ? JSON.parse(Buffer.from(result.lastEvaluatedKey, 'base64').toString())
        : undefined;
    } while (lastKey && matchedDrafts.length < MAX_ITEMS);

    const sample = matchedDrafts.slice(0, 10).map(inv => inv.invoiceNumber);

    if (options.dryRun) {
      this.logger.log(
        `bulkCancelDrafts DRY RUN schoolId=${schoolId} matched=${matchedDrafts.length}`,
      );
      return { matched: matchedDrafts.length, cancelled: 0, dryRun: true, sample };
    }

    let cancelled = 0;
    const BATCH_SIZE = 10;
    for (let i = 0; i < matchedDrafts.length; i += BATCH_SIZE) {
      const batch = matchedDrafts.slice(i, i + BATCH_SIZE);
      const results = await Promise.allSettled(
        batch.map(inv => this.cancelDraftInvoice(client, inv, context)),
      );
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === 'fulfilled') {
          cancelled++;
        } else {
          const reason = result.reason as { name?: string; message?: string } | undefined;
          if (reason?.name === 'ConditionalCheckFailedException') {
            // Draft was issued/mutated between query and write — correct skip.
            continue;
          }
          this.logger.warn(
            `bulkCancelDrafts: cancel failed invoiceId=${batch[j].invoiceId}: ` +
              `${reason?.message ?? 'Unknown error'}`,
          );
        }
      }
    }

    this.logger.log(
      `bulkCancelDrafts schoolId=${schoolId} matched=${matchedDrafts.length} cancelled=${cancelled}`,
    );
    return { matched: matchedDrafts.length, cancelled, dryRun: false, sample };
  }

  private async cancelDraftInvoice(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    invoice: InvoiceEntity,
    context: RequestContext,
  ): Promise<void> {
    const now = new Date().toISOString();
    await this.dynamoDBClient.updateItem(
      client,
      invoice.tenantId,
      invoice.entityKey,
      'SET #status = :cancelled, gsi1sk = :gsi1sk, updatedAt = :now, updatedBy = :by, ' +
        '#v = #v + :one, statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :historyEntry)',
      {
        ':cancelled': 'cancelled',
        ':draft': 'draft',
        ':gsi1sk': GSIKeyBuilder.entitySort('INVOICE', `cancelled#${invoice.dueDate}`),
        ':now': now,
        ':by': context.userId,
        ':one': 1,
        ':currentVersion': invoice.version,
        ':emptyList': [],
        ':historyEntry': [
          {
            from: 'draft',
            to: 'cancelled',
            changedAt: now,
            changedBy: context.userId,
            reason: 'bulk_draft_cleanup',
          },
        ],
      },
      '#status = :draft AND #v = :currentVersion',
      { '#status': 'status', '#v': 'version' },
    );

    this.eventsService
      .publishInvoiceStatusChanged(
        invoice.tenantId,
        invoice.schoolId,
        invoice.invoiceId,
        'draft',
        'cancelled',
      )
      .catch(err =>
        this.logger.error(`Failed to publish InvoiceStatusChanged: ${err.message}`),
      );
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
