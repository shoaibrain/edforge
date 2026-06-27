/**
 * PaymentEntity.applications[] — Pilot Onboarding Hardening Sprint PD.2.1
 *
 * Pins the per-target allocation breakdown shape + the back-compat
 * invariant that pre-PD payments parse + map unchanged.
 */

import { createPaymentEntity, PaymentApplication } from './payment.entity';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const INVOICE_ID = '44444444-4444-4444-8444-444444444444';
const ACCOUNT_ID = '55555555-5555-4555-8555-555555555555';
const USER_ID = '66666666-6666-4666-8666-666666666666';

const BASE_DATA = {
  invoiceId: INVOICE_ID,
  studentAccountId: ACCOUNT_ID,
  studentId: STUDENT_ID,
  amount: 3000,
  currency: 'NPR',
  gateway: 'cash' as const,
};

describe('createPaymentEntity — PD.2.1 applications passthrough', () => {
  it('legacy call (no applications) ⇒ entity has applications undefined (back-compat)', () => {
    const e = createPaymentEntity(TENANT_ID, SCHOOL_ID, BASE_DATA, USER_ID);
    expect(e.applications).toBeUndefined();
    // Legacy top-level invoiceId still populated.
    expect(e.invoiceId).toBe(INVOICE_ID);
    expect(e.amount).toBe(3000);
  });

  it('split call (invoice + opening_balance) ⇒ applications array preserved', () => {
    const apps: PaymentApplication[] = [
      { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 },
      { targetType: 'opening_balance', amount: 1000 },
    ];
    const e = createPaymentEntity(
      TENANT_ID,
      SCHOOL_ID,
      { ...BASE_DATA, applications: apps },
      USER_ID,
    );
    expect(e.applications).toEqual(apps);
    expect(e.applications).toHaveLength(2);
    expect(e.applications![0].targetType).toBe('invoice');
    expect(e.applications![1].targetType).toBe('opening_balance');
    // Top-level invoiceId mirrors the first invoice application's id
    // (caller is responsible — factory just passes through what caller gave)
    expect(e.invoiceId).toBe(INVOICE_ID);
    expect(e.amount).toBe(3000);
  });

  it('discriminated union: invoice entries carry invoiceId; opening entries do NOT', () => {
    const apps: PaymentApplication[] = [
      { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 },
      { targetType: 'opening_balance', amount: 1000 },
    ];
    // Type-narrowing check — opening_balance entries have no invoiceId field.
    const invoiceApp = apps[0];
    const openingApp = apps[1];
    if (invoiceApp.targetType === 'invoice') {
      expect(invoiceApp.invoiceId).toBe(INVOICE_ID);
    }
    if (openingApp.targetType === 'opening_balance') {
      // @ts-expect-error — opening_balance shape has no invoiceId field
      expect(openingApp.invoiceId).toBeUndefined();
    }
  });

  it('opening-balance-only application (V1 supports this only when an invoice exists; opening-only payments not supported in V1)', () => {
    // V1 scope: a single opening_balance entry alongside an invoice is the
    // supported split. Pure opening-only (no invoice context) is deferred —
    // the test pins the entity's ABILITY to hold the shape; the SERVICE
    // (PD.2.3) is the layer that rejects opening-only-with-no-invoice.
    const apps: PaymentApplication[] = [
      { targetType: 'opening_balance', amount: 5000 },
    ];
    const e = createPaymentEntity(
      TENANT_ID,
      SCHOOL_ID,
      { ...BASE_DATA, applications: apps, amount: 5000 },
      USER_ID,
    );
    expect(e.applications).toEqual(apps);
  });
});
