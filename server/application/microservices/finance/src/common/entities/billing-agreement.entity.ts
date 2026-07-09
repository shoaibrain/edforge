/**
 * Billing Agreement Entities — EPIC-FB Sprint FB-2.2
 *
 * Three row shapes (design §3.2 of
 * docs/family-billing/family-billing-agreements-epic.md):
 *
 *   Agreement row:   PK tenantId   SK AGREEMENT#{schoolId}#{agreementId}
 *     gsi1pk TENANT#{tid}#SCHOOL#{schoolId}
 *     gsi1sk AGREEMENT#{status}#{effectiveFrom}      ← school-scoped listing
 *
 *   Member pointer:  PK tenantId   SK AGREEMENT_MEMBER#{schoolId}#{studentId}#{agreementId}
 *     gsi2pk TENANT#{tid}#STUDENT#{studentId}
 *     gsi2sk AGREEMENT#{status}#{effectiveTo}        ← "agreement for student" at invoice time
 *
 *   Activation lock: PK tenantId   SK AGREEMENT_ACTIVE_LOCK#{schoolId}#{studentId}
 *     agreementId, effectiveTo, ttl (= effectiveTo + 30-day grace; DDB TTL
 *     auto-clears — `timeToLiveAttribute: 'ttl'`, ecs-dynamodb.ts:40)
 *
 * The lock row follows the repo lock-entity precedent
 * (EXTERNAL_EXAM_SYMBOL_LOCK, ecs-dynamodb.ts:224-234): its key is
 * deterministic per (schoolId, studentId) — deliberately NOT including the
 * agreementId — so activation's `attribute_not_exists(entityKey)`
 * conditional put makes "at most one ACTIVE agreement per student" atomic.
 *
 * Finance GSI convention (epic risk R1): every GSI pk carries the
 * TENANT#{tid} prefix. GSIs have no LeadingKeys/ABAC protection, so the
 * application-layer prefix is the only tenant scoping on GSI reads —
 * pinned by billing-agreement.entity.spec.ts.
 *
 * @see packages/shared-types/src/schemas/finance/billing-agreement.schema.ts
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';
import type { StatusHistoryEntry } from './invoice.entity';
import type {
  AgreementPayer,
  AgreementStatus,
  AgreementTerms,
  AgreementType,
  FeeFrequency,
  FeeType,
} from '@aibrains/shared-types';

/** Lock TTL backstop: DDB clears the row this long after the term ends. */
export const AGREEMENT_LOCK_GRACE_DAYS = 30;

export interface BillingAgreementEntity extends BaseEntity {
  entityType: 'AGREEMENT';
  agreementId: string;
  schoolId: string;
  /** Academics FamilyGroup reference (snapshot-validated, never a live FK). */
  familyId?: string;
  title: string;
  payer: AgreementPayer;
  /** Snapshot — the agreement OWNS this list; family edits never mutate it. */
  studentIds: string[];
  agreementType: AgreementType;
  terms: AgreementTerms;
  coveredFeeTypes: FeeType[];
  billingFrequency: FeeFrequency;
  currency: string;
  /** AD ISO YYYY-MM-DD; BS is display-only. */
  effectiveFrom: string;
  effectiveTo: string;
  status: AgreementStatus;
  versionParentId?: string;
  approvedBy?: string;
  notes?: string;
  /** Soft-delete axis, orthogonal to `status` (P1d — never in response DTOs). */
  isActive: boolean;
  statusHistory: StatusHistoryEntry[];

  // GSI keys
  gsi1pk: string;
  gsi1sk: string;
}

export interface AgreementMemberEntity extends BaseEntity {
  entityType: 'AGREEMENT_MEMBER';
  agreementId: string;
  schoolId: string;
  studentId: string;
  /**
   * Duplicated from the agreement row at every status transition. The
   * resolver NEVER trusts this alone — it hydrates the agreement row and
   * re-verifies status + dates (FB-3.1; epic §3.3).
   */
  status: AgreementStatus;
  effectiveFrom: string;
  effectiveTo: string;

  // GSI keys
  gsi2pk: string;
  gsi2sk: string;
}

export interface AgreementActiveLockEntity {
  tenantId: string;
  entityKey: string;
  entityType: 'AGREEMENT_ACTIVE_LOCK';
  agreementId: string;
  schoolId: string;
  studentId: string;
  effectiveTo: string;
  /** Epoch seconds — MUST be named `ttl` (timeToLiveAttribute, ecs-dynamodb.ts:40). */
  ttl: number;
  createdAt: string;
  createdBy: string;
}

/**
 * EPIC-FB BH-1.1 (epic §3.6 R11) — per-term duplicate-billing lock. Written
 * ATOMICALLY with an AGREEMENT-priced invoice via `TransactWriteItems`
 * (`{Put: lock, ConditionExpression: attribute_not_exists(entityKey)}` +
 * `{Put: invoice}`), so two concurrent generations for the same
 * (schoolId, studentId, agreementChainId) can no longer both pass the
 * read-then-put guard and double-bill: the second transact's lock put fails
 * its condition and the whole transact rolls back (no invoice written).
 *
 * Pure sentinel — no BaseEntity/version/GSI (mirror of
 * AgreementActiveLockEntity). Keyed on the version CHAIN so FB-3.6
 * re-versioning cannot re-bill a term. TTL (`ttl`, effectiveTo + 30-day
 * grace via `agreementLockTtl`) auto-clears the row after the term.
 */
export interface AgreementTermLockEntity {
  tenantId: string;
  entityKey: string;
  entityType: 'AGREEMENT_TERM_LOCK';
  agreementChainId: string;
  agreementId: string;
  schoolId: string;
  studentId: string;
  /** Epoch seconds — MUST be named `ttl` (timeToLiveAttribute, ecs-dynamodb.ts:40). */
  ttl: number;
  createdAt: string;
  createdBy: string;
}

// ============================================================================
// GSI sort-key builders
// ============================================================================

export function agreementGsi1sk(status: AgreementStatus, effectiveFrom: string): string {
  return `AGREEMENT#${status}#${effectiveFrom}`;
}

export function agreementMemberGsi2sk(status: AgreementStatus, effectiveTo: string): string {
  return `AGREEMENT#${status}#${effectiveTo}`;
}

/**
 * Lock TTL: epoch seconds of `effectiveTo` (UTC midnight) + 30-day grace.
 * The TTL is the backstop only — cancel/supersede delete locks explicitly;
 * the resolver is date-bounded so a not-yet-cleared lock past effectiveTo
 * never affects billing (it only blocks a new activation until cleared,
 * which the next activation surfaces as a 409 the operator can act on).
 */
export function agreementLockTtl(effectiveTo: string): number {
  return (
    Math.floor(Date.parse(`${effectiveTo}T00:00:00Z`) / 1000) +
    AGREEMENT_LOCK_GRACE_DAYS * 24 * 60 * 60
  );
}

// ============================================================================
// Factories
// ============================================================================

export function createBillingAgreementEntity(
  tenantId: string,
  schoolId: string,
  data: {
    familyId?: string;
    title: string;
    payer: AgreementPayer;
    studentIds: string[];
    agreementType: AgreementType;
    terms: AgreementTerms;
    coveredFeeTypes: FeeType[];
    billingFrequency: FeeFrequency;
    currency: string;
    effectiveFrom: string;
    effectiveTo: string;
    notes?: string;
  },
  userId: string,
): BillingAgreementEntity {
  const agreementId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.agreement(schoolId, agreementId),
    entityType: 'AGREEMENT',
    agreementId,
    schoolId,
    familyId: data.familyId,
    title: data.title,
    payer: data.payer,
    studentIds: data.studentIds,
    agreementType: data.agreementType,
    terms: data.terms,
    coveredFeeTypes: data.coveredFeeTypes,
    billingFrequency: data.billingFrequency,
    currency: data.currency,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo,
    status: 'draft',
    notes: data.notes,
    isActive: true,
    statusHistory: [],

    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: agreementGsi1sk('draft', data.effectiveFrom),

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}

export function createAgreementMemberEntity(
  tenantId: string,
  schoolId: string,
  studentId: string,
  data: {
    agreementId: string;
    status: AgreementStatus;
    effectiveFrom: string;
    effectiveTo: string;
  },
  userId: string,
): AgreementMemberEntity {
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.agreementMember(schoolId, studentId, data.agreementId),
    entityType: 'AGREEMENT_MEMBER',
    agreementId: data.agreementId,
    schoolId,
    studentId,
    status: data.status,
    effectiveFrom: data.effectiveFrom,
    effectiveTo: data.effectiveTo,

    gsi2pk: GSIKeyBuilder.studentScope(tenantId, studentId),
    gsi2sk: agreementMemberGsi2sk(data.status, data.effectiveTo),

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}

export function createAgreementActiveLockEntity(
  tenantId: string,
  schoolId: string,
  studentId: string,
  data: {
    agreementId: string;
    effectiveTo: string;
  },
  userId: string,
): AgreementActiveLockEntity {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.agreementActiveLock(schoolId, studentId),
    entityType: 'AGREEMENT_ACTIVE_LOCK',
    agreementId: data.agreementId,
    schoolId,
    studentId,
    effectiveTo: data.effectiveTo,
    ttl: agreementLockTtl(data.effectiveTo),
    createdAt: new Date().toISOString(),
    createdBy: userId,
  };
}

export function createAgreementTermLockEntity(
  tenantId: string,
  schoolId: string,
  studentId: string,
  data: {
    agreementChainId: string;
    agreementId: string;
    effectiveTo: string;
  },
  userId: string,
): AgreementTermLockEntity {
  return {
    tenantId,
    entityKey: EntityKeyBuilder.agreementTermLock(schoolId, studentId, data.agreementChainId),
    entityType: 'AGREEMENT_TERM_LOCK',
    agreementChainId: data.agreementChainId,
    agreementId: data.agreementId,
    schoolId,
    studentId,
    ttl: agreementLockTtl(data.effectiveTo),
    createdAt: new Date().toISOString(),
    createdBy: userId,
  };
}
