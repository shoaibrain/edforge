/**
 * Payment Entity
 *
 * Records payments against invoices. Supports both gateway and manual payments.
 *
 * PK: tenantId
 * SK: PAYMENT#{schoolId}#{paymentId}
 * GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI1SK: PAYMENT#{status}#{paidAt}
 * GSI2PK: TENANT#{tid}#STUDENT#{studentId} (via account lookup)
 * GSI2SK: PAYMENT#{createdAt}
 *
 * EPIC-FB FB-4.1/FB-4.4 — GSI2 is SINGLE-STUDENT-OR-ABSENT (epic §3.4
 * pt 2): a multi-target family payment (≥2 invoice applications, no
 * single studentId) carries NO gsi2 keys. Per-student visibility for
 * family payments flows through LEDGER ENTRIES — each student's ledger
 * records its share referencing the paymentId, and that is the
 * per-student system of record for money movement. School-scoped lists
 * (GSI1) show family payments normally.
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';
import type { PaymentStatus, PaymentGateway } from '@aibrains/shared-types';

export interface RefundData {
  id: string;
  paymentId: string;
  amount: number;
  reason: string;
  gatewayRefundId?: string;
  status: 'pending' | 'completed' | 'failed';
  refundedAt: string | null;
  createdAt: string;
}

/**
 * Pilot Onboarding Hardening Sprint PD.2.1 — per-target allocation
 * breakdown for a payment.
 *
 * Discriminated union: a single payment can split across invoice(s)
 * AND (single-target only) the account's opening balance.
 *
 *   - Single-target: 0..1 `'invoice'` application + optional
 *     `'opening_balance'` application; `payment.invoiceId` carries the
 *     invoice application's id.
 *   - Multi-target (EPIC-FB FB-4.4): 2..20 distinct `'invoice'`
 *     applications, NO opening entry; top-level ids null.
 *   - Sum of `applications[].amount` MUST equal `payment.amount`.
 *
 * Pre-PD payments have `applications` undefined and carry the legacy
 * single-invoice shape (`invoiceId` populated, no breakdown).
 *
 * Why a discriminated union (NOT flat optionals):
 *   - Compile-time guarantee that `invoiceId` is non-null on
 *     `'invoice'` entries
 *   - Type-narrowing in mapper, PDF renderer, ledger composer
 *   - No null-juggling on `invoiceId` for opening-balance entries
 */
export type PaymentApplication =
  | { targetType: 'invoice'; invoiceId: string; amount: number }
  | { targetType: 'opening_balance'; amount: number };

export interface PaymentEntity extends BaseEntity {
  entityType: 'PAYMENT';
  paymentId: string;
  /**
   * EPIC-FB FB-4.1 — null ⟺ multi-target family payment (≥2 invoice
   * applications; the row belongs to no single invoice). Populated on
   * single-invoice payments (pre-FB rows + the legacy path unchanged).
   */
  invoiceId: string | null;
  /** EPIC-FB FB-4.1 — null ⟺ multi-target (no single billing account). */
  studentAccountId: string | null;
  schoolId: string;
  /** EPIC-FB FB-4.1 — null ⟺ multi-target (no single student; see GSI2 note above). */
  studentId: string | null;
  /**
   * EPIC-FB FB-4.1 — optional reporting stamp: the academics FamilyGroup a
   * multi-target payment was recorded against. Display/rollup only —
   * never used for money movement.
   */
  familyId?: string;
  /**
   * EPIC-FB FB-4.5 — denormalized invoiceIds of the 'invoice'
   * applications, stored ONLY on multi-target rows so
   * `listByInvoice` can match them with a `contains(...)`
   * FilterExpression (a DDB filter cannot reach into the
   * applications[] object list). Entity-internal; never on the DTO.
   */
  applicationInvoiceIds?: string[];
  amount: number;
  /**
   * ISO-4217 currency code, copied from the invoice this payment belongs to
   * (so it always matches `invoice.currency` — Sprint C2.T2 enforces this
   * at recording time, refusing payments whose `currency` mismatches the
   * referenced invoice).
   */
  currency: string;
  gateway: PaymentGateway;
  gatewayTransactionId?: string;
  gatewaySessionId?: string;
  status: PaymentStatus;
  paidAt: string | null;
  paidBy: string | null;
  receiptNumber: string | null;
  metadata: Record<string, unknown>;
  refunds: RefundData[];
  idempotencyKey?: string;

  /**
   * Sprint A.2 — denormalized snapshot from the parent invoice's
   * `gradeLevel` at payment-creation time. Lets the upcoming GSI14
   * (Sprint A.3) answer "all Grade 4 payments for school X this
   * period" with a single Query, without a JOIN against invoice rows
   * on every read. Snapshot semantics — never updated on student
   * promotion, just like `InvoiceEntity.gradeLevel`.
   *
   * Undefined when the parent invoice's gradeLevel is unresolved
   * (post-A.1 invoices) OR when the invoice predates A.1 entirely
   * (backfill case — Sprint A.5 fills both invoice + payment
   * snapshots in lockstep).
   */
  gradeLevel?: string;
  /**
   * Sprint A.2 — companion to `gradeLevel`. Same `'resolved' | 'unresolved'`
   * semantics as on InvoiceEntity. Internal-only per CLAUDE.md `[P1d]`
   * — never emitted on the response DTO; only consumed by backend
   * filter logic and the "Unknown" UI bucket (Sprint B.2).
   */
  gradeLevelResolutionStatus?: 'resolved' | 'unresolved';

  /**
   * Pilot Onboarding Hardening Sprint PD.2.1 — per-target allocation
   * breakdown. Optional + sparse:
   *
   *   - Pre-PD payments: `applications` undefined; `invoiceId` is the
   *     legacy single-invoice target.
   *   - Post-PD single-target payments: `applications` populated with
   *     ≤1 `'invoice'` entry (+ optional `'opening_balance'`);
   *     `invoiceId` mirrors the invoice entry.
   *   - EPIC-FB FB-4.4 multi-target payments: 2..20 DISTINCT `'invoice'`
   *     entries, NO `'opening_balance'` entry (multi-target payments do
   *     not settle opening balances in V1), and null top-level
   *     invoiceId/studentAccountId/studentId.
   *
   * Shared invariants (enforced by `PaymentsService` + the FB-4.2
   * response-schema superRefine):
   *   - `applications.length ≥ 1`
   *   - invoice entries BEFORE the opening entry (ledger ordering contract)
   *   - `Σ(applications.amount) === payment.amount` (±0.01)
   */
  applications?: PaymentApplication[];

  // GSI keys
  gsi1pk: string;
  gsi1sk: string;
  // FB-4.1 — absent on multi-target family payments (single-student-or-
  // absent GSI2; see file header).
  gsi2pk?: string;
  gsi2sk?: string;
  /**
   * Sprint A.3 — GSI14 sparse keys for school + gradeLevel scope.
   * Mirrors InvoiceEntity; gsi14sk uses `PAYMENT#{createdAt}` so a
   * single Query against gsi14pk + `begins_with(gsi14sk, 'PAYMENT#')`
   * returns all payments for school + grade in chronological order.
   * Sparse: only populated when the snapshot `gradeLevel` is truthy.
   */
  gsi14pk?: string;
  gsi14sk?: string;
}

export function createPaymentEntity(
  tenantId: string,
  schoolId: string,
  data: {
    /** FB-4.1 — null for multi-target family payments (≥2 invoice applications). */
    invoiceId: string | null;
    /** FB-4.1 — null for multi-target family payments. */
    studentAccountId: string | null;
    /** FB-4.1 — null for multi-target family payments (drops the GSI2 keys). */
    studentId: string | null;
    /** FB-4.1 — optional family reporting stamp (multi-target only). */
    familyId?: string;
    amount: number;
    currency: string;
    gateway: PaymentGateway;
    gatewaySessionId?: string;
    paidBy?: string;
    idempotencyKey?: string;
    /** Sprint A.2 — snapshot from parent invoice's gradeLevel. */
    gradeLevel?: string;
    /** Sprint A.2 — companion status. */
    gradeLevelResolutionStatus?: 'resolved' | 'unresolved';
    /**
     * Pilot PD.2.1 — pre-built allocation breakdown. Optional; pre-PD
     * call sites omit and get the legacy single-invoice shape. Caller
     * is responsible for the FB-4.1 representation matrix: exactly 1
     * invoice entry ⟺ top-level invoiceId equals it; ≥2 entries ⟺
     * invoiceId/studentAccountId/studentId are null.
     */
    applications?: PaymentApplication[];
  },
  userId: string,
): PaymentEntity {
  const paymentId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.payment(schoolId, paymentId),
    entityType: 'PAYMENT',
    paymentId,
    invoiceId: data.invoiceId,
    studentAccountId: data.studentAccountId,
    schoolId,
    studentId: data.studentId,
    amount: data.amount,
    currency: data.currency,
    gateway: data.gateway,
    gatewaySessionId: data.gatewaySessionId,
    status: 'pending',
    paidAt: null,
    paidBy: data.paidBy || userId,
    receiptNumber: null,
    metadata: {},
    refunds: [],
    idempotencyKey: data.idempotencyKey,
    ...(data.familyId ? { familyId: data.familyId } : {}),
    gradeLevel: data.gradeLevel,
    gradeLevelResolutionStatus: data.gradeLevelResolutionStatus,
    // PD.2.1 — sparse; only set when caller supplies (post-PD flow).
    ...(data.applications ? { applications: data.applications } : {}),
    // FB-4.5 — denormalized invoice targets, multi-target rows only
    // (listByInvoice contains() filter; see interface JSDoc).
    ...(data.invoiceId === null && data.applications
      ? {
          applicationInvoiceIds: data.applications
            .filter((a): a is Extract<PaymentApplication, { targetType: 'invoice' }> => a.targetType === 'invoice')
            .map(a => a.invoiceId),
        }
      : {}),

    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('PAYMENT', `pending#${now}`),
    // FB-4.1 — GSI2 single-student-or-absent (epic §3.4 pt 2): multi-
    // target family payments carry NO student-scope keys; per-student
    // visibility flows through ledger entries (see file header).
    ...(data.studentId !== null
      ? {
          gsi2pk: GSIKeyBuilder.studentScope(tenantId, data.studentId),
          gsi2sk: `PAYMENT#${now}`,
        }
      : {}),
    // Sprint A.3 — sparse GSI14 (school + grade scope). Mirror of
    // InvoiceEntity; only set when the snapshot gradeLevel is truthy.
    ...(data.gradeLevel
      ? {
          gsi14pk: GSIKeyBuilder.schoolGradeScope(tenantId, schoolId, data.gradeLevel),
          gsi14sk: GSIKeyBuilder.entitySort('PAYMENT', now),
        }
      : {}),

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
