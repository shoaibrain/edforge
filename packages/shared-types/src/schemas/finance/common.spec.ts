/**
 * Pilot Onboarding Hardening — Sprint PD.0.1
 *
 * Pins the contract that `'opening_balance'` is a valid `LedgerEntryType`.
 * Unknown values still reject (closed enum).
 */

import { ledgerEntryTypeEnum } from './common';

describe('ledgerEntryTypeEnum — Sprint PD.0.1 opening_balance addition', () => {
  it('accepts the new opening_balance value', () => {
    expect(ledgerEntryTypeEnum.parse('opening_balance')).toBe('opening_balance');
  });

  it('continues to accept the pre-PD values (back-compat)', () => {
    expect(ledgerEntryTypeEnum.parse('invoice')).toBe('invoice');
    expect(ledgerEntryTypeEnum.parse('payment')).toBe('payment');
    expect(ledgerEntryTypeEnum.parse('refund')).toBe('refund');
    expect(ledgerEntryTypeEnum.parse('adjustment')).toBe('adjustment');
    expect(ledgerEntryTypeEnum.parse('write_off')).toBe('write_off');
  });

  it('rejects unknown values (closed enum invariant)', () => {
    expect(() => ledgerEntryTypeEnum.parse('foo')).toThrow();
    expect(() => ledgerEntryTypeEnum.parse('opening_credit')).toThrow();
    expect(() => ledgerEntryTypeEnum.parse('')).toThrow();
  });
});
