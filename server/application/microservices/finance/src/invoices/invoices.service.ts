import { Injectable, Logger, NotFoundException, BadRequestException, ConflictException, PayloadTooLargeException } from '@nestjs/common';
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { v4 as uuid } from 'uuid';
import { AuditLoggerService, AuditAction } from '@app/logger';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { FinanceAuditService } from '../common/services/finance-audit.service';
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
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext, decodeCursor, encodeCursor } from '../common/entities/base.entity';
import { invoiceEntityToDto, todayIsoDate } from '../common/mappers/invoice.mapper';
import { FinanceErrors } from '../common/errors/finance-errors';
import {
  AgreementResolverService,
  AgreementResolutionMemo,
} from '../agreements/agreement-resolver.service';
import {
  SiblingCountResolver,
  SiblingCountMemo,
} from '../discount-rules/sibling-count.resolver';
import type { DiscountRuleEntity } from '../common/entities/discount-rule.entity';
import type { BillingAgreementEntity } from '../common/entities/billing-agreement.entity';
import { createAgreementTermLockEntity } from '../common/entities/billing-agreement.entity';
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
  /**
   * Round-3 fix A — version-chain id (`versionParentId || agreementId` of
   * the RESOLVED agreement). Stamped on the invoice entity so the per-term
   * guard blocks across FB-3.6 versions (each version is a NEW agreementId
   * in the same chain).
   */
  agreementChainId: string;
  /**
   * BH-1.1 (epic §3.6 R11) — the RESOLVED agreement's `effectiveTo`
   * (AD ISO YYYY-MM-DD). Threaded out so the write path can compute the
   * per-term lock's DDB TTL (`agreementLockTtl(effectiveTo)`) without
   * re-hydrating the agreement.
   */
  agreementEffectiveTo: string;
  /** Requested fee structures with feeType ∈ coveredFeeTypes — produce NO standard lines. */
  suppressedFeeStructureIds: string[];
  /** The covered feeTypes actually present in the request (partition result). */
  coveredFeeTypes: string[];
  /** Replacement lines (fixed_total allocation OR per_student matching lines). */
  agreementLines: InvoiceLineItemData[];
}

/**
 * EPIC-FB BH-1.2/1.3 — marker returned by `planAgreementPricing` when the
 * operator bypassed an ACTIVE agreement (`overrideAgreement: true`). The
 * invoice is standard-priced (no agreement fields), so the queryable
 * `AGREEMENT_BYPASSED` audit row (FinanceAuditService) can only be written
 * AFTER the invoice entity exists (it needs the real `invoiceId`). The plan
 * hook therefore threads this marker back to `generate()` /
 * `generateForBulkWorker()`, which emit the queryable row post-persist. The
 * immediate CloudWatch `AuditLoggerService.log` still fires inside the hook.
 */
export interface AgreementBypassMarker {
  bypassed: true;
  agreementId: string;
  agreementTitle?: string;
  requestedFeeStructureIds: string[];
}

function isBypassMarker(
  plan: AgreementPricingPlan | AgreementBypassMarker | null,
): plan is AgreementBypassMarker {
  return plan !== null && (plan as AgreementBypassMarker).bypassed === true;
}

/** Statuses that end an invoice's financial life for the duplicate-billing guard. */
const AGREEMENT_GUARD_DEAD_STATUSES = new Set(['cancelled', 'written_off']);

// Review F2 — per-student GSI2 invoice scans paginate to exhaustion with
// this page size and a hard safety cap (2,500 rows) before aborting to
// manual review.
const GSI2_INVOICE_SCAN_PAGE_SIZE = 100;
const GSI2_INVOICE_SCAN_MAX_PAGES = 25;

// Issue #466 — a filtered list read must not starve. DynamoDB applies
// `Limit` BEFORE the FilterExpression, so a single page can return zero
// matches while matching rows sit deeper in the partition. Filtered list
// paths therefore read forward in pages until the caller's limit is
// filled, the partition is exhausted, or this page cap is reached.
const LIST_FILTER_PAGE_SIZE = 200;
const LIST_FILTER_MAX_PAGES = 25;

/**
 * EPIC-FB FB-5.2 — per-request/per-job memo for the sibling discount
 * evaluator (caller-owned, same pattern as `AgreementResolutionMemo`):
 * one rule-list fetch per (tenant, school) and one family resolution per
 * (tenant, school, student) per run. Create via
 * `createSiblingDiscountMemo()` at job start; drop when the run ends.
 */
export interface SiblingDiscountMemo {
  /** `{tenantId}#{schoolId}` → active sibling rules. Successes only — a fetch failure is retried next call. */
  rules: Map<string, DiscountRuleEntity[]>;
  counts: SiblingCountMemo;
  /**
   * BH-1.4 — `{tenantId}#{schoolId}#{ayLabel}` → the DEFINITIVE AY resolution
   * outcome (`resolved` | `not_found`). ONLY definitive outcomes are memoized
   * (identity responded, so re-asking within the run yields the same answer);
   * the `unavailable` (transient) outcome is deliberately NOT stored so one
   * identity blip can't disable AY scoping for the rest of a bulk run.
   */
  academicYearIds: Map<string, AcademicYearResolution>;
}

/**
 * BH-1.4 — 3-state result of resolving a generation AY *label* to the
 * rule-pinned `academicYearId`. Distinguishes a DEFINITIVE no-match
 * (`not_found` — identity responded, no year matches: year-pinned rules must
 * NOT apply) from a TRANSIENT outage (`unavailable` — degrade to unscoped,
 * retry next invoice). Conflating the two reopened the BH-1.4 money bug (a
 * stale prior-year rule applying on a definitive no-match).
 */
export type AcademicYearResolution =
  | { kind: 'resolved'; yearId: string }
  | { kind: 'not_found' }
  | { kind: 'unavailable' };

export function createSiblingDiscountMemo(): SiblingDiscountMemo {
  return { rules: new Map(), counts: new Map(), academicYearIds: new Map() };
}

// ============================================================================
// EPIC-FB FB-5.4 — invoice provenance ("why") trace response contracts.
// Local contracts (no shared-types schema yet — backend-first, same
// precedent as FamilyOpenInvoicesResponseDto). P1d: no `isActive` anywhere.
// ============================================================================

export interface InvoiceProvenanceSuppressedFeeStructureDto {
  id: string;
  /** Absent when the referent no longer resolves (deleted row) — id-only degrade. */
  name?: string;
  feeType?: string;
}

export interface InvoiceProvenanceLineDto {
  lineId: string;
  description: string;
  source: 'fee_structure' | 'agreement' | 'custom';
  feeStructureId?: string;
  feeStructureVersion?: number;
  feeStructureName?: string;
  agreementId?: string;
  agreementVersion?: number;
  agreementTitle?: string;
  suppressedFeeStructures?: InvoiceProvenanceSuppressedFeeStructureDto[];
  discount?: {
    amount: number;
    reason?: string;
    discountRuleId?: string;
    ruleName?: string;
  };
}

/**
 * EPIC-FB BH-1.2/1.3 — one operator agreement-bypass event on this invoice.
 * Reconstructed from the queryable `finance.agreement.bypassed` audit rows
 * (FinanceAuditService), which the override write path now persists with the
 * real invoiceId. Absent/empty for invoices that were never bypassed.
 */
export interface InvoiceProvenanceOverrideDto {
  agreementId: string;
  agreementTitle?: string;
  requestedFeeStructureIds: string[];
  bypassedAt: string;
  operatorId: string;
}

export interface InvoiceProvenanceDto {
  invoiceId: string;
  invoiceNumber: string;
  feeOverrideMode?: 'catalog' | 'agreement';
  agreementId?: string;
  agreementVersion?: number;
  lines: InvoiceProvenanceLineDto[];
  /**
   * BH-1.2/1.3 — agreement-bypass events for this invoice (from queryable
   * audit rows). Omitted when there are none OR the audit query is
   * unavailable (degrade, WARN, never 5xx).
   */
  overrides?: InvoiceProvenanceOverrideDto[];
}

/**
 * The amounts an active agreement substitutes for the catalog fees it
 * covers, for one student.
 *
 * Extracted so `planAgreementPricing` (what actually gets billed) and
 * `bulkPreview` (what the operator is shown before billing) cannot drift.
 * Issue #465: the wizard previewed agreement-covered students at catalog
 * price, so a family on a NPR 20,000 agreement previewed at NPR 33,000.
 * Two implementations of the same money question is how that happens, so
 * there is now one.
 */
/**
 * The live invoice this agreement chain already priced for the student, if
 * any. Agreements bill once per term per version CHAIN (FB-3.6 mints a new
 * agreementId per version), so the chain is the primary match and the
 * per-version id is a belt-and-braces OR.
 *
 * Split out of `assertNoExistingAgreementInvoice` so `bulkPreview` can ask
 * the same question without throwing (issue #465): the preview previously
 * reported these students as eligible, then generation rejected every one
 * of them with 409 AGREEMENT_ACTIVE.
 */
/**
 * Per-student agreement projection returned by `bulkPreview` (#465). The
 * caller totals a batch as:
 *   catalog(requested structures NOT in suppressedFeeStructureIds)
 *     + agreementAmount
 * so the number an operator confirms is the number that will be billed.
 */
export interface PreviewBillingSource {
  studentId: string;
  billingSource: 'standard' | 'agreement' | 'mixed';
  /** Requested feeTypes the agreement covers. Absent when standard. */
  coveredFeeTypes?: string[];
  /** Requested fee structures the agreement replaces. Absent when standard. */
  suppressedFeeStructureIds?: string[];
  /** What replaces them, in the tenant currency. Absent when standard. */
  agreementAmount?: number;
  /** This agreement already priced an invoice this term — generation will 409. */
  agreementBlocked?: boolean;
}

export function findAgreementInvoiceConflict(
  invoices: Array<{ agreementChainId?: string; agreementId?: string; status: string; invoiceId: string; invoiceNumber: string }>,
  agreementId: string,
  agreementChainId: string,
) {
  return invoices.find(
    (inv) =>
      (inv.agreementChainId === agreementChainId || inv.agreementId === agreementId) &&
      !AGREEMENT_GUARD_DEAD_STATUSES.has(inv.status),
  );
}

export function agreementReplacementLines(
  agreement: {
    title: string;
    terms:
      | { agreementType: 'fixed_total'; totalAmount: number }
      | { agreementType: 'per_student'; lines: Array<{ studentId: string; feeType?: string; amount: number }> };
  },
  allocationForStudent: number | null,
  studentId: string,
  coveredFeeTypes: string[],
): Array<{ feeType?: string; description: string; amount: number }> {
  if (agreement.terms.agreementType === 'fixed_total') {
    // `null` allocation = member covered for suppression purposes but with
    // no replacement amount (resolver contract) — suppress only.
    if (allocationForStudent === null) return [];
    return [{
      description: `${agreement.title} (family agreement)`,
      amount: Math.round(allocationForStudent * 100) / 100,
    }];
  }

  const out: Array<{ feeType?: string; description: string; amount: number }> = [];
  for (const line of agreement.terms.lines) {
    if (line.studentId !== studentId) continue;
    // Matching = feeType ∈ the partitioned covered set (settled semantics
    // 5b). Lump-sum lines (no feeType) never match.
    if (line.feeType === undefined || !coveredFeeTypes.includes(line.feeType)) continue;
    out.push({
      feeType: line.feeType,
      description: `${agreement.title} — ${line.feeType} (family agreement)`,
      amount: Math.round(line.amount * 100) / 100,
    });
  }
  return out;
}

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
    // FB-5.2 — same spec-harness-tolerance rationale as the resolver above.
    private readonly siblingCountResolver?: SiblingCountResolver,
    // BH-1.2/1.3 — queryable AGREEMENT_BYPASSED audit rows + provenance
    // overrides[]. Optional (`?`) with the same spec-harness rationale: the
    // golden/agreement/sibling/provenance harnesses construct this service
    // with positional mocks and don't pass it. At runtime Nest DI always
    // supplies the provider (every module that locally provides
    // InvoicesService already provides FinanceAuditService — for its
    // StudentAccountsService dep; pinned by module-wiring.spec.ts).
    private readonly financeAuditService?: FinanceAuditService,
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
    feeStructures: Array<{ feeStructureId: string; feeType?: string }>,
    overrideAgreement: boolean | undefined,
    context: RequestContext,
    memo?: AgreementResolutionMemo,
  ): Promise<AgreementPricingPlan | AgreementBypassMarker | null> {
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
      const requestedFeeStructureIds = feeStructures.map((fs) => fs.feeStructureId);
      // Immediate SIEM CloudWatch line (unchanged — pinned by
      // agreement.spec.ts). The QUERYABLE FinanceAuditService row can't be
      // written here (no invoiceId yet); the returned marker threads the
      // bypass back to the caller, which emits it post-persist (BH-1.2/1.3).
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
          requestedFeeStructureIds,
        },
      );
      return {
        bypassed: true,
        agreementId: agreement.agreementId,
        agreementTitle: agreement.title,
        requestedFeeStructureIds,
      };
    }

    const coveredTypeSet = new Set<string>(agreement.coveredFeeTypes as string[]);
    const suppressed = feeStructures.filter(
      (fs) => fs.feeType !== undefined && coveredTypeSet.has(fs.feeType),
    );
    if (suppressed.length === 0) return null;

    const suppressedFeeStructureIds = suppressed.map((fs) => fs.feeStructureId);
    const coveredFeeTypes = [...new Set(suppressed.map((fs) => fs.feeType as string))];

    // Round-3 fix A — the per-term guard keys on the version CHAIN, not the
    // per-version agreementId (FB-3.6 mints a new id per version).
    const agreementChainId = agreement.versionParentId || agreement.agreementId;

    await this.assertNoExistingAgreementInvoice(
      studentId,
      agreement.agreementId,
      agreementChainId,
      coveredFeeTypes,
      context,
    );

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
    const agreementLines: InvoiceLineItemData[] = agreementReplacementLines(
      agreement,
      allocationForStudent,
      studentId,
      coveredFeeTypes,
    ).map((line) => ({
      ...baseLine,
      id: uuid(),
      feeStructureId: uuid(),
      ...(line.feeType !== undefined ? { feeType: line.feeType } : {}),
      description: line.description,
      amount: line.amount,
      total: line.amount,
    }));

    return {
      agreementId: agreement.agreementId,
      agreementVersion: agreement.version,
      agreementChainId,
      agreementEffectiveTo: agreement.effectiveTo,
      suppressedFeeStructureIds,
      coveredFeeTypes,
      agreementLines,
    };
  }

  /**
   * FB-3.4 duplicate-billing guard. GSI2 (student scope, same query shape
   * as `hasDuplicateInvoice`).
   *
   * Review F4 (owner decision 2026-07-05): agreement amounts are PER-TERM
   * negotiated totals — an agreement prices ONCE per term per student, so
   * ANY non-cancelled/non-written-off invoice carrying this agreementId
   * for this student conflicts, REGARDLESS of billingPeriod label.
   * `billingFrequency` is descriptive payment-plan metadata; installments
   * happen via partial payments against the one per-term invoice.
   *
   * Round-3 fix A (F4 residual): "once per term" holds per version CHAIN,
   * not per version — FB-3.6 versioning mints a NEW agreementId, so the
   * primary match is `inv.agreementChainId === agreementChainId`. The
   * `inv.agreementId === agreementId` equality stays as a belt-and-braces
   * OR for any row lacking a chainId (none exist today — nothing is
   * deployed anywhere — but the OR costs nothing and hardens against
   * hand-written rows). KNOWN residual: the guard is read-then-put, so two
   * CONCURRENT generations can still double-bill (accepted V1 TOCTOU risk;
   * follow-up = conditional per-(chain, student, term) lock row written in
   * the invoice put — epic §3.6 R11 / Appendix C follow-ups).
   *
   * Review F2: pages are read to exhaustion — a single limit-100 page
   * could miss the conflicting row (DDB applies Limit before any
   * filtering; see dynamodb-client.service.ts `query` docstring).
   */
  private async assertNoExistingAgreementInvoice(
    studentId: string,
    agreementId: string,
    agreementChainId: string,
    coveredFeeTypes: string[],
    context: RequestContext,
  ): Promise<void> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const invoices = await this.queryStudentInvoicesExhaustive(
      client,
      studentId,
      undefined,
      undefined,
      undefined,
      false,
      context,
    );

    const conflict = findAgreementInvoiceConflict(invoices, agreementId, agreementChainId);

    if (conflict) {
      throw new ConflictException({
        code: FinanceErrors.AGREEMENT_ACTIVE,
        message:
          'This agreement already priced an invoice this term; agreements bill once per term. ' +
          'Pass overrideAgreement to bill standard fees anyway.',
        agreementId,
        existingInvoiceId: conflict.invoiceId,
        existingInvoiceNumber: conflict.invoiceNumber,
        coveredFeeTypes,
      });
    }
  }

  /**
   * A cursor that resumes immediately AFTER `item` in `indexName` order.
   *
   * DynamoDB's own `LastEvaluatedKey` is page-granular. A filtered read
   * that fills its limit mid-page must not hand that back: the rows it
   * truncated sit between the last returned row and the page boundary and
   * would be skipped. Every GSI on this table projects ALL, so the four
   * key attributes needed for an `ExclusiveStartKey` are on the item.
   */
  private cursorAfterItem(indexName: string, item: InvoiceEntity): string {
    const slot = indexName.toLowerCase().replace(/^gsi/, '');
    const row = item as unknown as Record<string, unknown>;
    return encodeCursor({
      tenantId: row.tenantId,
      entityKey: row.entityKey,
      [`gsi${slot}pk`]: row[`gsi${slot}pk`],
      [`gsi${slot}sk`]: row[`gsi${slot}sk`],
    });
  }

  /**
   * Issue #466 — one page of invoices that actually contains `limit`
   * matches, rather than `limit` rows read before filtering.
   *
   * Unfiltered reads are already exact (without a FilterExpression
   * DynamoDB's `Limit` is the number of rows RETURNED), so that path stays
   * a single query and is byte-identical to the previous behaviour.
   */
  private async queryInvoicesFilled(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    indexName: string,
    pkValue: string,
    filterExpression: string | undefined,
    filterValues: Record<string, any> | undefined,
    filterNames: Record<string, string> | undefined,
    limit: number,
    cursor: string | undefined,
  ): Promise<{ items: InvoiceEntity[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    if (!filterExpression) {
      const single = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
        client, indexName, pkValue, 'INVOICE', 'begins_with',
        undefined, undefined, undefined, limit, false, decodeCursor(cursor),
      );
      return {
        items: single.items,
        lastEvaluatedKey: single.lastEvaluatedKey,
        hasMore: single.hasMore,
      };
    }

    const matches: InvoiceEntity[] = [];
    let exclusiveStartKey = decodeCursor(cursor);
    const pageSize = Math.max(limit, LIST_FILTER_PAGE_SIZE);

    for (let page = 0; page < LIST_FILTER_MAX_PAGES; page++) {
      const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
        client, indexName, pkValue, 'INVOICE', 'begins_with',
        filterExpression, filterValues, filterNames,
        pageSize, false, exclusiveStartKey,
      );
      matches.push(...result.items);

      if (matches.length >= limit) {
        const items = matches.slice(0, limit);
        const truncated = matches.length > limit;
        if (!truncated && !result.lastEvaluatedKey) {
          return { items, lastEvaluatedKey: undefined, hasMore: false };
        }
        return {
          items,
          lastEvaluatedKey: this.cursorAfterItem(indexName, items[items.length - 1]),
          hasMore: true,
        };
      }

      if (!result.lastEvaluatedKey) {
        return { items: matches, lastEvaluatedKey: undefined, hasMore: false };
      }
      exclusiveStartKey = decodeCursor(result.lastEvaluatedKey);
    }

    // Page cap hit with the limit unfilled. Say so and hand back a
    // resumable cursor rather than implying the result set is complete.
    return {
      items: matches,
      lastEvaluatedKey: exclusiveStartKey ? encodeCursor(exclusiveStartKey) : undefined,
      hasMore: true,
    };
  }

  /**
   * Review F2 — read a student's GSI2 INVOICE partition to exhaustion.
   * DynamoDB applies `Limit` BEFORE the FilterExpression (see the
   * dynamodb-client.service.ts `query` docstring), so a single limit-100
   * page can return zero matches while matching rows sit deeper in the
   * partition — silent page starvation. Paginate on lastEvaluatedKey
   * (page size 100, hard cap 25 pages); if rows remain past the cap,
   * throw an operational 409 telling staff to review manually — never
   * silently pass.
   */
  private async queryStudentInvoicesExhaustive(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    studentId: string,
    filterExpression: string | undefined,
    expressionAttributeValues: Record<string, any> | undefined,
    expressionAttributeNames: Record<string, string> | undefined,
    scanIndexForward: boolean,
    context: RequestContext,
  ): Promise<InvoiceEntity[]> {
    const gsi2pk = GSIKeyBuilder.studentScope(context.tenantId, studentId);
    const items: InvoiceEntity[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    for (let page = 0; page < GSI2_INVOICE_SCAN_MAX_PAGES; page++) {
      const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
        client,
        'GSI2',
        gsi2pk,
        'INVOICE',
        'begins_with',
        filterExpression,
        expressionAttributeValues,
        expressionAttributeNames,
        GSI2_INVOICE_SCAN_PAGE_SIZE,
        scanIndexForward,
        exclusiveStartKey,
      );
      items.push(...result.items);
      if (!result.lastEvaluatedKey) return items;
      exclusiveStartKey = decodeCursor(result.lastEvaluatedKey);
    }

    throw new ConflictException({
      code: FinanceErrors.INVOICE_SCAN_LIMIT_EXCEEDED,
      message:
        `Student ${studentId} has more than ` +
        `${GSI2_INVOICE_SCAN_MAX_PAGES * GSI2_INVOICE_SCAN_PAGE_SIZE} invoice rows; ` +
        'automated checking stopped at the safety cap. Review the student\'s invoices manually.',
      studentId,
    });
  }

  /**
   * EPIC-FB FB-5.2 — active `sibling`-condition rules for a school. Same
   * GSI1 `DISCOUNT_RULE` + `isActive` query shape as
   * `DiscountRulesService.getApplicableDiscounts` (queried directly so the
   * evaluator carries no extra module wiring). Memoized per request/job on
   * success only — a transient fetch failure returns `[]` (WARN) without
   * memoizing, so one blip can't disable discounts for a whole bulk run.
   *
   * AY scoping (BH-1.4): this fetch returns ALL active sibling rules for the
   * school; the caller (`applySiblingRuleDiscounts`) filters to the rules
   * pinned to the invoice's resolved academic year. Generation carries the AY
   * *label* (`dto.academicYear`, e.g. '2082-83') while rules pin an
   * `academicYearId` UUID; finance resolves the label→id via identity
   * (`resolveAcademicYearId`, a 3-state result) and filters here per outcome:
   * `resolved` → only rules pinned to that year; `not_found` (label is
   * definitively absent) → only UNPINNED rules apply, so stale year-pinned
   * discounts never leak; `unavailable` (identity down) → UNSCOPED matching
   * over all rules (WARN). Only the transient `unavailable` path degrades to
   * unscoped, so a blip never 5xxes generation nor silently all-drops
   * discounts, while a definitive no-match stays correctly year-scoped.
   */
  /**
   * BH-1.4 — resolve the generation AY *label* (`dto.academicYear`, e.g.
   * '2082-83') to the `academicYearId` UUID that sibling-discount rules pin.
   * Academic years are owned by identity; finance resolves over HTTP
   * (`getAcademicYears`), memoized per (school, label).
   *
   * Returns a 3-state {@link AcademicYearResolution} so the caller can treat
   * the three outcomes DIFFERENTLY (BH-1.4 hardening):
   *   - `getAcademicYears` returned `null` (identity unavailable) →
   *     `{ kind: 'unavailable' }`. NOT memoized — retried next invoice.
   *   - returned an array, a year matches → `{ kind: 'resolved', yearId }`.
   *   - returned an array, no year matches (or label absent) →
   *     `{ kind: 'not_found' }` — a DEFINITIVE no-match.
   * Both definitive outcomes (`resolved` / `not_found`) are memoized (identity
   * responded — the answer is stable within the run); `unavailable` is NOT.
   */
  private async resolveAcademicYearId(
    schoolId: string,
    academicYearLabel: string | undefined,
    context: RequestContext,
    memo?: SiblingDiscountMemo,
  ): Promise<AcademicYearResolution> {
    // An absent label is a definitive "no year to scope to" — nothing to
    // resolve, and no identity call needed.
    if (!academicYearLabel) return { kind: 'not_found' };
    const memoKey = `${context.tenantId}#${schoolId}#${academicYearLabel}`;
    const memoized = memo?.academicYearIds.get(memoKey);
    if (memoized) return memoized;

    const years = await this.identityClient.getAcademicYears(schoolId, context);
    if (years === null) {
      // Identity was UNAVAILABLE — transient. Do NOT memoize: a later invoice
      // in the same bulk run must retry rather than inherit the outage.
      return { kind: 'unavailable' };
    }

    // BH-1.4 field-name join — generation carries the AY *label*
    // (dto.academicYear, e.g. '2082-83'), but the enrollment webhook passes
    // `academicYear = params.academicYearId` (a UUID). Match on EITHER the
    // yearId or the name so both callers resolve; identity returns `yearId`,
    // discount rules store the same id under `academicYearId`.
    const match = years.find(
      (y) => y.yearId === academicYearLabel || y.name === academicYearLabel,
    );
    const result: AcademicYearResolution = match
      ? { kind: 'resolved', yearId: match.yearId }
      : { kind: 'not_found' };
    // Memoize the DEFINITIVE outcome — identity responded, so the answer is
    // stable for this label within the per-run memo.
    memo?.academicYearIds.set(memoKey, result);
    return result;
  }

  private async fetchActiveSiblingRules(
    schoolId: string,
    context: RequestContext,
    memo?: SiblingDiscountMemo,
  ): Promise<DiscountRuleEntity[]> {
    const memoKey = `${context.tenantId}#${schoolId}`;
    const memoized = memo?.rules.get(memoKey);
    if (memoized) return memoized;

    try {
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
      const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);
      const result = await this.dynamoDBClient.queryGSI<DiscountRuleEntity>(
        client,
        'GSI1',
        gsi1pk,
        'DISCOUNT_RULE',
        'begins_with',
        'isActive = :isActive',
        { ':isActive': true },
        undefined,
        100,
        false,
      );
      const siblingRules = result.items.filter((r) => r.condition?.type === 'sibling');
      memo?.rules.set(memoKey, siblingRules);
      return siblingRules;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `fetchActiveSiblingRules: rule fetch failed schoolId=${schoolId}: ` +
          `${message.slice(0, 200)} — no sibling discount this call`,
      );
      return [];
    }
  }

  /**
   * EPIC-FB FB-5.2 (live finding L5) — auto-apply `sibling` discount rules
   * to the STANDARD line items of one invoice, in place. Runs AFTER
   * `planAgreementPricing` partitioned the request and BEFORE totals
   * aggregation, on the standard lines only — agreement replacement lines
   * and operator custom lines are appended afterwards and are never
   * touched.
   *
   * Precedence (epic §3.3: agreement > discount rule > manual discount):
   *   - Agreement-covered feeTypes are exempt by construction — their
   *     standard lines were suppressed before this runs.
   *   - A matching rule REPLACES any operator-supplied manual discount on
   *     the line. Precedence is authority order, not max(): the school's
   *     configured rule is the governing instrument even when the manual
   *     figure was larger (pinned by spec).
   *
   * Rule selection per line: `count >= minSiblings` (count includes the
   * subject student — see SiblingCountResolver) AND
   * `feeType ∈ applicableFeeTypes`. Multiple matches: highest `priority`
   * value wins, ties broken by lowest discountRuleId for determinism.
   *
   * Math: percentage → base×value/100; fixed → value per line.
   * `maxDiscountAmount` caps PER LINE — a per-invoice cap would make the
   * result depend on line ordering; per-line keeps every line figure
   * self-contained like the rest of the line math. The discount is also
   * clamped to the line subtotal so a fixed rule larger than the line
   * floors it at 0 instead of going negative. Tax is recomputed with the
   * existing discount-before-tax per-line formula, so the discount
   * participates in after-discount tax exactly like a manual discount.
   *
   * Graceful degrade: any unexpected failure logs WARN and leaves every
   * line untouched — sibling discounts must never 5xx generation. Zero
   * sibling rules → zero mutations and zero family lookups (golden
   * contract: no-rule output stays byte-identical).
   */
  private async applySiblingRuleDiscounts(
    schoolId: string,
    studentId: string,
    lineItems: InvoiceLineItemData[],
    billableFeeStructures: Array<{ feeStructureId: string; feeType?: string }>,
    academicYearLabel: string | undefined,
    context: RequestContext,
    memo?: SiblingDiscountMemo,
  ): Promise<void> {
    // Spec-harness tolerance only (see constructor note) — Nest DI always
    // wires the resolver in production.
    if (!this.siblingCountResolver) return;
    if (lineItems.length === 0) return;

    try {
      const allRules = await this.fetchActiveSiblingRules(schoolId, context, memo);
      if (allRules.length === 0) return;

      // BH-1.4 — scope to the invoice's academic year. Resolve the AY label →
      // yearId and switch on the 3-state outcome (money-correctness pivot):
      //   - resolved   → keep ONLY rules pinned to that year (correct scoping).
      //   - not_found  → identity DEFINITIVELY has no matching year, so a
      //     year-pinned rule must NOT fire. Sibling rules are all year-pinned
      //     (academicYearId is required), so filtering to `!academicYearId`
      //     yields zero rules → no sibling discount. WARN once.
      //   - unavailable → identity is DOWN (transient). Degrade to UNSCOPED
      //     (all active sibling rules) so a genuine outage doesn't drop
      //     discounts; NOT memoized, so later invoices retry.
      const ayResolution = await this.resolveAcademicYearId(
        schoolId,
        academicYearLabel,
        context,
        memo,
      );
      let rules: DiscountRuleEntity[];
      switch (ayResolution.kind) {
        case 'resolved':
          rules = allRules.filter((r) => r.academicYearId === ayResolution.yearId);
          break;
        case 'not_found':
          rules = allRules.filter((r) => !r.academicYearId);
          if (rules.length === 0) {
            this.logger.warn(
              `applySiblingRuleDiscounts: AY label '${academicYearLabel ?? '(none)'}' not found ` +
                `for schoolId=${schoolId}; year-pinned sibling rules not applied (no discount)`,
            );
          }
          break;
        case 'unavailable':
          this.logger.warn(
            `applySiblingRuleDiscounts: identity unavailable resolving AY '${academicYearLabel ?? '(none)'}' ` +
              `for schoolId=${schoolId}; sibling discounts unscoped for this generation`,
          );
          rules = allRules;
          break;
      }
      if (rules.length === 0) return;

      const count = await this.siblingCountResolver.getActiveSiblingCount(
        studentId,
        schoolId,
        context,
        memo?.counts,
      );
      const matching = rules.filter((r) => count >= (r.condition.minSiblings ?? 2));
      if (matching.length === 0) return;

      matching.sort(
        (a, b) =>
          b.priority - a.priority || a.discountRuleId.localeCompare(b.discountRuleId),
      );

      // Resolve feeType from the already-fetched fee structures — synthetic
      // ids (custom / agreement lines) resolve to nothing and never match.
      const feeTypeById = new Map<string, string | undefined>(
        billableFeeStructures.map((fs) => [fs.feeStructureId, fs.feeType]),
      );

      for (const li of lineItems) {
        if (li.isCustom || li.agreementId) continue;
        const feeType = feeTypeById.get(li.feeStructureId);
        if (!feeType) continue;
        const rule = matching.find((r) =>
          (r.applicableFeeTypes as string[]).includes(feeType),
        );
        if (!rule) continue;

        const base = li.amount * li.quantity;
        const raw = rule.type === 'percentage' ? (base * rule.value) / 100 : rule.value;
        const capped =
          rule.maxDiscountAmount !== undefined && rule.maxDiscountAmount !== null
            ? Math.min(raw, rule.maxDiscountAmount)
            : raw;
        const discount = Math.round(Math.min(capped, base) * 100) / 100;

        const afterDiscount = base - discount;
        const taxAmount = afterDiscount > 0 ? Math.round(afterDiscount * li.taxRate) / 100 : 0;

        li.discount = discount;
        li.discountReason = `sibling_discount:${rule.name}`;
        li.discountRuleId = rule.discountRuleId;
        li.taxAmount = Math.round(taxAmount * 100) / 100;
        li.total = Math.round((afterDiscount + taxAmount) * 100) / 100;
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `applySiblingRuleDiscounts: degraded (no rule discount applied) ` +
          `schoolId=${schoolId} studentId=${studentId}: ${message.slice(0, 200)}`,
      );
    }
  }

  /**
   * EPIC-FB BH-1.1 (epic §3.6 R11) — persist the invoice entity.
   *
   * Standard (no-agreement) invoices keep the bare `putItem` so the
   * byte-identical golden output is preserved (the golden spec asserts a
   * SINGLE putItem call, no transact). AGREEMENT-priced invoices are written
   * in ONE `TransactWriteItems` alongside a per-term lock row with
   * `attribute_not_exists(entityKey)`, making the duplicate-billing guard
   * atomic: two concurrent generations for the same
   * (schoolId, studentId, agreementChainId) can't both pass the read-then-put
   * `assertNoExistingAgreementInvoice` scan and double-bill — the second
   * transact's lock put fails its condition, DDB cancels the whole transact,
   * and NO invoice is written. That cancellation surfaces as the SAME 409
   * `AGREEMENT_ACTIVE` the read-time guard throws (the guard remains the
   * friendly fast-path; the lock is the race-proof backstop).
   */
  private async persistInvoiceWithAgreementLock(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    entity: InvoiceEntity,
    plan: AgreementPricingPlan,
    context: RequestContext,
  ): Promise<void> {
    const lock = createAgreementTermLockEntity(
      context.tenantId,
      entity.schoolId,
      entity.studentId,
      {
        agreementChainId: plan.agreementChainId,
        agreementId: plan.agreementId,
        effectiveTo: plan.agreementEffectiveTo,
      },
      context.userId,
    );

    const transactItems: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      {
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: lock as unknown as Record<string, unknown>,
          ConditionExpression: 'attribute_not_exists(entityKey)',
        },
      },
      {
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: entity as unknown as Record<string, unknown>,
        },
      },
    ];

    try {
      await this.dynamoDBClient.transactWrite(client, transactItems);
    } catch (error: any) {
      if (error?.name !== 'TransactionCanceledException') throw error;
      // TransactWriteItems returns CancellationReasons positionally — index 0
      // is the lock put. A ConditionalCheckFailed there = a concurrent
      // generation already priced this term (the TOCTOU the read-time guard
      // can't close). Map to the SAME 409 shape (agreements.service.ts
      // executeTransact precedent). Any OTHER cancellation (throughput, a
      // different condition) re-throws the original error so the bulk
      // worker's TransactionCanceledException retry envelope still applies.
      const reasons: Array<{ Code?: string }> = error.CancellationReasons ?? [];
      if (reasons[0]?.Code === 'ConditionalCheckFailed') {
        throw new ConflictException({
          code: FinanceErrors.AGREEMENT_ACTIVE,
          message:
            'This agreement already priced an invoice this term; agreements bill once per term. ' +
            'Pass overrideAgreement to bill standard fees anyway.',
          agreementId: plan.agreementId,
          coveredFeeTypes: plan.coveredFeeTypes,
        });
      }
      throw error;
    }
  }

  /**
   * EPIC-FB BH-1.1 (epic §3.6 R11) — release the per-term lock when an
   * agreement-priced invoice ends its financial life (→ cancelled /
   * written_off). `persistInvoiceWithAgreementLock` writes the
   * `AGREEMENT_TERM_LOCK#{schoolId}#{studentId}#{agreementChainId}` row with
   * `attribute_not_exists(entityKey)` but never deleted it; the read-guard
   * (`assertNoExistingAgreementInvoice`) treats cancelled/written_off as DEAD
   * and ALLOWS re-billing, so a legitimate re-bill after cancel would pass the
   * read-guard then fail the lock Put's condition → spurious 409
   * AGREEMENT_ACTIVE until the TTL (up to a year). Deleting the lock on the
   * status→dead transition makes the atomic lock agree with the guard it backs.
   *
   * Callers route the invoice status update + this lock Delete through ONE
   * transactWrite so a crash can't orphan the lock. DeleteItem on a missing
   * key is idempotent; callers only pass the lock item when
   * `invoice.agreementChainId` is present, so standard invoices skip it
   * entirely (bare updateItem, byte-identical to the pre-fix path).
   */
  private agreementLockDeleteItem(
    invoice: InvoiceEntity,
  ): NonNullable<TransactWriteCommandInput['TransactItems']>[number] {
    return {
      Delete: {
        TableName: this.dynamoDBClient.getTableName(),
        Key: {
          tenantId: invoice.tenantId,
          entityKey: EntityKeyBuilder.agreementTermLock(
            invoice.schoolId,
            invoice.studentId,
            invoice.agreementChainId!,
          ),
        },
      },
    };
  }

  /** A status transition into cancelled / written_off ends an invoice's financial life. */
  private isDeadStatus(status: string): boolean {
    return AGREEMENT_GUARD_DEAD_STATUSES.has(status);
  }

  /**
   * EPIC-FB BH-1.2/1.3 — persist the bypass-marked STANDARD invoice + the
   * QUERYABLE `finance.agreement.bypassed` audit row in ONE `transactWrite`
   * (atomic — both commit or neither).
   *
   * Reviewer option (b): the earlier design persisted the invoice, then wrote
   * the audit row best-effort via `FinanceAuditService.emit`, which SWALLOWS
   * DDB failures — so the riskiest override ("operator bypassed an active
   * agreement, billed standard fees") could end up CloudWatch-only. The
   * transactional put closes that gap: the audit Put lives in the same
   * transaction as the invoice Put, so an audit-write failure fails the whole
   * generation — which would have failed the invoice put anyway → no NEW
   * failure mode, just atomicity. The audit row carries the real invoiceId +
   * studentId so provenance can resolve overrides[] by invoice.
   *
   * The immediate CloudWatch `AuditLoggerService.log(AGREEMENT_BYPASSED)`
   * already fired inside `planAgreementPricing` (unchanged) — the queryable
   * row is the durable, filterable trail.
   *
   * When the audit service isn't wired (spec-harness tolerance), degrades to
   * a bare invoice putItem (same shape the pre-fix standard path used).
   */
  private async persistInvoiceWithBypassAudit(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    entity: InvoiceEntity,
    marker: AgreementBypassMarker,
    schoolId: string,
    studentId: string,
    context: RequestContext,
  ): Promise<void> {
    if (!this.financeAuditService) {
      await this.dynamoDBClient.putItem(client, entity);
      return;
    }

    const auditPut = this.financeAuditService.buildAuditEventTransactItem(
      'finance.agreement.bypassed',
      {
        schoolId,
        studentId,
        invoiceId: entity.invoiceId,
        metadata: {
          agreementId: marker.agreementId,
          ...(marker.agreementTitle ? { agreementTitle: marker.agreementTitle } : {}),
          requestedFeeStructureIds: marker.requestedFeeStructureIds,
        },
      },
      context,
    );

    await this.dynamoDBClient.transactWrite(client, [
      {
        Put: {
          TableName: this.dynamoDBClient.getTableName(),
          Item: entity as unknown as Record<string, unknown>,
        },
      },
      auditPut,
    ]);
  }

  async generate(
    schoolId: string,
    dto: GenerateInvoiceDto & { overrideAgreement?: boolean },
    context: RequestContext,
    agreementMemo?: AgreementResolutionMemo,
    siblingMemo?: SiblingDiscountMemo,
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
    const planOrBypass = await this.planAgreementPricing(
      schoolId,
      dto.studentId,
      billingDate,
      feeStructures,
      dto.overrideAgreement,
      context,
      agreementMemo,
    );
    // A bypass marker (overrideAgreement) is NOT a pricing plan — the invoice
    // is standard-priced. `bypassMarker` is threaded to the post-persist
    // queryable audit emit (BH-1.2/1.3); `agreementPlan` drives the
    // suppression/replacement pricing (null on the bypass + standard paths).
    const bypassMarker = isBypassMarker(planOrBypass) ? planOrBypass : null;
    const agreementPlan = isBypassMarker(planOrBypass) ? null : planOrBypass;
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

    // 3a′. EPIC-FB FB-5.2 — sibling discount rules over the standard lines
    // (agreement/custom lines are appended below and stay exempt —
    // precedence agreement > rule > manual). Runs before totals so the
    // rule discount participates in per-line after-discount tax math.
    await this.applySiblingRuleDiscounts(
      schoolId,
      dto.studentId,
      lineItems,
      billableFeeStructures,
      dto.academicYear,
      context,
      siblingMemo,
    );

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
              agreementChainId: agreementPlan.agreementChainId,
            }
          : {}),
        statusHistory: shouldAutoIssue
          ? [{ from: 'draft', to: 'issued', changedAt: now, changedBy: context.userId }]
          : [],
        currency,
      },
      context.userId,
    );

    // Three distinct write paths (BH-1.1 lock + BH-1.2/1.3 bypass audit):
    //   1. agreement-priced → transactWrite([lockPut, invoicePut]) — atomic
    //      per-term lock is the race-proof duplicate-billing backstop.
    //   2. bypass marker (override + active agreement) → transactWrite(
    //      [invoicePut, auditPut]) — the queryable finance.agreement.bypassed
    //      row commits ATOMICALLY with the invoice, so the riskiest override
    //      can never end up CloudWatch-only (the swallow in emit() allowed
    //      exactly that).
    //   3. plain standard (no agreement, no bypass) → bare putItem — the
    //      GOLDEN path, byte-identical output (goldens carry zero agreements,
    //      so no bypass marker → this branch).
    if (agreementPlan) {
      await this.persistInvoiceWithAgreementLock(client, entity, agreementPlan, context);
    } else if (bypassMarker) {
      await this.persistInvoiceWithBypassAudit(
        client,
        entity,
        bypassMarker,
        schoolId,
        dto.studentId,
        context,
      );
    } else {
      await this.dynamoDBClient.putItem(client, entity);
    }

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
   * EPIC-FB FB-5.5 — optional billingSource filter shared by the three
   * invoice list paths (school GSI1 `list`, per-student GSI2
   * `listForStudents`, grade GSI14 `listBySchoolAndGrade`):
   * `'agreement'` keeps invoices priced by a BillingAgreement (header
   * `agreementId` present); `'standard'` keeps catalog-priced invoices
   * (attribute absent — FB-3.2 back-compat: pre-agreement rows carry
   * nothing). FilterExpression-only on the same key conditions, so absent
   * param leaves every query byte-identical to today.
   */
  private pushBillingSourceFilter(billingSource: string, filterParts: string[]): void {
    if (billingSource === 'agreement') {
      filterParts.push('attribute_exists(agreementId)');
    } else if (billingSource === 'standard') {
      filterParts.push('attribute_not_exists(agreementId)');
    } else {
      throw new BadRequestException(
        `Invalid billingSource '${billingSource}' — expected 'agreement' or 'standard'`,
      );
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
      /**
       * FB-5.5 — applied on the school GSI1 branch only. The studentId
       * branch below applies no filters at all today (status/academicYear
       * included — pre-existing behavior) and stays byte-identical;
       * student-scoped billingSource filtering flows through
       * `listForStudents`.
       */
      billingSource?: 'agreement' | 'standard';
      limit?: number;
      cursor?: string;
      /**
       * #348 — invoice-number lookup. Prefix match on GSI3
       * (`gsi3sk = INVNUM#{number}`), so a pasted number or the leading
       * part of one both work.
       */
      invoiceNumber?: string;
    } = {},
  ): Promise<{ items: Invoice[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const currentSchoolName = await this.resolveCurrentSchoolName(schoolId, context);

    // If studentId provided, query GSI2 for student-scoped invoices
    if (options.studentId) {
      // Review P2-4: this branch ignores every filter (pre-existing for
      // status/academicYear). billingSource is NEW public API — silently
      // returning unfiltered rows would be wrong data, so reject the
      // combination explicitly instead of extending the legacy quirk.
      if (options.billingSource) {
        throw new BadRequestException({
          code: FinanceErrors.INVALID_FILTER_COMBINATION,
          message:
            'billingSource cannot be combined with studentId on this listing; '
            + 'query without studentId or use the student-scoped invoice views.',
        });
      }
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

    // #348 — invoice-number lookup goes to GSI3, the index built for exactly
    // this and until now never read. A prefix query on the sort key, so no
    // FilterExpression and none of the page starvation this endpoint used to
    // have. The search box previously filtered only the rows the client had
    // already loaded, so a real invoice number reported "no results" whenever
    // it was not on the loaded page.
    const invoiceNumber = options.invoiceNumber?.trim();
    if (invoiceNumber) {
      const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
        client,
        'GSI3',
        GSIKeyBuilder.invoiceLookup(context.tenantId, schoolId),
        GSIKeyBuilder.invoiceNumber(invoiceNumber),
        'begins_with',
        undefined,
        undefined,
        undefined,
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
    if (options.billingSource) {
      this.pushBillingSourceFilter(options.billingSource, filterParts);
    }

    const result = await this.queryInvoicesFilled(
      client,
      'GSI1',
      gsi1pk,
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      Object.keys(filterNames).length > 0 ? filterNames : undefined,
      options.limit || 50,
      options.cursor,
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
    options: {
      status?: string;
      academicYear?: string;
      /** FB-5.5 — see pushBillingSourceFilter. */
      billingSource?: 'agreement' | 'standard';
      limit?: number;
      cursor?: string;
    } = {},
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
    if (options.billingSource) {
      this.pushBillingSourceFilter(options.billingSource, filterParts);
    }

    const result = await this.queryInvoicesFilled(
      client,
      'GSI14',
      gsi14pk as string,
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      Object.keys(filterNames).length > 0 ? filterNames : undefined,
      options.limit || 50,
      options.cursor,
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
      /** FB-5.5 — see pushBillingSourceFilter. */
      billingSource?: 'agreement' | 'standard';
      /** #348 — invoice-number prefix, applied within the student's own rows. */
      invoiceNumber?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<{ items: Invoice[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const currentSchoolName = await this.resolveCurrentSchoolName(schoolId, context);
    const limit = options.limit || 50;

    // Issue #466 — one cursor cannot address N student partitions. The
    // previous implementation applied the SAME cursor to every student's
    // query (a DynamoDB ExclusiveStartKey is partition-specific, so that
    // is never correct) and then discarded it, returning `hasMore` with no
    // way to act on it: a parent could not page past the first page at all.
    // The cursor is now a per-student map.
    const incoming = this.decodeStudentCursors(options.cursor);
    const fetched: Array<{ studentId: string; entity: InvoiceEntity }> = [];
    const nextCursors: Record<string, string> = { ...incoming };
    let anyPartitionHasMore = false;

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
      if (options.billingSource) {
        this.pushBillingSourceFilter(options.billingSource, filterParts);
      }
      // #348 — a parent searching by invoice number stays inside their own
      // students' partitions; the number narrows, it never widens scope.
      if (options.invoiceNumber?.trim()) {
        filterParts.push('begins_with(invoiceNumber, :invoiceNumber)');
        filterValues[':invoiceNumber'] = options.invoiceNumber.trim();
      }

      const result = await this.queryInvoicesFilled(
        client,
        'GSI2',
        gsi2pk,
        filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
        Object.keys(filterValues).length > 0 ? filterValues : undefined,
        Object.keys(filterNames).length > 0 ? filterNames : undefined,
        limit,
        incoming[studentId],
      );

      for (const entity of result.items) fetched.push({ studentId, entity });
      if (result.hasMore) anyPartitionHasMore = true;
    }

    // Display order stays createdAt-descending, as before.
    fetched.sort((a, b) => b.entity.createdAt.localeCompare(a.entity.createdAt));
    const page = fetched.slice(0, limit);

    // Advance each student only as far as the OLDEST row of theirs that
    // made this page, measured in index order (gsi2sk), not in createdAt
    // order — the two can disagree, and the cursor has to be expressed in
    // the order the partition is actually read. Students with nothing on
    // this page keep their incoming position so nothing is skipped.
    const oldestIncluded = new Map<string, InvoiceEntity>();
    for (const { studentId, entity } of page) {
      const sk = (entity as unknown as Record<string, string>).gsi2sk;
      const current = oldestIncluded.get(studentId);
      const currentSk = current
        ? (current as unknown as Record<string, string>).gsi2sk
        : undefined;
      if (!current || (sk && currentSk && sk < currentSk)) {
        oldestIncluded.set(studentId, entity);
      }
    }
    for (const [studentId, entity] of oldestIncluded) {
      nextCursors[studentId] = this.cursorAfterItem('GSI2', entity);
    }

    const truncated = fetched.length > page.length;
    const hasMore = truncated || anyPartitionHasMore;

    return {
      items: page.map(p => invoiceEntityToDto(p.entity, { currentSchoolName })),
      lastEvaluatedKey: hasMore ? this.encodeStudentCursors(nextCursors) : undefined,
      hasMore,
    };
  }

  /**
   * Per-student cursor map for `listForStudents`. Opaque to callers; the
   * shape is versioned so a future change can be detected rather than
   * silently misread. An unrecognised or malformed cursor starts from the
   * beginning, which is the same fail-safe `decodeCursor` uses.
   */
  private encodeStudentCursors(cursors: Record<string, string>): string {
    return encodeCursor({ v: 2, s: cursors });
  }

  private decodeStudentCursors(cursor?: string): Record<string, string> {
    const decoded = decodeCursor(cursor);
    if (!decoded || decoded.v !== 2 || typeof decoded.s !== 'object' || decoded.s === null) {
      return {};
    }
    return decoded.s as Record<string, string>;
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

    // Review F2 — the FilterExpression makes single-page reads starve
    // (Limit applies before the filter); read to exhaustion.
    return this.queryStudentInvoicesExhaustive(
      client,
      studentId,
      'schoolId = :schoolId AND #status IN (:issued, :partially_paid, :overdue) AND amountDue > :zero',
      {
        ':schoolId': schoolId,
        ':issued': 'issued',
        ':partially_paid': 'partially_paid',
        ':overdue': 'overdue',
        ':zero': 0,
      },
      { '#status': 'status' },
      false,
      context,
    );
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

  /**
   * EPIC-FB FB-5.4 — invoice provenance ("why") trace. NEW read-only
   * method: resolves every line to its pricing source — fee-structure
   * version, agreement version, discount rule, or operator custom line —
   * plus the fee structures an agreement line suppressed.
   *
   * Referent resolution is best-effort by design: line snapshots are
   * immutable but their referents move on (fee-structure versioning
   * creates superseded-but-present rows; deletes remove rows entirely;
   * agreements supersede/cancel). Any referent that no longer resolves
   * degrades to id-only (WARN, never a 5xx).
   *
   * **`overrides[]` (BH-1.2/1.3):** when the operator bypassed an ACTIVE
   * agreement (`overrideAgreement: true`), the write path now persists a
   * queryable `finance.agreement.bypassed` audit row carrying the real
   * invoiceId (in addition to the immediate CloudWatch line). This trace
   * resolves those rows into `overrides[]` (each: agreementId, title,
   * requestedFeeStructureIds, bypassedAt, operatorId). The lookup is
   * best-effort: if the audit query fails (or the audit service isn't wired),
   * `overrides` is omitted — never a 5xx.
   */
  async getProvenance(
    schoolId: string,
    invoiceId: string,
    context: RequestContext,
  ): Promise<InvoiceProvenanceDto> {
    const entity = await this.getEntity(schoolId, invoiceId, context);
    const lines = entity.lineItems ?? [];

    const feeStructureIds = new Set<string>();
    const agreementIds = new Set<string>();
    const discountRuleIds = new Set<string>();
    if (entity.agreementId) agreementIds.add(entity.agreementId);
    for (const li of lines) {
      if (li.agreementId) {
        agreementIds.add(li.agreementId);
        for (const id of li.suppressedFeeStructureIds ?? []) feeStructureIds.add(id);
      } else if (!li.isCustom) {
        feeStructureIds.add(li.feeStructureId);
      }
      if (li.discountRuleId) discountRuleIds.add(li.discountRuleId);
    }

    const fsById = new Map<string, { name: string; feeType?: string }>();
    if (feeStructureIds.size > 0) {
      try {
        const fss = await this.feeStructuresService.getByIds(
          schoolId,
          [...feeStructureIds],
          context,
        );
        for (const fs of fss) {
          fsById.set(fs.feeStructureId, { name: fs.name, feeType: fs.feeType });
        }
        if (fsById.size < feeStructureIds.size) {
          this.logger.warn(
            `getProvenance: ${feeStructureIds.size - fsById.size}/${feeStructureIds.size} fee-structure ` +
              `referents missing for invoice ${invoiceId} — degrading to id-only`,
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `getProvenance: fee-structure resolution failed for invoice ${invoiceId}: ` +
            `${message.slice(0, 200)} — degrading to id-only`,
        );
      }
    }

    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const agreementTitleById = new Map<string, string>();
    for (const id of agreementIds) {
      try {
        const agreement = await this.dynamoDBClient.getItem<BillingAgreementEntity>(
          client,
          context.tenantId,
          EntityKeyBuilder.agreement(schoolId, id),
        );
        if (agreement?.title) agreementTitleById.set(id, agreement.title);
        else {
          this.logger.warn(
            `getProvenance: agreement referent ${id} missing for invoice ${invoiceId} — id-only`,
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `getProvenance: agreement lookup failed id=${id} invoice=${invoiceId}: ` +
            `${message.slice(0, 200)} — id-only`,
        );
      }
    }

    const ruleNameById = new Map<string, string>();
    for (const id of discountRuleIds) {
      try {
        const rule = await this.dynamoDBClient.getItem<DiscountRuleEntity>(
          client,
          context.tenantId,
          EntityKeyBuilder.discountRule(schoolId, id),
        );
        if (rule?.name) ruleNameById.set(id, rule.name);
        else {
          this.logger.warn(
            `getProvenance: discount-rule referent ${id} missing for invoice ${invoiceId} — id-only`,
          );
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.warn(
          `getProvenance: discount-rule lookup failed id=${id} invoice=${invoiceId}: ` +
            `${message.slice(0, 200)} — id-only`,
        );
      }
    }

    const provenanceLines: InvoiceProvenanceLineDto[] = lines.map((li) => {
      const source: InvoiceProvenanceLineDto['source'] = li.agreementId
        ? 'agreement'
        : li.isCustom
          ? 'custom'
          : 'fee_structure';

      const discount =
        li.discount > 0
          ? {
              amount: li.discount,
              ...(li.discountReason ? { reason: li.discountReason } : {}),
              ...(li.discountRuleId ? { discountRuleId: li.discountRuleId } : {}),
              ...(li.discountRuleId && ruleNameById.has(li.discountRuleId)
                ? { ruleName: ruleNameById.get(li.discountRuleId) }
                : {}),
            }
          : undefined;

      const base = { lineId: li.id, description: li.description, source };
      if (source === 'agreement') {
        return {
          ...base,
          agreementId: li.agreementId,
          ...(li.agreementVersion !== undefined
            ? { agreementVersion: li.agreementVersion }
            : {}),
          ...(agreementTitleById.has(li.agreementId as string)
            ? { agreementTitle: agreementTitleById.get(li.agreementId as string) }
            : {}),
          ...((li.suppressedFeeStructureIds?.length ?? 0) > 0
            ? {
                suppressedFeeStructures: (li.suppressedFeeStructureIds as string[]).map(
                  (id) => ({
                    id,
                    ...(fsById.has(id)
                      ? { name: fsById.get(id)!.name, feeType: fsById.get(id)!.feeType }
                      : {}),
                  }),
                ),
              }
            : {}),
          ...(discount ? { discount } : {}),
        };
      }
      if (source === 'custom') {
        return { ...base, ...(discount ? { discount } : {}) };
      }
      return {
        ...base,
        feeStructureId: li.feeStructureId,
        ...(li.feeStructureVersion !== undefined
          ? { feeStructureVersion: li.feeStructureVersion }
          : {}),
        ...(fsById.has(li.feeStructureId)
          ? { feeStructureName: fsById.get(li.feeStructureId)!.name }
          : {}),
        ...(discount ? { discount } : {}),
      };
    });

    // BH-1.2/1.3 — resolve agreement-bypass events into overrides[] from the
    // queryable audit rows. Best-effort: any failure (or no audit service
    // wired) degrades to an omitted overrides array, never a 5xx.
    const overrides = await this.resolveProvenanceOverrides(invoiceId, schoolId, context);

    return {
      invoiceId: entity.invoiceId,
      invoiceNumber: entity.invoiceNumber,
      ...(entity.feeOverrideMode ? { feeOverrideMode: entity.feeOverrideMode } : {}),
      ...(entity.agreementId ? { agreementId: entity.agreementId } : {}),
      ...(entity.agreementVersion !== undefined
        ? { agreementVersion: entity.agreementVersion }
        : {}),
      lines: provenanceLines,
      ...(overrides.length > 0 ? { overrides } : {}),
    };
  }

  private async resolveProvenanceOverrides(
    invoiceId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<InvoiceProvenanceOverrideDto[]> {
    if (!this.financeAuditService) return [];
    try {
      const rows = await this.financeAuditService.listAgreementBypassEventsForInvoice(
        invoiceId,
        schoolId,
        context,
      );
      return rows.map((row) => {
        const meta = (row.metadata ?? {}) as Record<string, unknown>;
        const agreementId = typeof meta.agreementId === 'string' ? meta.agreementId : '';
        const agreementTitle =
          typeof meta.agreementTitle === 'string' ? meta.agreementTitle : undefined;
        const requestedFeeStructureIds = Array.isArray(meta.requestedFeeStructureIds)
          ? (meta.requestedFeeStructureIds as unknown[]).filter(
              (x): x is string => typeof x === 'string',
            )
          : [];
        return {
          agreementId,
          ...(agreementTitle ? { agreementTitle } : {}),
          requestedFeeStructureIds,
          bypassedAt: row.occurredAt,
          operatorId: row.operatorId,
        };
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `getProvenance: agreement-bypass audit lookup failed for invoice ${invoiceId}: ` +
          `${message.slice(0, 200)} — overrides[] omitted`,
      );
      return [];
    }
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

    const updateExpression = `SET ${setParts.join(', ')}`;
    const conditionExpression = '#v = :currentVersion';

    // BH-1.1 — an agreement invoice moving to a DEAD status (issued→cancelled,
    // overdue→written_off, …) must release its per-term lock so the read-guard
    // and the atomic lock agree (a re-bill after cancel is legitimate). Route
    // the status Update + lock Delete through ONE transactWrite so a crash
    // can't orphan the lock; transactWrite returns no attributes, so re-get the
    // item for the response DTO. Every other update keeps the bare updateItem.
    let updated: InvoiceEntity;
    if (existing.agreementChainId && dto.status && this.isDeadStatus(dto.status)) {
      await this.dynamoDBClient.transactWrite(client, [
        {
          Update: {
            TableName: this.dynamoDBClient.getTableName(),
            Key: { tenantId: context.tenantId, entityKey },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: exprValues,
            ExpressionAttributeNames: exprNames,
            ConditionExpression: conditionExpression,
          },
        },
        this.agreementLockDeleteItem(existing),
      ]);
      const reread = await this.dynamoDBClient.getItem<InvoiceEntity>(
        client,
        context.tenantId,
        entityKey,
      );
      if (!reread) throw new NotFoundException(`Invoice ${invoiceId} not found`);
      updated = reread;
    } else {
      updated = await this.dynamoDBClient.updateItem<InvoiceEntity>(
        client,
        context.tenantId,
        entityKey,
        updateExpression,
        exprValues,
        conditionExpression,
        exprNames,
      );
    }

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
    /** #465 — students whose agreement already priced this term; generation 409s them. */
    agreementBlockedCount?: number;
    students?: PreviewBillingSource[];
  }> {
    const studentIds = await this.resolveStudentIdsForBulkGenerate(schoolId, dto, context);

    // Duplicate detection is best-effort + counts-only — failures
    // collapse to "0 duplicates" rather than 500ing the preview.
    let duplicateCount = 0;
    let dupResults: Array<PromiseSettledResult<boolean>> = [];
    if (dto.feeStructureIds.length > 0) {
      dupResults = await Promise.allSettled(
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

    const duplicateStudentIds = new Set<string>();
    if (dto.feeStructureIds.length > 0) {
      studentIds.forEach((studentId, i) => {
        const r = dupResults[i];
        if (r && r.status === 'fulfilled' && r.value === true) duplicateStudentIds.add(studentId);
      });
    }

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

    // #465 — a student whose agreement already priced this term is NOT
    // eligible: generation rejects them with 409 AGREEMENT_ACTIVE. Counted
    // separately from catalog duplicates (they are different reasons) and
    // unioned for eligibility so a student who is both is not counted twice.
    const agreementBlockedIds = new Set(
      (students ?? []).filter((st) => st.agreementBlocked).map((st) => st.studentId),
    );
    const ineligible = new Set([...duplicateStudentIds, ...agreementBlockedIds]);
    const eligibleCount = studentIds.length - ineligible.size;

    // ~300ms/student average per generate path; rough enough for an
    // operator confirmation banner ("≈ 30 sec for 100 students").
    const estimatedDurationSec = Math.max(1, Math.ceil(Math.max(eligibleCount, 0) * 0.3));

    this.logger.log(
      `bulkPreview schoolId=${schoolId} resolved=${studentIds.length} duplicates=${duplicateCount} ` +
      `agreementBlocked=${agreementBlockedIds.size} eligible=${eligibleCount}`,
    );

    return {
      studentCount: studentIds.length,
      eligibleCount,
      duplicateCount,
      estimatedDurationSec,
      ...segCounters,
      ...(students ? { students, agreementBlockedCount: agreementBlockedIds.size } : {}),
    };
  }

  private async computePreviewBillingSources(
    schoolId: string,
    studentIds: string[],
    feeStructureIds: string[],
    context: RequestContext,
  ): Promise<PreviewBillingSource[] | undefined> {
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

      // Requested structures, so the preview can name exactly which ones an
      // agreement replaces rather than leaving the caller to guess (#465).
      const requested = feeStructureIds.length > 0
        ? await this.feeStructuresService.getByIds(schoolId, feeStructureIds, context)
        : [];

      const memo: AgreementResolutionMemo = new Map();
      const today = todayIsoDate();
      const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

      return await Promise.all(
        studentIds.map(async (studentId) => {
          const resolved = await this.agreementResolver!.getActiveAgreementForStudent(
            studentId,
            schoolId,
            today,
            context,
            memo,
          );
          if (!resolved || requestedFeeTypes.length === 0) {
            return { studentId, billingSource: 'standard' as const };
          }

          const { agreement, allocationForStudent } = resolved;
          const coveredSet = new Set<string>(agreement.coveredFeeTypes as string[]);
          const coveredFeeTypes = requestedFeeTypes.filter((t) => coveredSet.has(t));
          if (coveredFeeTypes.length === 0) {
            return { studentId, billingSource: 'standard' as const };
          }

          const billingSource =
            coveredFeeTypes.length === requestedFeeTypes.length ? 'agreement' as const : 'mixed' as const;

          // Same partition the generate path makes: a requested structure
          // whose feeType the agreement covers is suppressed and replaced.
          const suppressedFeeStructureIds = requested
            .filter((fs) => fs.feeType !== undefined && coveredSet.has(fs.feeType as string))
            .map((fs) => fs.feeStructureId);

          const agreementAmount = agreementReplacementLines(
            agreement as any,
            allocationForStudent,
            studentId,
            coveredFeeTypes,
          ).reduce((sum, line) => sum + line.amount, 0);

          // Agreements bill once per term per chain. Generation rejects a
          // student who already has one with 409 AGREEMENT_ACTIVE, so the
          // preview has to say so instead of counting them as eligible.
          let agreementBlocked = false;
          try {
            const chainId = agreement.versionParentId || agreement.agreementId;
            const invoices = await this.queryStudentInvoicesExhaustive(
              client, studentId, undefined, undefined, undefined, false, context,
            );
            agreementBlocked = !!findAgreementInvoiceConflict(
              invoices as any, agreement.agreementId, chainId,
            );
          } catch {
            // Best-effort, like the rest of the preview: an unknown answer
            // leaves the student eligible rather than failing the preview.
          }

          return {
            studentId,
            billingSource,
            coveredFeeTypes,
            suppressedFeeStructureIds,
            agreementAmount: Math.round(agreementAmount * 100) / 100,
            agreementBlocked,
          };
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
    // FB-5.2 — one sibling-discount memo per run: the rule list is fetched
    // once for the whole batch instead of once per student.
    const siblingMemo = createSiblingDiscountMemo();

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
            siblingMemo,
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
    siblingMemo?: SiblingDiscountMemo,
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
    // The worker never bypasses (overrideAgreement is a manual-path affordance
    // only), so planAgreementPricing returns a plan or null here — but handle
    // the marker defensively for symmetry with generate().
    const planOrBypass = await this.planAgreementPricing(
      schoolId,
      dto.studentId,
      billingDate,
      feeStructures,
      undefined,
      context,
      agreementMemo,
    );
    const bypassMarker = isBypassMarker(planOrBypass) ? planOrBypass : null;
    const agreementPlan = isBypassMarker(planOrBypass) ? null : planOrBypass;
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
    // FB-5.2 — identical hook to generate(): sibling rules over the
    // standard lines, before the agreement/custom appends and the totals.
    await this.applySiblingRuleDiscounts(
      schoolId,
      dto.studentId,
      lineItems,
      billableFeeStructures,
      dto.academicYear,
      context,
      siblingMemo,
    );
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
              agreementChainId: agreementPlan.agreementChainId,
            }
          : {}),
        statusHistory: [],
        currency: dto.cachedCurrency,
      },
      context.userId,
    );

    // Three distinct write paths — same shape as generate() (see there for the
    // full rationale):
    //   1. agreement-priced → transactWrite([lockPut, invoicePut]). The lock
    //      409 (concurrent generation) rejects generateForBulkWorker as a
    //      ConflictException, which the worker's per-student catch records as a
    //      failed student (NOT a retryable TransactionCanceledException — the
    //      lock-ConditionalCheckFailed mapping re-shapes it, so the worker's
    //      retry envelope skips it and the student lands in failedStudentIds).
    //   2. bypass marker → transactWrite([invoicePut, auditPut]) — atomic
    //      queryable finance.agreement.bypassed row (BH-1.2/1.3).
    //   3. plain standard → bare putItem (golden path).
    if (agreementPlan) {
      await this.persistInvoiceWithAgreementLock(client, entity, agreementPlan, context);
    } else if (bypassMarker) {
      await this.persistInvoiceWithBypassAudit(
        client,
        entity,
        bypassMarker,
        schoolId,
        dto.studentId,
        context,
      );
    } else {
      await this.dynamoDBClient.putItem(client, entity);
    }

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
    const updateExpression =
      'SET #status = :cancelled, gsi1sk = :gsi1sk, updatedAt = :now, updatedBy = :by, ' +
      '#v = #v + :one, statusHistory = list_append(if_not_exists(statusHistory, :emptyList), :historyEntry)';
    const exprValues: Record<string, any> = {
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
    };
    const conditionExpression = '#status = :draft AND #v = :currentVersion';
    const exprNames = { '#status': 'status', '#v': 'version' };

    // BH-1.1 — agreement invoices release their per-term lock atomically with
    // the cancel (draft→cancelled is a DEAD transition). Standard invoices
    // (no agreementChainId) keep the bare updateItem — byte-identical path.
    if (invoice.agreementChainId) {
      await this.dynamoDBClient.transactWrite(client, [
        {
          Update: {
            TableName: this.dynamoDBClient.getTableName(),
            Key: { tenantId: invoice.tenantId, entityKey: invoice.entityKey },
            UpdateExpression: updateExpression,
            ExpressionAttributeValues: exprValues,
            ExpressionAttributeNames: exprNames,
            ConditionExpression: conditionExpression,
          },
        },
        this.agreementLockDeleteItem(invoice),
      ]);
    } else {
      await this.dynamoDBClient.updateItem(
        client,
        invoice.tenantId,
        invoice.entityKey,
        updateExpression,
        exprValues,
        conditionExpression,
        exprNames,
      );
    }

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
   *
   * Round-3 C3 — reads the student's GSI2 invoice partition to exhaustion
   * via the review-F2 helper (page size 100, 25-page cap → 409
   * INVOICE_SCAN_LIMIT_EXCEEDED). The prior single limit-100 page could
   * miss the duplicate deeper in the partition (DDB applies Limit before
   * any filtering) and silently double-generate.
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

    const invoices = await this.queryStudentInvoicesExhaustive(
      client,
      studentId,
      undefined,
      undefined,
      undefined,
      false,
      context,
    );

    const activeStatuses = new Set(['draft', 'issued', 'partially_paid', 'overdue']);

    return invoices.some(inv => {
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
