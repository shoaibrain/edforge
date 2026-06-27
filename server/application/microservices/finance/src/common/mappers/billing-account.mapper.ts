import { BillingAccountEntity } from '../entities/billing-account.entity';
import type { BillingAccount } from '@aibrains/shared-types';

/**
 * Map BillingAccount entity → response DTO.
 *
 * Pilot Onboarding Hardening Sprint PD.1.6 — passes through the 4 new
 * opening-balance fields (3 entity fields + server-computed
 * `openingBalanceRemaining`).
 *
 * `openingBalanceRemaining` semantics:
 *   - In PD.1 (no payment-against-opening yet) it equals
 *     `openingBalance` — no settlements exist.
 *   - In PD.2 (payment allocation against opening balance) the caller
 *     supplies the settled amount via `enrichment.settledAgainstOpening`
 *     and the mapper computes `openingBalance − settled`. Caller is
 *     responsible for fetching the settled amount via the ledger
 *     query (1 GSI2 Query per account; PD.1.6 leaves this caller-
 *     supplied because PD.1 has no settlements to fetch).
 *
 * Both fields are sparse: pre-PD accounts omit them entirely.
 */
export function billingAccountEntityToDto(
  entity: BillingAccountEntity,
  enrichment?: { settledAgainstOpening?: number },
): BillingAccount {
  const openingBalanceRemaining =
    entity.openingBalance != null
      ? Math.max(0, entity.openingBalance - (enrichment?.settledAgainstOpening ?? 0))
      : undefined;

  return {
    id: entity.accountId,
    studentId: entity.studentId,
    schoolId: entity.schoolId,
    studentName: entity.studentName,
    balance: entity.balance,
    totalPaid: entity.totalPaid,
    lastPaymentDate: entity.lastPaymentDate,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,

    // PD.1.6 — sparse opening-balance fields.
    openingBalance: entity.openingBalance,
    openingBalanceAsOf: entity.openingBalanceAsOf,
    openingBalanceNote: entity.openingBalanceNote,
    openingBalanceRemaining,
  };
}
