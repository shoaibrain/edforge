import { BillingAccountEntity } from '../entities/billing-account.entity';
import type { BillingAccount } from '@aibrains/shared-types';

/**
 * Map BillingAccount entity → response DTO.
 *
 * Pilot Onboarding Hardening Sprint PD.1.6-rev1 (post-PD.2.1 discovery
 * workflow) — `openingBalanceRemaining` is computed from the
 * denormalized `openingBalanceSettled` counter on the entity, NOT from
 * a ledger scan or a caller-supplied enrichment.
 *
 *   openingBalanceRemaining = openingBalance − (openingBalanceSettled ?? 0)
 *   (clamped to ≥ 0 as defense against a corrupted counter)
 *
 * The counter is maintained atomically by Sprint PD.2.3 in the SAME
 * `TransactWriteItems` that writes a payment-against-opening ledger
 * entry. In PD.1 (no settlements yet) the counter is undefined and
 * remaining equals `openingBalance`.
 *
 * Back-compat: pre-PD accounts have all 4 fields undefined; their DTO
 * omits them too.
 */
export function billingAccountEntityToDto(
  entity: BillingAccountEntity,
): BillingAccount {
  const openingBalanceRemaining =
    entity.openingBalance != null
      ? Math.max(0, entity.openingBalance - (entity.openingBalanceSettled ?? 0))
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
