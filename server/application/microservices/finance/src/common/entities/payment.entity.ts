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
 * Discriminated union: a single payment can split across an invoice
 * AND the account's opening balance. In V1 (pilot scope) ONLY this
 * shape is supported:
 *
 *   - Exactly 0 or 1 `'invoice'` application + optional `'opening_balance'`
 *     application — multi-invoice splits are deferred to a later sprint.
 *   - Sum of `applications[].amount` MUST equal `payment.amount`.
 *
 * Back-compat invariant: the top-level `payment.invoiceId` carries the
 * FIRST `'invoice'` application's invoiceId. Pre-PD payments have
 * `applications` undefined and carry the legacy single-invoice shape
 * (`invoiceId` populated, no breakdown).
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
  invoiceId: string;
  studentAccountId: string;
  schoolId: string;
  studentId: string;
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
   *   - Post-PD payments: `applications` populated; `invoiceId` mirrors
   *     `applications[i].invoiceId` for the first `'invoice'` entry.
   *
   * V1 invariants (enforced by `PaymentsService.recordManualPayment` +
   * `completePayment`):
   *   - `applications.length ≥ 1`
   *   - At most 1 `'invoice'` entry; at most 1 `'opening_balance'` entry
   *   - Invoice entry, if present, appears FIRST (ledger ordering contract)
   *   - `Σ(applications.amount) === payment.amount`
   *
   * V1 explicitly does NOT support multi-invoice splits.
   */
  applications?: PaymentApplication[];

  // GSI keys
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
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
    invoiceId: string;
    studentAccountId: string;
    studentId: string;
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
     * is responsible for ensuring `Σ(applications.amount) === amount`
     * AND `applications[0]?.invoiceId === data.invoiceId` (the invoice
     * application's id must match the top-level scalar).
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
    gradeLevel: data.gradeLevel,
    gradeLevelResolutionStatus: data.gradeLevelResolutionStatus,
    // PD.2.1 — sparse; only set when caller supplies (post-PD flow).
    ...(data.applications ? { applications: data.applications } : {}),

    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('PAYMENT', `pending#${now}`),
    gsi2pk: GSIKeyBuilder.studentScope(tenantId, data.studentId),
    gsi2sk: `PAYMENT#${now}`,
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
