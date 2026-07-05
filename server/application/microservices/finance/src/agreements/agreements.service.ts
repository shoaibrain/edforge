/**
 * AgreementsService — EPIC-FB Sprints FB-2.3/2.4/2.5 (draft CRUD) +
 * FB-3.5 (activation locks) + FB-3.6 (versioning of active agreements).
 *
 * Mirrors fee-structures idioms: tenant-scoped DDB client, transactWrite
 * for multi-row atomicity, AuditLoggerService + FinanceEventsService on
 * every state change, versioning via new-row + supersede.
 *
 * Version semantics (FB-2.4 recorded choice): fee-structures uses ONE
 * `version` field as both the optimistic-concurrency token and the
 * financial version counter (in-place edits do `#v = #v + 1`; financial
 * changes create a new row at version+1). Agreements mirror that exactly —
 * every in-place write (draft edit, activation, cancel, non-financial
 * active edit) bumps `version` so stale-body writes are detectable, and
 * FB-3.6 financial changes on an ACTIVE agreement create a NEW row at
 * version+1. The superseded row's `version` is left untouched so invoice
 * provenance pins (`agreementId` + `agreementVersion`) stay resolvable.
 * Financial terms of a given agreementId are immutable from activation
 * onward, so the id alone identifies the priced terms.
 */

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { v4 as uuid } from 'uuid';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { FinanceEventsService } from '../common/services/finance-events.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import { FeeStructuresService } from '../fee-structures/fee-structures.service';
import {
  AgreementActiveLockEntity,
  AgreementMemberEntity,
  BillingAgreementEntity,
  agreementGsi1sk,
  createAgreementActiveLockEntity,
  createAgreementMemberEntity,
  createBillingAgreementEntity,
} from '../common/entities/billing-agreement.entity';
import {
  EntityKeyBuilder,
  GSIKeyBuilder,
  RequestContext,
  decodeCursor,
} from '../common/entities/base.entity';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import { billingAgreementEntityToDto } from '../common/mappers/billing-agreement.mapper';
import { FinanceErrors } from '../common/errors/finance-errors';
import type { ActivateAgreementDtoZ, CancelAgreementDtoZ } from '../common/dto/zod-dtos';
import { AuditLoggerService, AuditAction } from '@app/logger';
import type {
  AgreementStatus,
  BillingAgreement,
  CreateBillingAgreementDto,
  UpdateBillingAgreementDto,
} from '@aibrains/shared-types';

// ============================================================================
// Transition matrix — enforced centrally (FB-2.4)
// ============================================================================

export const AGREEMENT_TRANSITIONS: Record<AgreementStatus, AgreementStatus[]> = {
  draft: ['active', 'cancelled'],
  active: ['cancelled', 'expired', 'superseded'],
  expired: [],
  cancelled: [],
  superseded: [],
};

export function assertAgreementTransition(from: AgreementStatus, to: AgreementStatus): void {
  if (!AGREEMENT_TRANSITIONS[from]?.includes(to)) {
    throw new ConflictException({
      code: FinanceErrors.AGREEMENT_INVALID_TRANSITION,
      message: `Cannot transition agreement from '${from}' to '${to}'.`,
      from,
      to,
    });
  }
}

/**
 * Server-side re-assert of the schema's cross-field invariants (FB-2.3).
 * The Zod schemas enforce these on full payloads; partial PATCHes are
 * validated here against the MERGED entity, and defense-in-depth covers
 * internal callers that bypass the HTTP pipe.
 */
export function assertAgreementInvariants(a: {
  studentIds: string[];
  agreementType: string;
  terms: BillingAgreementEntity['terms'];
  effectiveFrom: string;
  effectiveTo: string;
  coveredFeeTypes?: string[];
}): void {
  if (a.effectiveFrom >= a.effectiveTo) {
    throw new BadRequestException(
      `effectiveFrom (${a.effectiveFrom}) must be strictly before effectiveTo (${a.effectiveTo}).`,
    );
  }
  if (a.terms.agreementType !== a.agreementType) {
    throw new BadRequestException(
      `terms.agreementType (${a.terms.agreementType}) must match agreementType (${a.agreementType}).`,
    );
  }
  const studentIdSet = new Set(a.studentIds);
  if (a.terms.agreementType === 'fixed_total') {
    const sum = a.terms.allocation.reduce((s, entry) => s + entry.amount, 0);
    if (Math.abs(sum - a.terms.totalAmount) > 0.01) {
      throw new BadRequestException(
        `Sum of allocation[].amount (${sum}) must equal terms.totalAmount (${a.terms.totalAmount}).`,
      );
    }
    const allocationIds = a.terms.allocation.map((entry) => entry.studentId);
    if (new Set(allocationIds).size !== allocationIds.length) {
      throw new BadRequestException('allocation[].studentId entries must be distinct.');
    }
    const allocationIdSet = new Set(allocationIds);
    if (
      a.studentIds.some((id) => !allocationIdSet.has(id)) ||
      allocationIds.some((id) => !studentIdSet.has(id))
    ) {
      throw new BadRequestException(
        'allocation[].studentId must cover exactly the agreement studentIds.',
      );
    }
  } else {
    const seenPairs = new Set<string>();
    for (const line of a.terms.lines) {
      if (!studentIdSet.has(line.studentId)) {
        throw new BadRequestException(
          `terms.lines studentId ${line.studentId} is not in the agreement studentIds.`,
        );
      }
      if (line.feeType !== undefined) {
        // Review F6 — two lines for the same (studentId, feeType) would
        // both match at generation time and double-price the pair.
        const pairKey = `${line.studentId}|${line.feeType}`;
        if (seenPairs.has(pairKey)) {
          throw new BadRequestException(
            `terms.lines duplicates the (studentId, feeType) pair (${line.studentId}, ${line.feeType}).`,
          );
        }
        seenPairs.add(pairKey);
      }
    }
    // Review F1 — completeness re-assert against the MERGED entity: a
    // partial PATCH that changes terms without coveredFeeTypes bypasses
    // the Zod-level check (the schema can't see the stored fee types).
    if (a.coveredFeeTypes) {
      const missing: string[] = [];
      for (const studentId of a.studentIds) {
        for (const feeType of a.coveredFeeTypes) {
          if (!seenPairs.has(`${studentId}|${feeType}`)) {
            missing.push(`(${studentId}, ${feeType})`);
          }
        }
      }
      if (missing.length > 0) {
        throw new BadRequestException(
          'per_student terms must carry a line for every (studentId, feeType) pair in '
          + `studentIds × coveredFeeTypes. Missing: ${missing.slice(0, 5).join(', ')}`
          + (missing.length > 5 ? ` and ${missing.length - 5} more.` : '.'),
        );
      }
    }
  }
}

/** Fields whose change on an ACTIVE agreement forces a new version (FB-3.6). */
const FINANCIAL_FIELDS: Array<keyof UpdateBillingAgreementDto> = [
  'agreementType',
  'terms',
  'coveredFeeTypes',
  'studentIds',
  'effectiveFrom',
  'effectiveTo',
  'billingFrequency',
  'currency',
];

export interface AgreementInvoiceConflict {
  invoiceId: string;
  invoiceNumber: string;
  grandTotal: number;
  matchedFeeTypes: string[];
}

/** Descriptor for mapping TransactWriteItems CancellationReasons back to intent. */
interface TransactItemDescriptor {
  kind: 'agreement' | 'pointer-put' | 'pointer-delete' | 'lock-put' | 'lock-update' | 'lock-delete';
  studentId?: string;
}

const OPEN_INVOICE_STATUSES = ['issued', 'partially_paid', 'overdue'];

// Review F2 — per-student GSI2 invoice scans paginate to exhaustion with
// this page size and a hard safety cap (2,500 rows) before aborting to
// manual review.
const GSI2_INVOICE_SCAN_PAGE_SIZE = 100;
const GSI2_INVOICE_SCAN_MAX_PAGES = 25;

@Injectable()
export class AgreementsService {
  private readonly logger = new Logger(AgreementsService.name);
  private readonly auditLogger = new AuditLoggerService('finance-service');

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly eventsService: FinanceEventsService,
    private readonly identityClient: IdentityClientService,
    private readonly feeStructuresService: FeeStructuresService,
  ) {}

  // ==========================================================================
  // FB-2.3 — create (always draft) / get / list
  // ==========================================================================

  async create(
    schoolId: string,
    dto: CreateBillingAgreementDto,
    context: RequestContext,
  ): Promise<BillingAgreement> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const schoolExists = await this.identityClient.validateSchoolExists(schoolId, context);
    if (!schoolExists) {
      throw new NotFoundException(`School ${schoolId} not found`);
    }

    if (dto.currency) {
      const ws = await this.identityClient.getWorkspaceSettings(context);
      if (ws?.regional?.defaultCurrency && dto.currency !== ws.regional.defaultCurrency) {
        throw new BadRequestException(
          `Currency mismatch: tenant is configured for ${ws.regional.defaultCurrency} but received ${dto.currency}`,
        );
      }
    }

    assertAgreementInvariants(dto);
    await this.validateEnrollment(dto.studentIds, schoolId, context);
    if (dto.familyId) {
      await this.validateFamilyMembership(dto.familyId, dto.studentIds, schoolId, context);
    }
    await this.assertNoAdvisoryOverlap(
      client,
      schoolId,
      dto.studentIds,
      dto.effectiveFrom,
      dto.effectiveTo,
      context,
    );

    const entity = createBillingAgreementEntity(context.tenantId, schoolId, dto, context.userId);
    const tableName = this.dynamoDBClient.getTableName();

    // Agreement + one pointer per student in ONE transactWrite — a partial
    // write would leave the resolver/overlap queries blind to members.
    await this.dynamoDBClient.transactWrite(client, [
      { Put: { TableName: tableName, Item: entity as any } },
      ...dto.studentIds.map((studentId) => ({
        Put: {
          TableName: tableName,
          Item: createAgreementMemberEntity(
            context.tenantId,
            schoolId,
            studentId,
            {
              agreementId: entity.agreementId,
              status: 'draft',
              effectiveFrom: entity.effectiveFrom,
              effectiveTo: entity.effectiveTo,
            },
            context.userId,
          ) as any,
        },
      })),
    ]);

    this.eventsService
      .publishAgreementCreated(context.tenantId, schoolId, entity.agreementId, entity.title)
      .catch((err) => this.logger.error(`Failed to publish AgreementCreated: ${err.message}`));

    this.auditLogger.log(
      AuditAction.AGREEMENT_CREATED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'AGREEMENT', id: entity.agreementId, name: entity.title },
      {
        schoolId,
        agreementType: entity.agreementType,
        currency: entity.currency,
        effectiveFrom: entity.effectiveFrom,
        effectiveTo: entity.effectiveTo,
        studentCount: entity.studentIds.length,
        familyId: entity.familyId,
      },
    );

    return billingAgreementEntityToDto(entity);
  }

  async get(
    schoolId: string,
    agreementId: string,
    context: RequestContext,
  ): Promise<BillingAgreement> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.loadAgreement(client, context.tenantId, schoolId, agreementId);
    if (!entity) {
      throw new NotFoundException({
        code: FinanceErrors.AGREEMENT_NOT_FOUND,
        message: `Agreement ${agreementId} not found`,
      });
    }
    return billingAgreementEntityToDto(entity);
  }

  async list(
    schoolId: string,
    context: RequestContext,
    options: {
      status?: AgreementStatus;
      familyId?: string;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<{ items: BillingAgreement[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    // Status filter is key-level (gsi1sk = AGREEMENT#{status}#{effectiveFrom}).
    // Review NOTE-A: 'expired' is lazy/display-only — rows past effectiveTo
    // are STORED as 'active' (no background job flips them), so a key-level
    // AGREEMENT#expired# prefix matches nothing, forever. Instead:
    //   - status=expired → query the ACTIVE prefix and keep only rows the
    //     mapper presents as expired (effectiveTo < today);
    //   - status=active  → post-filter the inverse, so a lapsed agreement
    //     stops appearing in active-filtered lists.
    // The unfiltered list is unchanged (mapper already presents
    // lapsed-active rows as expired).
    const keyStatus = options.status === 'expired' ? 'active' : options.status;
    const skPrefix = keyStatus ? `AGREEMENT#${keyStatus}#` : 'AGREEMENT#';

    const filterParts: string[] = ['isActive <> :false'];
    const filterValues: Record<string, any> = { ':false': false };
    if (options.familyId) {
      filterParts.push('familyId = :familyId');
      filterValues[':familyId'] = options.familyId;
    }

    const result = await this.dynamoDBClient.queryGSI<BillingAgreementEntity>(
      client,
      'GSI1',
      gsi1pk,
      skPrefix,
      'begins_with',
      filterParts.join(' AND '),
      filterValues,
      undefined,
      options.limit || 50,
      true,
      decodeCursor(options.cursor),
    );

    let items = result.items.map((entity) => billingAgreementEntityToDto(entity));
    if (options.status === 'active' || options.status === 'expired') {
      items = items.filter((dto) => dto.status === options.status);
    }

    return {
      items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Student-scoped read (`GET /finance/students/{studentId}/agreements`).
   * Pointer rows via GSI2, hydrated to agreement rows; optional status
   * filter applies to the PRESENTED (lazy-expiry-flipped) status.
   */
  async listForStudent(
    studentId: string,
    schoolId: string,
    context: RequestContext,
    options: { status?: AgreementStatus } = {},
  ): Promise<{ items: BillingAgreement[] }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const pointers = await this.dynamoDBClient.queryGSI<AgreementMemberEntity>(
      client,
      'GSI2',
      GSIKeyBuilder.studentScope(context.tenantId, studentId),
      'AGREEMENT#',
      'begins_with',
      undefined,
      undefined,
      undefined,
      100,
      true,
    );

    const agreementIds = [
      ...new Set(
        pointers.items.filter((p) => p.schoolId === schoolId).map((p) => p.agreementId),
      ),
    ];
    if (agreementIds.length === 0) return { items: [] };

    const agreements = await this.dynamoDBClient.batchGetItems<BillingAgreementEntity>(
      client,
      agreementIds.map((id) => ({
        tenantId: context.tenantId,
        entityKey: EntityKeyBuilder.agreement(schoolId, id),
      })),
    );

    const items = agreements
      .filter((a) => a.isActive !== false)
      .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom))
      .map((entity) => billingAgreementEntityToDto(entity))
      .filter((dto) => (options.status ? dto.status === options.status : true));

    return { items };
  }

  // ==========================================================================
  // FB-2.4 — draft update + cancel · FB-3.6 — versioning of active agreements
  // ==========================================================================

  async update(
    schoolId: string,
    agreementId: string,
    dto: UpdateBillingAgreementDto,
    context: RequestContext,
  ): Promise<BillingAgreement> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.loadAgreement(client, context.tenantId, schoolId, agreementId);
    if (!existing) {
      throw new NotFoundException({
        code: FinanceErrors.AGREEMENT_NOT_FOUND,
        message: `Agreement ${agreementId} not found`,
      });
    }

    this.assertVersionMatch(existing, dto.version);

    if (existing.status !== 'draft' && existing.status !== 'active') {
      // Terminal states immutable (FB-2.4 transition matrix).
      throw new ConflictException({
        code: FinanceErrors.AGREEMENT_INVALID_TRANSITION,
        message: `Agreement in terminal status '${existing.status}' cannot be edited.`,
      });
    }

    const changedFields = Object.keys(dto).filter(
      (key) => key !== 'version' && (dto as Record<string, unknown>)[key] !== undefined,
    );
    const financialChanges = changedFields.filter((f) =>
      (FINANCIAL_FIELDS as string[]).includes(f),
    );

    if (existing.status === 'active' && financialChanges.length > 0) {
      return this.versionActiveAgreement(client, schoolId, existing, dto, changedFields, context);
    }

    // Draft: everything edits in place (drafts are cheap — FB-2.4).
    // Active: only non-financial fields reach here (title/payer/notes/familyId).
    const merged = this.mergeEntity(existing, dto, context);
    assertAgreementInvariants(merged);

    if (dto.studentIds !== undefined) {
      await this.validateEnrollment(merged.studentIds, schoolId, context);
    }
    if (merged.familyId && (dto.familyId !== undefined || dto.studentIds !== undefined)) {
      await this.validateFamilyMembership(merged.familyId, merged.studentIds, schoolId, context);
    }

    const tableName = this.dynamoDBClient.getTableName();
    const items: any[] = [];
    const descriptors: TransactItemDescriptor[] = [];

    items.push({
      Put: {
        TableName: tableName,
        Item: merged as any,
        ConditionExpression: 'version = :expectedVersion AND #st = :expectedStatus',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':expectedVersion': existing.version,
          ':expectedStatus': existing.status,
        },
      },
    });
    descriptors.push({ kind: 'agreement' });

    // Pointer reconcile (FB-2.4): rewrite when membership or the dates
    // duplicated into the pointer rows changed; delete removed members.
    const pointersDirty =
      dto.studentIds !== undefined ||
      dto.effectiveFrom !== undefined ||
      dto.effectiveTo !== undefined;
    if (pointersDirty) {
      const mergedSet = new Set(merged.studentIds);
      for (const removed of existing.studentIds.filter((id) => !mergedSet.has(id))) {
        items.push({
          Delete: {
            TableName: tableName,
            Key: {
              tenantId: context.tenantId,
              entityKey: EntityKeyBuilder.agreementMember(schoolId, removed, agreementId),
            },
          },
        });
        descriptors.push({ kind: 'pointer-delete', studentId: removed });
      }
      for (const studentId of merged.studentIds) {
        items.push(
          this.buildPointerPut(tableName, schoolId, studentId, merged, context),
        );
        descriptors.push({ kind: 'pointer-put', studentId });
      }
    }

    await this.executeTransact(client, items, descriptors);

    this.auditLogger.log(
      AuditAction.AGREEMENT_UPDATED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'AGREEMENT', id: agreementId, name: merged.title },
      { schoolId, updatedFields: changedFields, status: existing.status },
    );

    return billingAgreementEntityToDto(merged);
  }

  async cancel(
    schoolId: string,
    agreementId: string,
    dto: CancelAgreementDtoZ,
    context: RequestContext,
  ): Promise<BillingAgreement> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.loadAgreement(client, context.tenantId, schoolId, agreementId);
    if (!existing) {
      throw new NotFoundException({
        code: FinanceErrors.AGREEMENT_NOT_FOUND,
        message: `Agreement ${agreementId} not found`,
      });
    }

    this.assertVersionMatch(existing, dto.version);
    assertAgreementTransition(existing.status, 'cancelled');
    const wasActive = existing.status === 'active';
    const now = new Date().toISOString();

    const cancelled: BillingAgreementEntity = {
      ...existing,
      status: 'cancelled',
      version: existing.version + 1,
      statusHistory: [
        ...(existing.statusHistory ?? []),
        {
          from: existing.status,
          to: 'cancelled',
          changedAt: now,
          changedBy: context.userId,
          reason: dto.reason,
        },
      ],
      gsi1sk: agreementGsi1sk('cancelled', existing.effectiveFrom),
      updatedAt: now,
      updatedBy: context.userId,
    };

    const tableName = this.dynamoDBClient.getTableName();
    const items: any[] = [];
    const descriptors: TransactItemDescriptor[] = [];

    items.push({
      Put: {
        TableName: tableName,
        Item: cancelled as any,
        ConditionExpression: 'version = :expectedVersion AND #st = :expectedStatus',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':expectedVersion': existing.version,
          ':expectedStatus': existing.status,
        },
      },
    });
    descriptors.push({ kind: 'agreement' });

    for (const studentId of existing.studentIds) {
      items.push(this.buildPointerPut(tableName, schoolId, studentId, cancelled, context));
      descriptors.push({ kind: 'pointer-put', studentId });
    }

    if (wasActive) {
      // FB-3.5(4): cancelling an active agreement frees the per-student
      // activation locks in the same transact. Condition tolerates an
      // already-TTL-cleared lock but refuses to delete another agreement's.
      for (const studentId of existing.studentIds) {
        items.push({
          Delete: {
            TableName: tableName,
            Key: {
              tenantId: context.tenantId,
              entityKey: EntityKeyBuilder.agreementActiveLock(schoolId, studentId),
            },
            ConditionExpression:
              'attribute_not_exists(entityKey) OR agreementId = :agreementId',
            ExpressionAttributeValues: { ':agreementId': agreementId },
          },
        });
        descriptors.push({ kind: 'lock-delete', studentId });
      }
    }

    await this.executeTransact(client, items, descriptors);

    this.eventsService
      .publishAgreementCancelled(context.tenantId, schoolId, agreementId, existing.status)
      .catch((err) => this.logger.error(`Failed to publish AgreementCancelled: ${err.message}`));

    this.auditLogger.log(
      AuditAction.AGREEMENT_CANCELLED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'AGREEMENT', id: agreementId, name: existing.title },
      { schoolId, previousStatus: existing.status, reason: dto.reason },
    );

    return billingAgreementEntityToDto(cancelled);
  }

  // ==========================================================================
  // FB-3.5 — activation with per-student locks + open-invoice conflict check
  // ==========================================================================

  async activate(
    schoolId: string,
    agreementId: string,
    dto: ActivateAgreementDtoZ,
    context: RequestContext,
  ): Promise<BillingAgreement> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const existing = await this.loadAgreement(client, context.tenantId, schoolId, agreementId);
    if (!existing) {
      throw new NotFoundException({
        code: FinanceErrors.AGREEMENT_NOT_FOUND,
        message: `Agreement ${agreementId} not found`,
      });
    }

    this.assertVersionMatch(existing, dto.version);
    assertAgreementTransition(existing.status, 'active');

    const today = new Date().toISOString().slice(0, 10);
    if (existing.effectiveTo < today) {
      throw new BadRequestException({
        code: FinanceErrors.AGREEMENT_TERM_EXPIRED,
        message: `Agreement term ended ${existing.effectiveTo}; cannot activate an expired term.`,
      });
    }

    await this.validateEnrollment(existing.studentIds, schoolId, context);

    const conflicts = await this.findConflictingOpenInvoices(client, schoolId, existing, context);
    if (conflicts.length > 0 && !dto.acknowledgeOpenInvoices) {
      // Warning-with-listing (epic §3.2): the operator resolves via cancel /
      // credit note, or re-submits with acknowledgeOpenInvoices: true.
      throw new ConflictException({
        code: FinanceErrors.CONFLICTING_OPEN_INVOICES,
        message:
          `${conflicts.length} open standard invoice(s) cover fee types this agreement replaces. ` +
          'Resolve them or re-submit with acknowledgeOpenInvoices: true.',
        conflicts,
      });
    }

    // Review F7 — stale-lock reclaim (consecutive-term scenario): the
    // previous term's agreement expired naturally (effectiveTo < today),
    // so nothing deleted its per-student locks, and the 30-day TTL grace
    // means they can still exist — blocking the NEXT term's activation
    // with a spurious AGREEMENT_OVERLAP. Delete provably-expired locks in
    // a conditional pre-step; the conditional Puts in the transact below
    // stay unchanged. (A transactWrite cannot Delete and Put the same key,
    // hence the separate pre-step; the `effectiveTo < :today` condition
    // guards against racing a live lock.)
    await this.reclaimExpiredLocks(client, schoolId, existing.studentIds, today, context);

    const now = new Date().toISOString();
    const activated: BillingAgreementEntity = {
      ...existing,
      status: 'active',
      version: existing.version + 1,
      approvedBy: context.userId,
      statusHistory: [
        ...(existing.statusHistory ?? []),
        { from: 'draft', to: 'active', changedAt: now, changedBy: context.userId },
      ],
      gsi1sk: agreementGsi1sk('active', existing.effectiveFrom),
      updatedAt: now,
      updatedBy: context.userId,
    };

    const tableName = this.dynamoDBClient.getTableName();
    const items: any[] = [];
    const descriptors: TransactItemDescriptor[] = [];

    items.push({
      Put: {
        TableName: tableName,
        Item: activated as any,
        ConditionExpression: 'version = :expectedVersion AND #st = :draft',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':expectedVersion': existing.version,
          ':draft': 'draft',
        },
      },
    });
    descriptors.push({ kind: 'agreement' });

    for (const studentId of existing.studentIds) {
      items.push(this.buildPointerPut(tableName, schoolId, studentId, activated, context));
      descriptors.push({ kind: 'pointer-put', studentId });
    }

    for (const studentId of existing.studentIds) {
      const lock = createAgreementActiveLockEntity(
        context.tenantId,
        schoolId,
        studentId,
        { agreementId, effectiveTo: existing.effectiveTo },
        context.userId,
      );
      items.push({
        Put: {
          TableName: tableName,
          Item: lock as any,
          ConditionExpression: 'attribute_not_exists(entityKey)',
        },
      });
      descriptors.push({ kind: 'lock-put', studentId });
    }

    await this.executeTransact(client, items, descriptors);

    this.eventsService
      .publishAgreementActivated(context.tenantId, schoolId, agreementId, existing.studentIds)
      .catch((err) => this.logger.error(`Failed to publish AgreementActivated: ${err.message}`));

    this.auditLogger.log(
      AuditAction.AGREEMENT_ACTIVATED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'AGREEMENT', id: agreementId, name: existing.title },
      {
        schoolId,
        studentCount: existing.studentIds.length,
        effectiveFrom: existing.effectiveFrom,
        effectiveTo: existing.effectiveTo,
        // Operator saw the warning and proceeded — record what they acknowledged.
        ...(conflicts.length > 0 && { acknowledgedOpenInvoices: conflicts }),
      },
    );

    return billingAgreementEntityToDto(activated);
  }

  // ==========================================================================
  // FB-3.6 — version history
  // ==========================================================================

  async getVersionHistory(
    schoolId: string,
    agreementId: string,
    context: RequestContext,
  ): Promise<BillingAgreement[]> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entity = await this.loadAgreement(client, context.tenantId, schoolId, agreementId);
    if (!entity) {
      throw new NotFoundException({
        code: FinanceErrors.AGREEMENT_NOT_FOUND,
        message: `Agreement ${agreementId} not found`,
      });
    }

    const parentId = entity.versionParentId || entity.agreementId;

    const result = await this.dynamoDBClient.query<BillingAgreementEntity>(
      client,
      context.tenantId,
      `AGREEMENT#${schoolId}#`,
      'entityType = :et AND (versionParentId = :parentId OR agreementId = :parentId)',
      { ':et': 'AGREEMENT', ':parentId': parentId },
    );

    return result.items
      .sort((a, b) => a.version - b.version)
      .map((item) => billingAgreementEntityToDto(item));
  }

  // ==========================================================================
  // Private helpers
  // ==========================================================================

  private async loadAgreement(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    tenantId: string,
    schoolId: string,
    agreementId: string,
  ): Promise<BillingAgreementEntity | null> {
    const entity = await this.dynamoDBClient.getItem<BillingAgreementEntity>(
      client,
      tenantId,
      EntityKeyBuilder.agreement(schoolId, agreementId),
    );
    // SK embeds schoolId, so a wrong-school id misses naturally; the
    // isActive filter hides soft-deleted rows (P1d server-side filtering).
    if (!entity || entity.isActive === false) return null;
    return entity;
  }

  private assertVersionMatch(existing: BillingAgreementEntity, bodyVersion: number): void {
    if (bodyVersion !== existing.version) {
      throw new ConflictException({
        code: FinanceErrors.CONCURRENT_UPDATE,
        message: `Agreement version mismatch: expected ${existing.version}, received ${bodyVersion}. Refetch and retry.`,
      });
    }
  }

  /**
   * Review F7 — delete naturally-expired activation locks (effectiveTo
   * strictly before today) for the given students so a consecutive-term
   * activation isn't blocked by the previous term's not-yet-TTL-cleared
   * lock. The DeleteItem is conditional on `effectiveTo < :today`, so a
   * lock that became live between the read and the delete survives and
   * the activation transact still 409s on it (fail-safe).
   */
  private async reclaimExpiredLocks(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    schoolId: string,
    studentIds: string[],
    today: string,
    context: RequestContext,
  ): Promise<void> {
    for (const studentId of studentIds) {
      const lockKey = EntityKeyBuilder.agreementActiveLock(schoolId, studentId);
      const lock = await this.dynamoDBClient.getItem<AgreementActiveLockEntity>(
        client,
        context.tenantId,
        lockKey,
      );
      if (!lock || !(lock.effectiveTo < today)) continue;

      try {
        await this.dynamoDBClient.deleteItem(
          client,
          context.tenantId,
          lockKey,
          'effectiveTo < :today',
          { ':today': today },
        );
        this.logger.log(
          `Reclaimed expired agreement lock: schoolId=${schoolId} studentId=${studentId} ` +
            `holder=${lock.agreementId} effectiveTo=${lock.effectiveTo}`,
        );
      } catch (err: any) {
        // Lock turned live (or vanished) concurrently — leave it to the
        // activation transact, which 409s AGREEMENT_OVERLAP if it's held.
        if (err?.name !== 'ConditionalCheckFailedException') throw err;
      }
    }
  }

  private mergeEntity(
    existing: BillingAgreementEntity,
    dto: UpdateBillingAgreementDto,
    context: RequestContext,
  ): BillingAgreementEntity {
    const now = new Date().toISOString();
    const merged: BillingAgreementEntity = {
      ...existing,
      ...(dto.title !== undefined && { title: dto.title }),
      ...(dto.payer !== undefined && { payer: dto.payer }),
      ...(dto.studentIds !== undefined && { studentIds: dto.studentIds }),
      ...(dto.agreementType !== undefined && { agreementType: dto.agreementType }),
      ...(dto.terms !== undefined && { terms: dto.terms }),
      ...(dto.coveredFeeTypes !== undefined && { coveredFeeTypes: dto.coveredFeeTypes }),
      ...(dto.billingFrequency !== undefined && { billingFrequency: dto.billingFrequency }),
      ...(dto.currency !== undefined && { currency: dto.currency }),
      ...(dto.effectiveFrom !== undefined && { effectiveFrom: dto.effectiveFrom }),
      ...(dto.effectiveTo !== undefined && { effectiveTo: dto.effectiveTo }),
      ...(dto.notes !== undefined && { notes: dto.notes }),
      version: existing.version + 1,
      updatedAt: now,
      updatedBy: context.userId,
    };
    if (dto.familyId !== undefined) {
      merged.familyId = dto.familyId === null ? undefined : dto.familyId;
    }
    merged.gsi1sk = agreementGsi1sk(merged.status, merged.effectiveFrom);
    return merged;
  }

  private buildPointerPut(
    tableName: string,
    schoolId: string,
    studentId: string,
    agreement: BillingAgreementEntity,
    context: RequestContext,
  ): { Put: { TableName: string; Item: any } } {
    return {
      Put: {
        TableName: tableName,
        Item: createAgreementMemberEntity(
          context.tenantId,
          schoolId,
          studentId,
          {
            agreementId: agreement.agreementId,
            status: agreement.status,
            effectiveFrom: agreement.effectiveFrom,
            effectiveTo: agreement.effectiveTo,
          },
          context.userId,
        ) as any,
      },
    };
  }

  /**
   * Runs the transact and maps TransactionCanceledException using the
   * descriptor list (same order as TransactItems — DDB returns
   * CancellationReasons positionally):
   *   - failed lock-put(s) → 409 AGREEMENT_OVERLAP with the studentId(s),
   *     plus a best-effort holder lookup for the conflicting agreementId
   *   - any other ConditionalCheckFailed → 409 CONCURRENT_UPDATE
   */
  private async executeTransact(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    items: any[],
    descriptors: TransactItemDescriptor[],
  ): Promise<void> {
    try {
      await this.dynamoDBClient.transactWrite(client, items);
    } catch (error: any) {
      if (error?.name !== 'TransactionCanceledException') throw error;
      const reasons: Array<{ Code?: string }> = error.CancellationReasons ?? [];

      const failedLockStudents = descriptors
        .map((d, i) => ({ d, code: reasons[i]?.Code }))
        .filter(({ d, code }) => d.kind === 'lock-put' && code === 'ConditionalCheckFailed')
        .map(({ d }) => d.studentId as string);

      if (failedLockStudents.length > 0) {
        // Another agreement holds the activation lock for these students —
        // the binding overlap enforcement (FB-3.5). Best-effort holder
        // lookup for the 409 payload; the OUTCOME does not depend on it.
        let conflictingAgreementId: string | undefined;
        try {
          const lockItem = items.find(
            (_, i) =>
              descriptors[i].kind === 'lock-put' &&
              descriptors[i].studentId === failedLockStudents[0],
          );
          const lockKey = lockItem?.Put?.Item?.entityKey as string | undefined;
          const tenantId = lockItem?.Put?.Item?.tenantId as string | undefined;
          if (lockKey && tenantId) {
            const holder = await this.dynamoDBClient.getItem<AgreementActiveLockEntity>(
              client,
              tenantId,
              lockKey,
            );
            conflictingAgreementId = holder?.agreementId;
          }
        } catch (lookupErr: any) {
          this.logger.warn(
            `Lock-holder lookup failed during AGREEMENT_OVERLAP classification: ${lookupErr?.message}`,
          );
        }
        throw new ConflictException({
          code: FinanceErrors.AGREEMENT_OVERLAP,
          message: `Another agreement is already active for student(s): ${failedLockStudents.join(', ')}.`,
          studentIds: failedLockStudents,
          ...(conflictingAgreementId && { conflictingAgreementId }),
        });
      }

      if (reasons.some((r) => r?.Code === 'ConditionalCheckFailed')) {
        throw new ConflictException({
          code: FinanceErrors.CONCURRENT_UPDATE,
          message: 'Agreement was modified by another request. Refetch and retry.',
        });
      }
      throw error;
    }
  }

  private async validateEnrollment(
    studentIds: string[],
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    const contextWithSchool = { ...context, schoolId };
    const missing: string[] = [];
    for (const studentId of studentIds) {
      const info = await this.identityClient.getStudentInfo(studentId, contextWithSchool);
      if (!info) missing.push(studentId);
    }
    if (missing.length > 0) {
      throw new BadRequestException({
        code: FinanceErrors.AGREEMENT_STUDENT_NOT_ENROLLED,
        message: `Student(s) not enrolled at school ${schoolId}: ${missing.join(', ')}`,
        studentIds: missing,
      });
    }
  }

  private async validateFamilyMembership(
    familyId: string,
    studentIds: string[],
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    const notInFamily: string[] = [];
    for (const studentId of studentIds) {
      // Fail-closed: an academics transport failure returns null (not
      // `{ family: null }`), and an unverifiable membership claim rejects.
      const view = await this.identityClient.getStudentFamily(studentId, schoolId, context);
      if (view?.family?.id !== familyId) notInFamily.push(studentId);
    }
    if (notInFamily.length > 0) {
      throw new BadRequestException({
        code: FinanceErrors.AGREEMENT_STUDENT_NOT_IN_FAMILY,
        message: `Student(s) not members of family ${familyId}: ${notInFamily.join(', ')}`,
        studentIds: notInFamily,
      });
    }
  }

  /**
   * FB-2.5 — ADVISORY overlap detection at draft-create. Query-then-write
   * is inherently racy (two concurrent creates can both pass), so this is
   * a courtesy 409 for the common sequential case only; the BINDING
   * enforcement is the activation lock (FB-3.5).
   */
  private async assertNoAdvisoryOverlap(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    schoolId: string,
    studentIds: string[],
    effectiveFrom: string,
    effectiveTo: string,
    context: RequestContext,
  ): Promise<void> {
    for (const studentId of studentIds) {
      const pointers = await this.dynamoDBClient.queryGSI<AgreementMemberEntity>(
        client,
        'GSI2',
        GSIKeyBuilder.studentScope(context.tenantId, studentId),
        'AGREEMENT#',
        'begins_with',
        undefined,
        undefined,
        undefined,
        100,
        true,
      );

      // Review F8 — closed/inclusive interval check ([from..to], <=) to
      // match the resolver's closed date bound: an agreement is billable
      // ON its effectiveTo day, so two windows sharing a boundary day
      // both price that day and DO conflict.
      const conflict = pointers.items.find(
        (p) =>
          p.schoolId === schoolId &&
          (p.status === 'draft' || p.status === 'active') &&
          effectiveFrom <= p.effectiveTo &&
          p.effectiveFrom <= effectiveTo,
      );
      if (conflict) {
        throw new ConflictException({
          code: FinanceErrors.AGREEMENT_OVERLAP,
          message: `Student ${studentId} already has a ${conflict.status} agreement (${conflict.agreementId}) overlapping ${effectiveFrom}..${effectiveTo}.`,
          studentId,
          conflictingAgreementId: conflict.agreementId,
        });
      }
    }
  }

  /**
   * Review F2 — read one student's GSI2 INVOICE partition to exhaustion.
   * DynamoDB applies `Limit` BEFORE the FilterExpression (see the finance
   * dynamodb-client.service.ts `query` docstring), so a single limit-100
   * page can return zero matches while conflicting rows sit deeper in the
   * partition. Paginate on lastEvaluatedKey (page size 100, hard cap 25
   * pages); if rows remain past the cap, throw an operational 409 telling
   * staff to review manually — never silently pass.
   */
  private async queryStudentInvoicesExhaustive(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    studentId: string,
    filterExpression: string,
    expressionAttributeValues: Record<string, any>,
    expressionAttributeNames: Record<string, string>,
    context: RequestContext,
  ): Promise<InvoiceEntity[]> {
    const items: InvoiceEntity[] = [];
    let exclusiveStartKey: Record<string, any> | undefined;

    for (let page = 0; page < GSI2_INVOICE_SCAN_MAX_PAGES; page++) {
      const result = await this.dynamoDBClient.queryGSI<InvoiceEntity>(
        client,
        'GSI2',
        GSIKeyBuilder.studentScope(context.tenantId, studentId),
        'INVOICE',
        'begins_with',
        filterExpression,
        expressionAttributeValues,
        expressionAttributeNames,
        GSI2_INVOICE_SCAN_PAGE_SIZE,
        true,
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
        'automated conflict checking stopped at the safety cap. ' +
        'Review the student\'s open invoices manually before activating.',
      studentId,
    });
  }

  /**
   * FB-3.5(2) — existing-invoice conflict check at activation. Read-only
   * direct GSI2 queries in THIS service (importing invoices.service would
   * create a module cycle). Fee types resolve from the line item when
   * stamped; otherwise via FeeStructuresService.getByIds. Pages are read
   * to exhaustion (review F2).
   */
  private async findConflictingOpenInvoices(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    schoolId: string,
    agreement: BillingAgreementEntity,
    context: RequestContext,
  ): Promise<AgreementInvoiceConflict[]> {
    const covered = new Set<string>(agreement.coveredFeeTypes);
    const conflicts: AgreementInvoiceConflict[] = [];
    const seen = new Set<string>();

    for (const studentId of agreement.studentIds) {
      const invoices = await this.queryStudentInvoicesExhaustive(
        client,
        studentId,
        '#st IN (:issued, :partiallyPaid, :overdue) AND schoolId = :schoolId',
        {
          ':issued': 'issued',
          ':partiallyPaid': 'partially_paid',
          ':overdue': 'overdue',
          ':schoolId': schoolId,
        },
        { '#st': 'status' },
        context,
      );

      for (const invoice of invoices) {
        if (seen.has(invoice.invoiceId)) continue;
        // In-term only (epic §3.2): the invoice's billing window must touch
        // the agreement term. Missing dates are treated as in-term
        // (conservative — better a spurious warning than a silent miss).
        const inTerm =
          (!invoice.issuedDate || invoice.issuedDate <= agreement.effectiveTo) &&
          (!invoice.dueDate || invoice.dueDate >= agreement.effectiveFrom);
        if (!inTerm) continue;

        const lineFeeTypes = new Set<string>();
        const unresolvedFeeStructureIds: string[] = [];
        for (const line of invoice.lineItems ?? []) {
          if (line.isCustom) continue;
          if (line.feeType) lineFeeTypes.add(line.feeType);
          else if (line.feeStructureId) unresolvedFeeStructureIds.push(line.feeStructureId);
        }
        if (unresolvedFeeStructureIds.length > 0) {
          const feeStructures = await this.feeStructuresService.getByIds(
            schoolId,
            unresolvedFeeStructureIds,
            context,
          );
          for (const fs of feeStructures) lineFeeTypes.add(fs.feeType);
        }

        const matchedFeeTypes = [...lineFeeTypes].filter((ft) => covered.has(ft));
        if (matchedFeeTypes.length > 0) {
          seen.add(invoice.invoiceId);
          conflicts.push({
            invoiceId: invoice.invoiceId,
            invoiceNumber: invoice.invoiceNumber,
            grandTotal: invoice.grandTotal,
            matchedFeeTypes,
          });
        }
      }
    }

    return conflicts;
  }

  /**
   * FB-3.6 — financial-term change on an ACTIVE agreement creates a NEW
   * agreement row (version+1, versionParentId = chain root — fee-structures
   * semantics exactly) and supersedes the old one, atomically re-targeting
   * pointer rows (SK embeds agreementId → Delete+Put) and lock rows (keyed
   * by student → UpdateItem, preserving the deterministic lock key).
   *
   * The superseded row keeps its `version` untouched — an in-flight invoice
   * pinning (agreementId, agreementVersion) still resolves to the exact
   * terms it was priced from.
   */
  private async versionActiveAgreement(
    client: Awaited<ReturnType<DynamoDBClientService['getClient']>>,
    schoolId: string,
    existing: BillingAgreementEntity,
    dto: UpdateBillingAgreementDto,
    changedFields: string[],
    context: RequestContext,
  ): Promise<BillingAgreement> {
    const merged = this.mergeEntity(existing, dto, context);
    assertAgreementInvariants(merged);

    if (dto.studentIds !== undefined) {
      await this.validateEnrollment(merged.studentIds, schoolId, context);
    }
    if (merged.familyId && (dto.familyId !== undefined || dto.studentIds !== undefined)) {
      await this.validateFamilyMembership(merged.familyId, merged.studentIds, schoolId, context);
    }

    // Review P2-2: 2 base Puts + 2/removed + 3/kept + 2/added transact items;
    // 30-out/30-in composes 122 — over DDB's 100-item transactWrite ceiling.
    // Fail fast with an operator-actionable 400 instead of a raw
    // ValidationException 500 mid-transact.
    {
      const oldIds = new Set(existing.studentIds);
      const newIds = new Set(merged.studentIds);
      const removed = existing.studentIds.filter((id) => !newIds.has(id)).length;
      const kept = existing.studentIds.filter((id) => newIds.has(id)).length;
      const added = merged.studentIds.filter((id) => !oldIds.has(id)).length;
      const projected = 2 + 2 * removed + 3 * kept + 2 * added;
      if (projected > 100) {
        throw new BadRequestException({
          code: FinanceErrors.AGREEMENT_VERSION_TOO_LARGE,
          message:
            `Membership change too large for one atomic versioning (${projected} transact items > 100). `
            + 'Split the change across smaller updates, or cancel and recreate the agreement.',
        });
      }
    }

    const now = new Date().toISOString();
    const newId = uuid();
    const newVersion = existing.version + 1;

    const newEntity: BillingAgreementEntity = {
      ...merged,
      entityKey: EntityKeyBuilder.agreement(schoolId, newId),
      agreementId: newId,
      versionParentId: existing.versionParentId || existing.agreementId,
      version: newVersion,
      status: 'active',
      statusHistory: [
        {
          from: 'active',
          to: 'active',
          changedAt: now,
          changedBy: context.userId,
          reason: `Versioned from ${existing.agreementId} (v${existing.version})`,
        },
      ],
      gsi1sk: agreementGsi1sk('active', merged.effectiveFrom),
      createdAt: now,
      createdBy: context.userId,
      updatedAt: now,
      updatedBy: context.userId,
    };

    const supersededOld: BillingAgreementEntity = {
      ...existing,
      status: 'superseded',
      statusHistory: [
        ...(existing.statusHistory ?? []),
        {
          from: 'active',
          to: 'superseded',
          changedAt: now,
          changedBy: context.userId,
          reason: `Superseded by ${newId} (v${newVersion})`,
        },
      ],
      gsi1sk: agreementGsi1sk('superseded', existing.effectiveFrom),
      updatedAt: now,
      updatedBy: context.userId,
    };

    const tableName = this.dynamoDBClient.getTableName();
    const items: any[] = [];
    const descriptors: TransactItemDescriptor[] = [];

    items.push({ Put: { TableName: tableName, Item: newEntity as any } });
    descriptors.push({ kind: 'agreement' });

    items.push({
      Put: {
        TableName: tableName,
        Item: supersededOld as any,
        ConditionExpression: 'version = :expectedVersion AND #st = :active',
        ExpressionAttributeNames: { '#st': 'status' },
        ExpressionAttributeValues: {
          ':expectedVersion': existing.version,
          ':active': 'active',
        },
      },
    });
    descriptors.push({ kind: 'agreement' });

    const oldSet = new Set(existing.studentIds);
    const newSet = new Set(merged.studentIds);

    for (const removed of existing.studentIds.filter((id) => !newSet.has(id))) {
      items.push({
        Delete: {
          TableName: tableName,
          Key: {
            tenantId: context.tenantId,
            entityKey: EntityKeyBuilder.agreementMember(schoolId, removed, existing.agreementId),
          },
        },
      });
      descriptors.push({ kind: 'pointer-delete', studentId: removed });
      items.push({
        Delete: {
          TableName: tableName,
          Key: {
            tenantId: context.tenantId,
            entityKey: EntityKeyBuilder.agreementActiveLock(schoolId, removed),
          },
          ConditionExpression: 'attribute_not_exists(entityKey) OR agreementId = :oldId',
          ExpressionAttributeValues: { ':oldId': existing.agreementId },
        },
      });
      descriptors.push({ kind: 'lock-delete', studentId: removed });
    }

    for (const studentId of merged.studentIds) {
      const isKept = oldSet.has(studentId);
      if (isKept) {
        items.push({
          Delete: {
            TableName: tableName,
            Key: {
              tenantId: context.tenantId,
              entityKey: EntityKeyBuilder.agreementMember(
                schoolId,
                studentId,
                existing.agreementId,
              ),
            },
          },
        });
        descriptors.push({ kind: 'pointer-delete', studentId });
      }
      items.push(this.buildPointerPut(tableName, schoolId, studentId, newEntity, context));
      descriptors.push({ kind: 'pointer-put', studentId });

      if (isKept) {
        items.push({
          Update: {
            TableName: tableName,
            Key: {
              tenantId: context.tenantId,
              entityKey: EntityKeyBuilder.agreementActiveLock(schoolId, studentId),
            },
            UpdateExpression:
              'SET agreementId = :newId, effectiveTo = :effectiveTo, #ttl = :ttl',
            ConditionExpression: 'agreementId = :oldId',
            ExpressionAttributeNames: { '#ttl': 'ttl' },
            ExpressionAttributeValues: {
              ':newId': newId,
              ':oldId': existing.agreementId,
              ':effectiveTo': merged.effectiveTo,
              ':ttl': createAgreementActiveLockEntity(
                context.tenantId,
                schoolId,
                studentId,
                { agreementId: newId, effectiveTo: merged.effectiveTo },
                context.userId,
              ).ttl,
            },
          },
        });
        descriptors.push({ kind: 'lock-update', studentId });
      } else {
        const lock = createAgreementActiveLockEntity(
          context.tenantId,
          schoolId,
          studentId,
          { agreementId: newId, effectiveTo: merged.effectiveTo },
          context.userId,
        );
        items.push({
          Put: {
            TableName: tableName,
            Item: lock as any,
            ConditionExpression: 'attribute_not_exists(entityKey)',
          },
        });
        descriptors.push({ kind: 'lock-put', studentId });
      }
    }

    await this.executeTransact(client, items, descriptors);

    this.eventsService
      .publishAgreementVersioned(
        context.tenantId,
        schoolId,
        existing.agreementId,
        newId,
        newVersion,
        changedFields,
      )
      .catch((err) => this.logger.error(`Failed to publish AgreementVersioned: ${err.message}`));

    this.auditLogger.log(
      AuditAction.AGREEMENT_VERSIONED,
      { tenantId: context.tenantId, userId: context.userId, userEmail: context.email, userRole: context.role },
      { type: 'AGREEMENT', id: newId, name: newEntity.title },
      {
        schoolId,
        previousId: existing.agreementId,
        previousVersion: existing.version,
        newVersion,
        versionParentId: newEntity.versionParentId,
        changedFields,
      },
    );

    return billingAgreementEntityToDto(newEntity);
  }
}
