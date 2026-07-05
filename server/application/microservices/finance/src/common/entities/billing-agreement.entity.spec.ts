/**
 * Billing Agreement Entity Spec — EPIC-FB Sprint FB-2.2
 *
 * Coverage (mirrors academics family.entity.spec.ts idiom):
 *   - Factories produce correct entity shape + EXACT key strings (epic §3.2)
 *   - EVERY finance GSI pk carries the TENANT#{tid} prefix (epic risk R1 —
 *     GSIs have no LeadingKeys/ABAC protection; the application-layer
 *     prefix is the only tenant scoping on GSI reads)
 *   - tenantId stored as bare UUID (memory
 *     `edforge_identity_ddb_bare_uuid_partition_key`)
 *   - Lock TTL = epoch(effectiveTo UTC midnight) + 30-day grace (FB-3.5)
 */

import { describe, expect, it } from '@jest/globals';
import {
  AGREEMENT_LOCK_GRACE_DAYS,
  agreementGsi1sk,
  agreementLockTtl,
  agreementMemberGsi2sk,
  createAgreementActiveLockEntity,
  createAgreementMemberEntity,
  createBillingAgreementEntity,
} from './billing-agreement.entity';
import { EntityKeyBuilder, GSIKeyBuilder } from './base.entity';
import type { AgreementTerms } from '@aibrains/shared-types';

const TENANT    = '11111111-1111-1111-1111-111111111111';
const SCHOOL    = '22222222-2222-2222-2222-222222222222';
const AGREEMENT = '33333333-3333-3333-3333-333333333333';
const STUDENT_A = '44444444-4444-4444-4444-444444444444';
const STUDENT_B = '55555555-5555-5555-5555-555555555555';
const USER      = 'user-uuid';

const fixedTotalTerms: AgreementTerms = {
  agreementType: 'fixed_total',
  totalAmount: 40000,
  allocation: [
    { studentId: STUDENT_A, amount: 25000 },
    { studentId: STUDENT_B, amount: 15000 },
  ],
};

const agreementData = {
  title: 'Adhikari family 2083 deal',
  payer: { name: 'Ram Adhikari', phone: '+977-9800000000' },
  studentIds: [STUDENT_A, STUDENT_B],
  agreementType: 'fixed_total' as const,
  terms: fixedTotalTerms,
  coveredFeeTypes: ['tuition', 'admission'] as Array<'tuition' | 'admission'>,
  billingFrequency: 'annual' as const,
  currency: 'NPR',
  effectiveFrom: '2026-04-14',
  effectiveTo: '2027-04-13',
};

describe('createBillingAgreementEntity', () => {
  it('returns an entity with the right entityType + entityKey', () => {
    const entity = createBillingAgreementEntity(TENANT, SCHOOL, agreementData, USER);
    expect(entity.entityType).toBe('AGREEMENT');
    expect(entity.entityKey).toBe(`AGREEMENT#${SCHOOL}#${entity.agreementId}`);
    expect(entity.entityKey).toBe(EntityKeyBuilder.agreement(SCHOOL, entity.agreementId));
  });

  it('stores tenantId as bare UUID (per memory)', () => {
    const entity = createBillingAgreementEntity(TENANT, SCHOOL, agreementData, USER);
    expect(entity.tenantId).toBe(TENANT);
    expect(entity.tenantId.startsWith('TENANT#')).toBe(false);
  });

  it('pins gsi1pk to TENANT#{tid}#SCHOOL#{schoolId} — TENANT# prefix per risk R1', () => {
    const entity = createBillingAgreementEntity(TENANT, SCHOOL, agreementData, USER);
    expect(entity.gsi1pk).toBe(`TENANT#${TENANT}#SCHOOL#${SCHOOL}`);
    expect(entity.gsi1pk).toBe(GSIKeyBuilder.schoolScope(TENANT, SCHOOL));
    expect(entity.gsi1pk.startsWith(`TENANT#${TENANT}`)).toBe(true);
  });

  it('pins gsi1sk to AGREEMENT#{status}#{effectiveFrom} (born draft)', () => {
    const entity = createBillingAgreementEntity(TENANT, SCHOOL, agreementData, USER);
    expect(entity.gsi1sk).toBe('AGREEMENT#draft#2026-04-14');
    expect(entity.gsi1sk).toBe(agreementGsi1sk('draft', '2026-04-14'));
  });

  it('is born draft, isActive=true, version=1, empty statusHistory', () => {
    const entity = createBillingAgreementEntity(TENANT, SCHOOL, agreementData, USER);
    expect(entity.status).toBe('draft');
    expect(entity.isActive).toBe(true);
    expect(entity.version).toBe(1);
    expect(entity.statusHistory).toEqual([]);
    expect(entity.versionParentId).toBeUndefined();
  });

  it('round-trips terms, coveredFeeTypes, payer, dates, familyId, notes', () => {
    const entity = createBillingAgreementEntity(
      TENANT,
      SCHOOL,
      { ...agreementData, familyId: AGREEMENT, notes: 'negotiated at intake' },
      USER,
    );
    expect(entity.schoolId).toBe(SCHOOL);
    expect(entity.familyId).toBe(AGREEMENT);
    expect(entity.terms).toEqual(fixedTotalTerms);
    expect(entity.coveredFeeTypes).toEqual(['tuition', 'admission']);
    expect(entity.payer).toEqual({ name: 'Ram Adhikari', phone: '+977-9800000000' });
    expect(entity.effectiveFrom).toBe('2026-04-14');
    expect(entity.effectiveTo).toBe('2027-04-13');
    expect(entity.notes).toBe('negotiated at intake');
    expect(entity.createdAt).toBe(entity.updatedAt);
    expect(entity.createdBy).toBe(USER);
  });
});

describe('createAgreementMemberEntity', () => {
  const memberData = {
    agreementId: AGREEMENT,
    status: 'draft' as const,
    effectiveFrom: '2026-04-14',
    effectiveTo: '2027-04-13',
  };

  it('returns an entity with the right entityType + entityKey', () => {
    const entity = createAgreementMemberEntity(TENANT, SCHOOL, STUDENT_A, memberData, USER);
    expect(entity.entityType).toBe('AGREEMENT_MEMBER');
    expect(entity.entityKey).toBe(`AGREEMENT_MEMBER#${SCHOOL}#${STUDENT_A}#${AGREEMENT}`);
    expect(entity.entityKey).toBe(
      EntityKeyBuilder.agreementMember(SCHOOL, STUDENT_A, AGREEMENT),
    );
  });

  it('pins gsi2pk to TENANT#{tid}#STUDENT#{studentId} — TENANT# prefix per risk R1 (finance convention, NOT the bare academics one)', () => {
    const entity = createAgreementMemberEntity(TENANT, SCHOOL, STUDENT_A, memberData, USER);
    expect(entity.gsi2pk).toBe(`TENANT#${TENANT}#STUDENT#${STUDENT_A}`);
    expect(entity.gsi2pk).toBe(GSIKeyBuilder.studentScope(TENANT, STUDENT_A));
    expect(entity.gsi2pk.startsWith(`TENANT#${TENANT}`)).toBe(true);
  });

  it('pins gsi2sk to AGREEMENT#{status}#{effectiveTo} (date-bounded resolver contract, FB-3.1)', () => {
    const entity = createAgreementMemberEntity(TENANT, SCHOOL, STUDENT_A, memberData, USER);
    expect(entity.gsi2sk).toBe('AGREEMENT#draft#2027-04-13');
    expect(entity.gsi2sk).toBe(agreementMemberGsi2sk('draft', '2027-04-13'));
  });

  it('re-keys gsi2sk when built with active status (pointer status sync shape)', () => {
    const entity = createAgreementMemberEntity(
      TENANT,
      SCHOOL,
      STUDENT_A,
      { ...memberData, status: 'active' },
      USER,
    );
    expect(entity.gsi2sk).toBe('AGREEMENT#active#2027-04-13');
  });

  it('carries agreementId, schoolId, studentId, status, both dates', () => {
    const entity = createAgreementMemberEntity(TENANT, SCHOOL, STUDENT_B, memberData, USER);
    expect(entity.agreementId).toBe(AGREEMENT);
    expect(entity.schoolId).toBe(SCHOOL);
    expect(entity.studentId).toBe(STUDENT_B);
    expect(entity.status).toBe('draft');
    expect(entity.effectiveFrom).toBe('2026-04-14');
    expect(entity.effectiveTo).toBe('2027-04-13');
    expect(entity.tenantId).toBe(TENANT);
  });
});

describe('createAgreementActiveLockEntity', () => {
  const lockData = { agreementId: AGREEMENT, effectiveTo: '2027-04-13' };

  it('pins the deterministic per-student key — NO agreementId in the key (that is the whole point of the lock)', () => {
    const entity = createAgreementActiveLockEntity(TENANT, SCHOOL, STUDENT_A, lockData, USER);
    expect(entity.entityType).toBe('AGREEMENT_ACTIVE_LOCK');
    expect(entity.entityKey).toBe(`AGREEMENT_ACTIVE_LOCK#${SCHOOL}#${STUDENT_A}`);
    expect(entity.entityKey).toBe(EntityKeyBuilder.agreementActiveLock(SCHOOL, STUDENT_A));
    expect(entity.entityKey).not.toContain(AGREEMENT);
  });

  it('carries agreementId + effectiveTo for holder lookup on contention', () => {
    const entity = createAgreementActiveLockEntity(TENANT, SCHOOL, STUDENT_A, lockData, USER);
    expect(entity.agreementId).toBe(AGREEMENT);
    expect(entity.schoolId).toBe(SCHOOL);
    expect(entity.studentId).toBe(STUDENT_A);
    expect(entity.effectiveTo).toBe('2027-04-13');
    expect(entity.tenantId).toBe(TENANT);
  });

  it('sets ttl = epoch(effectiveTo UTC midnight) + 30-day grace (FB-3.5)', () => {
    const entity = createAgreementActiveLockEntity(TENANT, SCHOOL, STUDENT_A, lockData, USER);
    const expected =
      Math.floor(Date.UTC(2027, 3, 13) / 1000) + AGREEMENT_LOCK_GRACE_DAYS * 24 * 60 * 60;
    expect(entity.ttl).toBe(expected);
    expect(agreementLockTtl('2027-04-13')).toBe(expected);
  });

  it('agreementLockTtl grace delta is exactly 30 days of seconds', () => {
    expect(agreementLockTtl('2026-12-31') - Math.floor(Date.UTC(2026, 11, 31) / 1000)).toBe(
      30 * 86400,
    );
  });
});

describe('finance GSI tenant-prefix invariant (epic risk R1)', () => {
  // GSIs carry NO infrastructure-level tenant protection (no LeadingKeys,
  // no ABAC — epic §4.5). The TENANT#{tid} prefix on every finance GSI pk
  // is the only isolation layer for GSI reads. Pin it for every agreement
  // row shape that populates a GSI.
  it('every GSI pk emitted by the agreement factories starts with TENANT#{tid}', () => {
    const agreement = createBillingAgreementEntity(TENANT, SCHOOL, agreementData, USER);
    const member = createAgreementMemberEntity(
      TENANT,
      SCHOOL,
      STUDENT_A,
      { agreementId: AGREEMENT, status: 'draft', effectiveFrom: '2026-04-14', effectiveTo: '2027-04-13' },
      USER,
    );

    const gsiPks = [agreement.gsi1pk, member.gsi2pk];
    for (const pk of gsiPks) {
      expect(pk.startsWith(`TENANT#${TENANT}#`)).toBe(true);
    }
  });

  it('lock rows populate NO GSI keys (main-table conditional put only)', () => {
    const lock = createAgreementActiveLockEntity(
      TENANT,
      SCHOOL,
      STUDENT_A,
      { agreementId: AGREEMENT, effectiveTo: '2027-04-13' },
      USER,
    ) as unknown as Record<string, unknown>;
    expect(lock.gsi1pk).toBeUndefined();
    expect(lock.gsi2pk).toBeUndefined();
  });
});

describe('key builders', () => {
  it('EntityKeyBuilder.agreement has expected shape', () => {
    expect(EntityKeyBuilder.agreement(SCHOOL, AGREEMENT)).toBe(
      `AGREEMENT#${SCHOOL}#${AGREEMENT}`,
    );
  });

  it('EntityKeyBuilder.agreementMember has expected shape', () => {
    expect(EntityKeyBuilder.agreementMember(SCHOOL, STUDENT_A, AGREEMENT)).toBe(
      `AGREEMENT_MEMBER#${SCHOOL}#${STUDENT_A}#${AGREEMENT}`,
    );
  });

  it('EntityKeyBuilder.agreementActiveLock has expected shape', () => {
    expect(EntityKeyBuilder.agreementActiveLock(SCHOOL, STUDENT_A)).toBe(
      `AGREEMENT_ACTIVE_LOCK#${SCHOOL}#${STUDENT_A}`,
    );
  });

  it('agreementGsi1sk / agreementMemberGsi2sk carry the AGREEMENT# begins_with discriminator', () => {
    expect(agreementGsi1sk('active', '2026-04-14')).toBe('AGREEMENT#active#2026-04-14');
    expect(agreementMemberGsi2sk('cancelled', '2027-04-13')).toBe(
      'AGREEMENT#cancelled#2027-04-13',
    );
  });
});
