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

  // ──────────────────────────────────────────────────────────────────────────
  // Pilot Onboarding Hardening Sprint PD.1.1 — opening-balance snapshot
  // ──────────────────────────────────────────────────────────────────────────
  // Stores the carry-forward of money owed prior to EdForge. All three
  // fields are sparse — pre-PD accounts leave them undefined and parse
  // through the response mapper unchanged (back-compat).
  //
  // CURRENT-VALUE-ONLY design: we store ONLY the effective opening
  // balance after any revisions. The FULL revision history is
  // reconstructible from the audit trail (`finance.opening_balance.set`
  // + `finance.opening_balance.revised` events carry `{ oldAmount,
  // newAmount, delta }` in metadata). Keeping the entity narrow and
  // the audit trail authoritative matches the append-only ledger
  // invariant (revisions emit `'adjustment'` ledger entries; the
  // original `'opening_balance'` entry is never mutated).
  //
  // `balance` (the existing field) includes `openingBalance` in its
  // running total from the moment `setOpeningBalance` is called.
  // Payment allocation (Sprint PD.2) decrements both `balance` AND
  // the derived `openingBalanceRemaining` (server-computed on read).
  /** Current effective opening balance (after any revisions). Currency = account currency. */
  openingBalance?: number;
  /** AD `YYYY-MM-DD` — operator's stated "as of" date. */
  openingBalanceAsOf?: string;
  /** Operator-supplied free text (≤ 500 chars). */
  openingBalanceNote?: string;
  /**
   * PD.1.6-rev1 — denormalized running total of payments allocated against
   * `openingBalance`. Maintained atomically by Sprint PD.2.3
   * (`recordManualPayment` / `completePayment`) in the SAME
   * `TransactWriteItems` that writes the payment-against-opening ledger
   * entry. Read pattern: `openingBalanceRemaining = openingBalance −
   * openingBalanceSettled` → O(1), no ledger scan, atomically consistent
   * with payment commit.
   *
   * Why a denormalized counter vs. ledger scan: a `GSI2 + FilterExpression`
   * scan over `entryType='payment'` + description LIKE would be (a)
   * fragile (string-coupling on description), (b) susceptible to
   * Limit-before-Filter starvation on accounts with high payment volume,
   * and (c) not consistent with the payment commit (eventual). The counter
   * collapses all three concerns into a single atomic write.
   *
   * Sparse: undefined for pre-PD accounts AND for PD accounts that have
   * an `openingBalance` but no settlements yet (Sprint PD.1's
   * post-setOpeningBalance state). PD.2.3 initializes via
   * `if_not_exists(openingBalanceSettled, :zero)` in its UpdateExpression.
   */
  openingBalanceSettled?: number;

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
