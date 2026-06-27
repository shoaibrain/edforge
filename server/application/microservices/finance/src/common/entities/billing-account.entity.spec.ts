/**
 * BillingAccountEntity — Pilot Onboarding Hardening Sprint PD.1.1
 *
 * Pins the contract that:
 *  1. Pre-PD accounts (no opening-balance fields) round-trip unchanged
 *     through the factory (back-compat).
 *  2. The 3 new optional fields can be explicitly set on the entity
 *     shape (consumed by PD.1.4 setOpeningBalance).
 *
 * NB: `createBillingAccountEntity` does NOT yet write opening-balance
 * fields — those are written by `setOpeningBalance` (PD.1.4) after the
 * account exists. The factory's job is the canonical baseline shape.
 */

import {
  createBillingAccountEntity,
  type BillingAccountEntity,
} from './billing-account.entity';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';

describe('createBillingAccountEntity — PD.1.1 back-compat', () => {
  it('factory defaults: opening-balance fields are undefined on a fresh account', () => {
    const entity = createBillingAccountEntity(
      TENANT_ID,
      SCHOOL_ID,
      STUDENT_ID,
      'Aakriti Sharma',
      USER_ID,
    );

    expect(entity.openingBalance).toBeUndefined();
    expect(entity.openingBalanceAsOf).toBeUndefined();
    expect(entity.openingBalanceNote).toBeUndefined();
    // Pre-PD invariants preserved.
    expect(entity.balance).toBe(0);
    expect(entity.totalPaid).toBe(0);
    expect(entity.lastPaymentDate).toBeNull();
    expect(entity.version).toBe(1);
  });

  it('opening-balance fields are part of the entity shape (consumed by setOpeningBalance)', () => {
    // Build an entity-shaped object that simulates the post-setOpeningBalance
    // state. This pins the interface contract; the actual write path lives
    // in PD.1.4.
    const base = createBillingAccountEntity(
      TENANT_ID,
      SCHOOL_ID,
      STUDENT_ID,
      'Aakriti Sharma',
      USER_ID,
    );
    const withOpeningBalance: BillingAccountEntity = {
      ...base,
      openingBalance: 5000,
      openingBalanceAsOf: '2026-04-12',
      openingBalanceNote: 'BS 2082 carry-forward',
      balance: 5000, // balance += openingBalance after setOpeningBalance
    };

    expect(withOpeningBalance.openingBalance).toBe(5000);
    expect(withOpeningBalance.openingBalanceAsOf).toBe('2026-04-12');
    expect(withOpeningBalance.openingBalanceNote).toBe('BS 2082 carry-forward');
    expect(withOpeningBalance.balance).toBe(5000);
  });

  it('canonical PK/SK/GSI keys unchanged by the PD.1.1 entity extension', () => {
    const entity = createBillingAccountEntity(
      TENANT_ID,
      SCHOOL_ID,
      STUDENT_ID,
      'Aakriti Sharma',
      USER_ID,
    );

    expect(entity.tenantId).toBe(TENANT_ID);
    expect(entity.entityKey).toBe(`BILLING_ACCOUNT#${SCHOOL_ID}#${STUDENT_ID}`);
    expect(entity.entityType).toBe('BILLING_ACCOUNT');
    expect(entity.gsi1pk).toBe(`TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}`);
    expect(entity.gsi1sk).toBe('BILLING_ACCOUNT#AAKRITI SHARMA');
    expect(entity.gsi2pk).toBe(`TENANT#${TENANT_ID}#STUDENT#${STUDENT_ID}`);
    expect(entity.gsi2sk).toBe(`BILLING_ACCOUNT#${SCHOOL_ID}`);
  });
});
