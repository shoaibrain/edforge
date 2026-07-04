/**
 * Billing Agreement Mapper — EPIC-FB Sprint FB-2.3 / FB-3.5
 *
 * Entity → response DTO. Omits `isActive` (P1d), tenant/key/GSI plumbing.
 */

import type { BillingAgreement } from '@aibrains/shared-types';
import { BillingAgreementEntity } from '../entities/billing-agreement.entity';

export function billingAgreementEntityToDto(
  entity: BillingAgreementEntity,
  todayISO: string = new Date().toISOString().slice(0, 10),
): BillingAgreement {
  // Lazy expiry (epic §3.2): no background job flips active → expired.
  // An 'active' agreement past effectiveTo is PRESENTED as 'expired' —
  // display-only, no write. Billing is safe regardless: the FB-3.1
  // resolver is date-bounded and never trusts stored status alone.
  const status =
    entity.status === 'active' && entity.effectiveTo < todayISO
      ? 'expired'
      : entity.status;

  return {
    id: entity.agreementId,
    schoolId: entity.schoolId,
    ...(entity.familyId !== undefined && { familyId: entity.familyId }),
    title: entity.title,
    payer: entity.payer,
    studentIds: entity.studentIds,
    agreementType: entity.agreementType,
    terms: entity.terms,
    coveredFeeTypes: entity.coveredFeeTypes,
    billingFrequency: entity.billingFrequency,
    currency: entity.currency,
    effectiveFrom: entity.effectiveFrom,
    effectiveTo: entity.effectiveTo,
    status,
    version: entity.version,
    ...(entity.versionParentId !== undefined && { versionParentId: entity.versionParentId }),
    ...(entity.approvedBy !== undefined && { approvedBy: entity.approvedBy }),
    ...(entity.notes !== undefined && { notes: entity.notes }),
    statusHistory: entity.statusHistory ?? [],
    createdBy: entity.createdBy,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
  } as BillingAgreement;
}
