/**
 * billingAccountEntityToDto — Pilot Onboarding Hardening Sprint PD.1.6-rev1
 *
 * Pins back-compat for pre-PD accounts + PD passthrough for the 4
 * opening-balance fields. `openingBalanceRemaining` is computed from
 * the denormalized `openingBalanceSettled` counter on the entity
 * (NOT a caller-supplied enrichment arg — that approach was
 * superseded post-discovery-workflow to avoid ledger-scan brittleness).
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

describe('billingAccountEntityToDto — PD.1.6-rev1', () => {
  it('pre-PD account (no opening-balance fields) ⇒ DTO omits opening-balance fields (back-compat)', () => {
    const dto = billingAccountEntityToDto(makeEntity());
    expect(dto.openingBalance).toBeUndefined();
    expect(dto.openingBalanceAsOf).toBeUndefined();
    expect(dto.openingBalanceNote).toBeUndefined();
    expect(dto.openingBalanceRemaining).toBeUndefined();
  });

  it('PD account with opening-balance set, no settlements yet ⇒ remaining = openingBalance (counter undefined)', () => {
    const dto = billingAccountEntityToDto(
      makeEntity({
        openingBalance: 5000,
        openingBalanceAsOf: '2026-04-12',
        openingBalanceNote: 'BS 2082 carry-forward',
        // openingBalanceSettled: undefined  — initial state after PD.1.4
      }),
    );
    expect(dto.openingBalance).toBe(5000);
    expect(dto.openingBalanceAsOf).toBe('2026-04-12');
    expect(dto.openingBalanceNote).toBe('BS 2082 carry-forward');
    expect(dto.openingBalanceRemaining).toBe(5000);
  });

  it('PD account with partial settlement ⇒ remaining = openingBalance − openingBalanceSettled (PD.2.3 atomic counter)', () => {
    const dto = billingAccountEntityToDto(
      makeEntity({
        openingBalance: 5000,
        openingBalanceSettled: 1500,
      }),
    );
    expect(dto.openingBalanceRemaining).toBe(3500);
  });

  it('PD account with full settlement ⇒ remaining = 0', () => {
    const dto = billingAccountEntityToDto(
      makeEntity({
        openingBalance: 5000,
        openingBalanceSettled: 5000,
      }),
    );
    expect(dto.openingBalanceRemaining).toBe(0);
  });

  it('counter overshoot ⇒ remaining clamps to 0 (defensive against a corrupted counter)', () => {
    const dto = billingAccountEntityToDto(
      makeEntity({
        openingBalance: 5000,
        openingBalanceSettled: 6000,
      }),
    );
    expect(dto.openingBalanceRemaining).toBe(0);
  });

  it('openingBalance present + note absent + counter zero ⇒ note undefined; remaining = openingBalance', () => {
    const dto = billingAccountEntityToDto(
      makeEntity({
        openingBalance: 3000,
        openingBalanceAsOf: '2026-04-12',
        openingBalanceSettled: 0,
      }),
    );
    expect(dto.openingBalanceNote).toBeUndefined();
    expect(dto.openingBalanceRemaining).toBe(3000);
  });
});
