/**
 * Pilot Onboarding Hardening — Sprint PD.0.4
 *
 * Pins the contract shape for `setOpeningBalanceSchema` (PUT request
 * DTO) and the back-compat invariant on `billingAccountResponseSchema`
 * (4 new optional opening-balance fields parse but are not required).
 */

import {
  billingAccountResponseSchema,
  setOpeningBalanceSchema,
} from './student-account.schema';

const VALID_RESPONSE_BASE: Record<string, unknown> = {
  id: '11111111-1111-4111-8111-111111111111',
  studentId: '22222222-2222-4222-8222-222222222222',
  schoolId: '33333333-3333-4333-8333-333333333333',
  studentName: 'Aakriti Sharma',
  balance: 5000,
  totalPaid: 0,
  lastPaymentDate: null,
  createdAt: '2026-04-12T00:00:00Z',
  updatedAt: '2026-04-12T00:00:00Z',
};

describe('setOpeningBalanceSchema — PD.0.4', () => {
  it('accepts a valid request (non-negative amount + past asOf + optional note)', () => {
    const parsed = setOpeningBalanceSchema.parse({
      amount: 5000,
      asOf: '2026-04-12',
      note: 'Carry-forward from BS 2082 outstanding tuition',
    });
    expect(parsed.amount).toBe(5000);
    expect(parsed.asOf).toBe('2026-04-12');
    expect(parsed.note).toBe('Carry-forward from BS 2082 outstanding tuition');
  });

  it('accepts amount=0 (operator may intentionally set to zero on revision)', () => {
    const parsed = setOpeningBalanceSchema.parse({
      amount: 0,
      asOf: '2026-04-12',
    });
    expect(parsed.amount).toBe(0);
  });

  it('rejects negative amount (V1 — credit notes are the advance-payment path)', () => {
    expect(() =>
      setOpeningBalanceSchema.parse({
        amount: -100,
        asOf: '2026-04-12',
      }),
    ).toThrow();
  });

  it('rejects future asOf date (carry-forward cannot project into the future)', () => {
    // Build a date 30 days ahead — works regardless of when this spec runs.
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    expect(() =>
      setOpeningBalanceSchema.parse({
        amount: 5000,
        asOf: future,
      }),
    ).toThrow(/asOf must be on or before today/);
  });

  it('rejects malformed asOf date string', () => {
    expect(() =>
      setOpeningBalanceSchema.parse({
        amount: 5000,
        asOf: '2026/04/12', // wrong separator
      }),
    ).toThrow();
    expect(() =>
      setOpeningBalanceSchema.parse({
        amount: 5000,
        asOf: 'yesterday',
      }),
    ).toThrow();
  });

  it('rejects note > 500 chars', () => {
    expect(() =>
      setOpeningBalanceSchema.parse({
        amount: 5000,
        asOf: '2026-04-12',
        note: 'x'.repeat(501),
      }),
    ).toThrow();
  });
});

describe('billingAccountResponseSchema — PD.0.4 back-compat', () => {
  it('parses a pre-PD account row (no opening-balance fields present)', () => {
    const parsed = billingAccountResponseSchema.parse(VALID_RESPONSE_BASE);
    expect(parsed.openingBalance).toBeUndefined();
    expect(parsed.openingBalanceAsOf).toBeUndefined();
    expect(parsed.openingBalanceNote).toBeUndefined();
    expect(parsed.openingBalanceRemaining).toBeUndefined();
  });

  it('parses a post-PD account row (all 4 opening-balance fields present)', () => {
    const parsed = billingAccountResponseSchema.parse({
      ...VALID_RESPONSE_BASE,
      openingBalance: 5000,
      openingBalanceAsOf: '2026-04-12',
      openingBalanceNote: 'BS 2082 carry-forward',
      openingBalanceRemaining: 3000,
    });
    expect(parsed.openingBalance).toBe(5000);
    expect(parsed.openingBalanceAsOf).toBe('2026-04-12');
    expect(parsed.openingBalanceNote).toBe('BS 2082 carry-forward');
    expect(parsed.openingBalanceRemaining).toBe(3000);
  });

  it('rejects negative openingBalance (entity invariant: stored value is non-negative)', () => {
    expect(() =>
      billingAccountResponseSchema.parse({
        ...VALID_RESPONSE_BASE,
        openingBalance: -100,
      }),
    ).toThrow();
  });
});
