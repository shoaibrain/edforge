/**
 * billingAccountEntityToDto — Pilot Onboarding Hardening Sprint PD.1.6
 *
 * Pins back-compat for pre-PD accounts + PD passthrough for the 4
 * opening-balance fields (3 entity + 1 server-computed remaining).
 */

import { billingAccountEntityToDto } from './billing-account.mapper';
import type { BillingAccountEntity } from '../entities/billing-account.entity';

function makeEntity(overrides: Partial<BillingAccountEntity> = {}): BillingAccountEntity {
  return {
    tenantId: 'tenant-1',
    entityKey: 'BILLING_ACCOUNT#school-1#student-1',
    entityType: 'BILLING_ACCOUNT',
    accountId: 'account-uuid',
    studentId: 'student-uuid',
    schoolId: 'school-uuid',
    studentName: 'Aakriti Sharma',
    balance: 5000,
    totalPaid: 0,
    lastPaymentDate: null,
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    createdAt: '2026-04-12T00:00:00Z',
    createdBy: 'op-1',
    updatedAt: '2026-04-12T00:00:00Z',
    updatedBy: 'op-1',
    version: 1,
    ...overrides,
  };
}

describe('billingAccountEntityToDto — PD.1.6', () => {
  it('pre-PD account (no opening-balance fields) ⇒ DTO omits opening-balance fields (back-compat)', () => {
    const dto = billingAccountEntityToDto(makeEntity());
    expect(dto.openingBalance).toBeUndefined();
    expect(dto.openingBalanceAsOf).toBeUndefined();
    expect(dto.openingBalanceNote).toBeUndefined();
    expect(dto.openingBalanceRemaining).toBeUndefined();
  });

  it('post-PD account, no settlements ⇒ openingBalanceRemaining equals openingBalance', () => {
    const dto = billingAccountEntityToDto(
      makeEntity({
        openingBalance: 5000,
        openingBalanceAsOf: '2026-04-12',
        openingBalanceNote: 'BS 2082 carry-forward',
      }),
    );
    expect(dto.openingBalance).toBe(5000);
    expect(dto.openingBalanceAsOf).toBe('2026-04-12');
    expect(dto.openingBalanceNote).toBe('BS 2082 carry-forward');
    expect(dto.openingBalanceRemaining).toBe(5000);
  });

  it('post-PD account with PD.2 enrichment ⇒ remaining = openingBalance − settledAgainstOpening', () => {
    const dto = billingAccountEntityToDto(
      makeEntity({ openingBalance: 5000 }),
      { settledAgainstOpening: 1500 },
    );
    expect(dto.openingBalanceRemaining).toBe(3500);
  });

  it('PD.2 enrichment overshoot ⇒ remaining clamps to 0 (defensive against bad ledger sums)', () => {
    const dto = billingAccountEntityToDto(
      makeEntity({ openingBalance: 5000 }),
      { settledAgainstOpening: 6000 },
    );
    expect(dto.openingBalanceRemaining).toBe(0);
  });

  it('openingBalance present + note absent ⇒ note undefined; remaining still computed', () => {
    const dto = billingAccountEntityToDto(
      makeEntity({ openingBalance: 3000, openingBalanceAsOf: '2026-04-12' }),
    );
    expect(dto.openingBalanceNote).toBeUndefined();
    expect(dto.openingBalanceRemaining).toBe(3000);
  });
});
