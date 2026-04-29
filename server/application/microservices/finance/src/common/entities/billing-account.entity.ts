/**
 * Billing Account Entity
 *
 * One billing account per student per school.
 * Tracks financial ledger: balance, total paid, last payment.
 *
 * PK: tenantId
 * SK: BILLING_ACCOUNT#{schoolId}#{studentId}
 * GSI1PK: TENANT#{tid}#SCHOOL#{schoolId}
 * GSI1SK: BILLING_ACCOUNT#{studentName}
 * GSI2PK: TENANT#{tid}#STUDENT#{studentId}
 * GSI2SK: BILLING_ACCOUNT#{schoolId}
 */

import { v4 as uuid } from 'uuid';
import { BaseEntity, EntityKeyBuilder, GSIKeyBuilder } from './base.entity';

export interface BillingAccountEntity extends BaseEntity {
  entityType: 'BILLING_ACCOUNT';
  accountId: string;
  studentId: string;
  schoolId: string;
  studentName: string;
  balance: number;
  totalPaid: number;
  lastPaymentDate: string | null;

  // GSI keys
  gsi1pk: string;
  gsi1sk: string;
  gsi2pk: string;
  gsi2sk: string;
}

export function createBillingAccountEntity(
  tenantId: string,
  schoolId: string,
  studentId: string,
  studentName: string,
  userId: string,
): BillingAccountEntity {
  const accountId = uuid();
  const now = new Date().toISOString();

  return {
    tenantId,
    entityKey: EntityKeyBuilder.billingAccount(schoolId, studentId),
    entityType: 'BILLING_ACCOUNT',
    accountId,
    studentId,
    schoolId,
    studentName,
    balance: 0,
    totalPaid: 0,
    lastPaymentDate: null,

    gsi1pk: GSIKeyBuilder.schoolScope(tenantId, schoolId),
    gsi1sk: GSIKeyBuilder.entitySort('BILLING_ACCOUNT', studentName.toUpperCase()),
    gsi2pk: GSIKeyBuilder.studentScope(tenantId, studentId),
    gsi2sk: `BILLING_ACCOUNT#${schoolId}`,

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}

// ============================================================================
// BILLING ACCOUNT LOOKUP (mirror row, Sprint C2.T3)
// ============================================================================

/**
 * Mirror-row entity keyed directly by `accountId`.
 *
 * PK: tenantId
 * SK: ACCOUNT#{accountId}
 *
 * Written in the SAME `TransactWriteItems` as the canonical `BillingAccount`
 * (see `StudentAccountsService.getOrCreate`). Enables:
 *
 *   1. O(1) read in `StudentAccountsService.getByAccountId` — direct GetItem
 *      replaces the prior GSI1 query + accountId filter (per-school O(N)).
 *   2. Transactional pre-conditions in Sprint C2.T4 — payment + invoice +
 *      ledger writes can include `accountId` resolution as a `ConditionCheck`
 *      inside `TransactWriteItems`, since the latter requires direct keys.
 *
 * The mirror row carries (schoolId, studentId, accountId) — enough to
 * reconstruct the canonical `BILLING_ACCOUNT#<schoolId>#<studentId>` SK
 * for a follow-up GetItem when the caller needs the live balance.
 *
 * No GSI participation. The canonical BillingAccount row covers GSI1
 * (school scope) and GSI2 (student scope); the lookup row exists solely
 * for direct-key access.
 */
export interface BillingAccountLookupEntity extends BaseEntity {
  entityType: 'BILLING_ACCOUNT_LOOKUP';
  accountId: string;
  schoolId: string;
  studentId: string;
  /** Convenience — same shape as `EntityKeyBuilder.billingAccount(schoolId, studentId)`. */
  billingAccountKey: string;
}

export function createBillingAccountLookupEntity(
  tenantId: string,
  accountId: string,
  schoolId: string,
  studentId: string,
  userId: string,
): BillingAccountLookupEntity {
  const now = new Date().toISOString();
  return {
    tenantId,
    entityKey: EntityKeyBuilder.billingAccountLookup(accountId),
    entityType: 'BILLING_ACCOUNT_LOOKUP',
    accountId,
    schoolId,
    studentId,
    billingAccountKey: EntityKeyBuilder.billingAccount(schoolId, studentId),

    createdAt: now,
    createdBy: userId,
    updatedAt: now,
    updatedBy: userId,
    version: 1,
  };
}
