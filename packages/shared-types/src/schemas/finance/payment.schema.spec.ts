/**
 * paymentResponseSchema — gradeLevel + gradeLevelResolutionStatus
 *
 * Sprint A.2 Codex round-2: closes the contract-completeness gap.
 * Pre-fix the Payment DTO had NO grade-snapshot fields at all,
 * despite A.2 plan-acceptance saying "Mapper passes through."
 */

import {
  paymentResponseSchema,
  recordManualPaymentSchema,
  Payment,
} from './payment.schema';

const VALID_BASE: Record<string, unknown> = {
  id: '11111111-1111-4111-8111-111111111111',
  invoiceId: '22222222-2222-4222-8222-222222222222',
  studentAccountId: '33333333-3333-4333-8333-333333333333',
  schoolId: '44444444-4444-4444-8444-444444444444',
  amount: 1000,
  currency: 'NPR',
  gateway: 'cash',
  status: 'completed',
  paidAt: '2026-07-15T10:00:00Z',
  paidBy: 'operator-1',
  receiptNumber: 'RCP-2026-0001',
  metadata: {},
  refunds: [],
  createdAt: '2026-07-15T10:00:00Z',
  updatedAt: '2026-07-15T10:00:00Z',
};

describe('paymentResponseSchema — Sprint A.2 grade snapshot fields', () => {
  it('accepts gradeLevel + gradeLevelResolutionStatus when both are set (post-A.2 resolved row)', () => {
    const parsed: Payment = paymentResponseSchema.parse({
      ...VALID_BASE,
      gradeLevel: '4',
      gradeLevelResolutionStatus: 'resolved',
    });
    expect(parsed.gradeLevel).toBe('4');
    expect(parsed.gradeLevelResolutionStatus).toBe('resolved');
  });

  it('accepts gradeLevelResolutionStatus=unresolved with gradeLevel undefined (parent invoice was unresolved)', () => {
    const parsed = paymentResponseSchema.parse({
      ...VALID_BASE,
      gradeLevelResolutionStatus: 'unresolved',
    });
    expect(parsed.gradeLevel).toBeUndefined();
    expect(parsed.gradeLevelResolutionStatus).toBe('unresolved');
  });

  it('accepts both fields absent (back-compat with pre-A.2 rows before backfill)', () => {
    const parsed = paymentResponseSchema.parse(VALID_BASE);
    expect(parsed.gradeLevel).toBeUndefined();
    expect(parsed.gradeLevelResolutionStatus).toBeUndefined();
  });

  it('rejects an unknown gradeLevelResolutionStatus value (closed enum)', () => {
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        gradeLevelResolutionStatus: 'maybe',
      }),
    ).toThrow();
  });
});

describe('paymentResponseSchema — PD.2.1 applications discriminated union', () => {
  it('parses a split-allocation payment (invoice + opening_balance)', () => {
    const parsed = paymentResponseSchema.parse({
      ...VALID_BASE,
      amount: 3000,
      applications: [
        { targetType: 'invoice', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 2000 },
        { targetType: 'opening_balance', amount: 1000 },
      ],
    });
    expect(parsed.applications).toHaveLength(2);
    expect(parsed.applications![0].targetType).toBe('invoice');
    expect(parsed.applications![1].targetType).toBe('opening_balance');
  });

  it('parses pre-PD payment with applications absent (back-compat)', () => {
    const parsed = paymentResponseSchema.parse(VALID_BASE);
    expect(parsed.applications).toBeUndefined();
  });

  it('rejects invoice application without invoiceId (discriminated-union type-narrowing)', () => {
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        amount: 2000,
        applications: [
          { targetType: 'invoice', amount: 2000 }, // missing invoiceId
        ],
      }),
    ).toThrow();
  });

  it('rejects opening_balance application carrying an invoiceId (mutex on targetType)', () => {
    // FB-4.1 note: an opening-balance-ONLY payment must not carry a
    // top-level invoiceId (representation consistency), so this fixture
    // omits it — the point under test is the union-variant behavior below.
    const { invoiceId: _invoiceId, ...openingOnlyBase } = VALID_BASE;
    expect(() =>
      paymentResponseSchema.parse({
        ...openingOnlyBase,
        amount: 1000,
        applications: [
          { targetType: 'opening_balance', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 1000 },
        ],
      }),
    ).not.toThrow(); // discriminated union ignores extra fields on the matched variant; this is OK
    // The variant-shape lookup picks the opening_balance branch and drops invoiceId.
    const parsed = paymentResponseSchema.parse({
      ...openingOnlyBase,
      amount: 1000,
      applications: [
        { targetType: 'opening_balance', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 1000 },
      ],
    });
    // @ts-expect-error — opening_balance variant has no invoiceId field
    expect(parsed.applications![0].invoiceId).toBeUndefined();
  });

  it('rejects amount of 0 or negative on either variant', () => {
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        applications: [
          { targetType: 'invoice', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 0 },
        ],
      }),
    ).toThrow();
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        applications: [
          { targetType: 'opening_balance', amount: -100 },
        ],
      }),
    ).toThrow();
  });

  it('rejects unknown targetType (closed discriminator)', () => {
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        applications: [{ targetType: 'refund', amount: 500 } as any],
      }),
    ).toThrow();
  });

  // Phase C SPEC-14 fix — schema-level sum invariant.
  describe('SPEC-14 — applications sum invariant', () => {
    it('rejects when Σ(applications.amount) does not equal payment.amount (data corruption guard)', () => {
      expect(() =>
        paymentResponseSchema.parse({
          ...VALID_BASE,
          amount: 3000,
          applications: [
            { targetType: 'invoice', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 2000 },
            { targetType: 'opening_balance', amount: 500 }, // Σ=2500, payment=3000 → mismatch
          ],
        }),
      ).toThrow(/Sum of applications\[\]\.amount.*must equal payment\.amount/);
    });

    it('accepts when Σ matches payment.amount (the happy path)', () => {
      const parsed = paymentResponseSchema.parse({
        ...VALID_BASE,
        amount: 3000,
        applications: [
          { targetType: 'invoice', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 2000 },
          { targetType: 'opening_balance', amount: 1000 },
        ],
      });
      expect(parsed.applications).toHaveLength(2);
    });

    it('accepts up to 1-cent tolerance for float-precision drift on integer NPR amounts', () => {
      // Simulate a tiny rounding artifact (sub-cent). The 1-cent
      // tolerance lets this through; >1-cent would fail.
      const parsed = paymentResponseSchema.parse({
        ...VALID_BASE,
        amount: 3000.001,
        applications: [
          { targetType: 'invoice', invoiceId: '22222222-2222-4222-8222-222222222222', amount: 2000 },
          { targetType: 'opening_balance', amount: 1000 },
        ],
      });
      expect(parsed).toBeDefined();
    });

    it('skips the invariant check when applications is absent (back-compat for pre-PD payments)', () => {
      const parsed = paymentResponseSchema.parse({
        ...VALID_BASE,
        amount: 1000,
        // applications omitted
      });
      expect(parsed.applications).toBeUndefined();
    });
  });

  // Phase D P2.2 introduced these invariants with a single-invoice cap;
  // EPIC-FB FB-4.2 widened them to multi-invoice family payments.
  describe('FB-4.2 — application shape invariants (widened from P2.2)', () => {
    const PAYMENT_INVOICE_ID = VALID_BASE.invoiceId as string;
    const OTHER_INVOICE_ID = '88888888-8888-4888-8888-888888888888';
    const THIRD_INVOICE_ID = '99999999-9999-4999-8999-999999999999';

    it('accepts MULTIPLE invoice applications when top-level invoiceId/studentAccountId are null (FB-4.2)', () => {
      const parsed = paymentResponseSchema.parse({
        ...VALID_BASE,
        invoiceId: null,
        studentAccountId: null,
        amount: 4000,
        applications: [
          { targetType: 'invoice', invoiceId: PAYMENT_INVOICE_ID, amount: 2000 },
          { targetType: 'invoice', invoiceId: OTHER_INVOICE_ID, amount: 2000 },
        ],
      });
      expect(parsed.applications).toHaveLength(2);
    });

    it("rejects duplicate invoiceIds across 'invoice' applications", () => {
      expect(() =>
        paymentResponseSchema.parse({
          ...VALID_BASE,
          invoiceId: null,
          studentAccountId: null,
          amount: 4000,
          applications: [
            { targetType: 'invoice', invoiceId: OTHER_INVOICE_ID, amount: 2000 },
            { targetType: 'invoice', invoiceId: OTHER_INVOICE_ID, amount: 2000 },
          ],
        }),
      ).toThrow(/must reference distinct invoiceIds/);
    });

    it("rejects more than ONE 'opening_balance' application", () => {
      expect(() =>
        paymentResponseSchema.parse({
          ...VALID_BASE,
          invoiceId: null,
          amount: 2000,
          applications: [
            { targetType: 'opening_balance', amount: 1000 },
            { targetType: 'opening_balance', amount: 1000 },
          ],
        }),
      ).toThrow(/At most one 'opening_balance' application/);
    });

    it('rejects when an invoice entry appears AFTER the opening_balance entry (generalized ledger ordering)', () => {
      expect(() =>
        paymentResponseSchema.parse({
          ...VALID_BASE,
          amount: 3000,
          applications: [
            { targetType: 'opening_balance', amount: 1000 },
            { targetType: 'invoice', invoiceId: PAYMENT_INVOICE_ID, amount: 2000 },
          ],
        }),
      ).toThrow(/must appear BEFORE the 'opening_balance'/);
    });

    it('rejects a 3-invoice split where one entry trails the opening_balance entry', () => {
      expect(() =>
        paymentResponseSchema.parse({
          ...VALID_BASE,
          invoiceId: null,
          studentAccountId: null,
          amount: 6000,
          applications: [
            { targetType: 'invoice', invoiceId: PAYMENT_INVOICE_ID, amount: 2000 },
            { targetType: 'invoice', invoiceId: OTHER_INVOICE_ID, amount: 2000 },
            { targetType: 'opening_balance', amount: 1000 },
            { targetType: 'invoice', invoiceId: THIRD_INVOICE_ID, amount: 1000 },
          ],
        }),
      ).toThrow(/must appear BEFORE the 'opening_balance'/);
    });

    it('rejects when the sole invoice application disagrees with top-level payment.invoiceId', () => {
      expect(() =>
        paymentResponseSchema.parse({
          ...VALID_BASE,
          amount: 3000,
          applications: [
            { targetType: 'invoice', invoiceId: OTHER_INVOICE_ID, amount: 2000 }, // mismatched
            { targetType: 'opening_balance', amount: 1000 },
          ],
        }),
      ).toThrow(/must equal the sole 'invoice' application/);
    });

    it('accepts the canonical single-target split shape (1 invoice FIRST + 1 opening + matching invoiceId + sum correct)', () => {
      const parsed = paymentResponseSchema.parse({
        ...VALID_BASE,
        amount: 3000,
        applications: [
          { targetType: 'invoice', invoiceId: PAYMENT_INVOICE_ID, amount: 2000 },
          { targetType: 'opening_balance', amount: 1000 },
        ],
      });
      expect(parsed.applications).toHaveLength(2);
    });

    it('caps invoice applications at 20 (21 rejects, 20 parses)', () => {
      const target = (i: number): { targetType: 'invoice'; invoiceId: string; amount: number } => ({
        targetType: 'invoice',
        invoiceId: `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
        amount: 100,
      });
      expect(() =>
        paymentResponseSchema.parse({
          ...VALID_BASE,
          invoiceId: null,
          studentAccountId: null,
          amount: 2100,
          applications: Array.from({ length: 21 }, (_, i) => target(i)),
        }),
      ).toThrow(/At most 20 'invoice' applications/);
      const parsed = paymentResponseSchema.parse({
        ...VALID_BASE,
        invoiceId: null,
        studentAccountId: null,
        amount: 2000,
        applications: Array.from({ length: 20 }, (_, i) => target(i)),
      });
      expect(parsed.applications).toHaveLength(20);
    });

    it('reports MULTIPLE violations on a maximally-corrupted payload (sum + cardinality + ordering + representation fire together)', () => {
      // Pathological row: 2 invoice + 2 opening, invoice entries trailing
      // an opening entry, sum mismatch, AND single-target scalars still
      // populated. Each invariant adds its own issue; zod aggregates them
      // so the implementer sees EVERY problem in one error.
      let thrown: any;
      try {
        paymentResponseSchema.parse({
          ...VALID_BASE,
          amount: 100, // doesn't match 5000
          applications: [
            { targetType: 'opening_balance', amount: 1000 },
            { targetType: 'invoice', invoiceId: OTHER_INVOICE_ID, amount: 2000 },
            { targetType: 'invoice', invoiceId: PAYMENT_INVOICE_ID, amount: 1000 },
            { targetType: 'opening_balance', amount: 1000 },
          ],
        });
      } catch (err) {
        thrown = err;
      }
      expect(thrown).toBeDefined();
      const messages = thrown.errors.map((e: any) => e.message).join(' | ');
      expect(messages).toMatch(/Sum of applications/);
      expect(messages).toMatch(/At most one 'opening_balance'/);
      expect(messages).toMatch(/must appear BEFORE the 'opening_balance'/);
      expect(messages).toMatch(/top-level invoiceId must be null\/undefined/);
    });
  });
});

describe('paymentResponseSchema — FB-4.1 representation consistency + live back-compat fixture', () => {
  const INVOICE_1 = '11111111-aaaa-4aaa-8aaa-111111111111';
  const INVOICE_2 = '22222222-bbbb-4bbb-8bbb-222222222222';
  const INVOICE_3 = '33333333-cccc-4ccc-8ccc-333333333333';
  const FAMILY_ID = '55555555-dddd-4ddd-8ddd-555555555555';

  /**
   * Back-compat contract: a REAL pre-FB-4 single-target payment captured
   * live from the dev tenant (2026-07-04, GET …/payments) must parse
   * byte-identically after the FB-4 widening. Do not "clean up" this
   * fixture — its exact shape is the regression.
   */
  const LIVE_PRE_FB_PAYMENT = {
    id: '003cd3ad-96cc-42d4-ae0e-e2c97886e75c',
    invoiceId: 'ec77449c-4feb-41ab-8154-a81ccb4b5a87',
    studentAccountId: 'fede26ae-0915-464c-a3a8-578366aa14c8',
    schoolId: '4209e3d8-d2e2-4e0e-9961-790341c264f4',
    amount: 10000,
    currency: 'NPR',
    gateway: 'bank_transfer',
    gatewayTransactionId: '2523634632424',
    status: 'completed',
    paidAt: '2026-07-03',
    paidBy: 'b1736dfa-80d1-70fb-dd92-ca30cbf9a0ca',
    receiptNumber: 'RCP-420-2607-0001',
    metadata: {},
    refunds: [],
    studentName: 'Aman Kumar Gupta',
    invoiceNumber: 'INV-420-2605-0015',
    gradeLevel: '9',
    gradeLevelResolutionStatus: 'resolved',
    applications: [
      {
        targetType: 'invoice',
        invoiceId: 'ec77449c-4feb-41ab-8154-a81ccb4b5a87',
        amount: 10000,
      },
    ],
    createdAt: '2026-07-04T04:08:10.781Z',
    updatedAt: '2026-07-04T04:08:10.781Z',
  };

  it('back-compat: the live pre-change single-target payment parses UNCHANGED', () => {
    const parsed = paymentResponseSchema.parse(LIVE_PRE_FB_PAYMENT);
    expect(parsed).toEqual(LIVE_PRE_FB_PAYMENT);
    expect(parsed.familyId).toBeUndefined();
  });

  it('accepts a 3-sibling family payment: null scalars, 3 distinct invoices + opening last, familyId stamped', () => {
    const parsed = paymentResponseSchema.parse({
      ...VALID_BASE,
      invoiceId: null,
      studentAccountId: null,
      familyId: FAMILY_ID,
      amount: 25000,
      applications: [
        { targetType: 'invoice', invoiceId: INVOICE_1, amount: 10000 },
        { targetType: 'invoice', invoiceId: INVOICE_2, amount: 10000 },
        { targetType: 'invoice', invoiceId: INVOICE_3, amount: 4000 },
        { targetType: 'opening_balance', amount: 1000 },
      ],
    });
    expect(parsed.invoiceId).toBeNull();
    expect(parsed.studentAccountId).toBeNull();
    expect(parsed.familyId).toBe(FAMILY_ID);
    expect(parsed.applications).toHaveLength(4);
  });

  it('accepts multi-target with the scalars ABSENT rather than null (undefined and null both mean "no single target")', () => {
    const { invoiceId: _i, studentAccountId: _s, ...noScalars } = VALID_BASE;
    const parsed = paymentResponseSchema.parse({
      ...noScalars,
      amount: 4000,
      applications: [
        { targetType: 'invoice', invoiceId: INVOICE_1, amount: 2000 },
        { targetType: 'invoice', invoiceId: INVOICE_2, amount: 2000 },
      ],
    });
    expect(parsed.invoiceId).toBeUndefined();
    expect(parsed.studentAccountId).toBeUndefined();
  });

  it('rejects a multi-target payment that still carries top-level invoiceId (representation lie)', () => {
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        studentAccountId: null,
        amount: 4000,
        applications: [
          { targetType: 'invoice', invoiceId: INVOICE_1, amount: 2000 },
          { targetType: 'invoice', invoiceId: INVOICE_2, amount: 2000 },
        ],
      }),
    ).toThrow(/top-level invoiceId must be null\/undefined/);
  });

  it('rejects a multi-target payment that still carries top-level studentAccountId', () => {
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        invoiceId: null,
        amount: 4000,
        applications: [
          { targetType: 'invoice', invoiceId: INVOICE_1, amount: 2000 },
          { targetType: 'invoice', invoiceId: INVOICE_2, amount: 2000 },
        ],
      }),
    ).toThrow(/top-level studentAccountId must be null\/undefined/);
  });

  it('rejects a single-invoice-application payment whose top-level invoiceId is null (must mirror the sole target)', () => {
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        invoiceId: null,
        applications: [
          { targetType: 'invoice', invoiceId: INVOICE_1, amount: 1000 },
        ],
      }),
    ).toThrow(/must equal the sole 'invoice' application/);
  });

  it('rejects a single-invoice-application payment without studentAccountId', () => {
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        studentAccountId: null,
        applications: [
          {
            targetType: 'invoice',
            invoiceId: VALID_BASE.invoiceId as string,
            amount: 1000,
          },
        ],
      }),
    ).toThrow(/studentAccountId must be present/);
  });

  it('opening-balance-only: valid with invoiceId absent + studentAccountId present; invalid otherwise', () => {
    const { invoiceId: _i, ...noInvoiceId } = VALID_BASE;
    const parsed = paymentResponseSchema.parse({
      ...noInvoiceId,
      amount: 1000,
      applications: [{ targetType: 'opening_balance', amount: 1000 }],
    });
    expect(parsed.applications![0].targetType).toBe('opening_balance');

    // Top-level invoiceId on an opening-only payment is a representation lie.
    expect(() =>
      paymentResponseSchema.parse({
        ...VALID_BASE,
        amount: 1000,
        applications: [{ targetType: 'opening_balance', amount: 1000 }],
      }),
    ).toThrow(/Opening-balance-only payment: top-level invoiceId/);

    // …and the account it settles must be identified.
    expect(() =>
      paymentResponseSchema.parse({
        ...noInvoiceId,
        studentAccountId: null,
        amount: 1000,
        applications: [{ targetType: 'opening_balance', amount: 1000 }],
      }),
    ).toThrow(/studentAccountId must be present/);
  });

  it('legacy row with NO applications skips representation checks entirely (pre-PD back-compat)', () => {
    // Scalars present (the live norm) — parses.
    expect(paymentResponseSchema.safeParse(VALID_BASE).success).toBe(true);
    // Scalars null with no applications — also schema-permissible now
    // (the representation contract is defined by applications[]).
    expect(
      paymentResponseSchema.safeParse({
        ...VALID_BASE,
        invoiceId: null,
        studentAccountId: null,
      }).success,
    ).toBe(true);
  });

  it('rejects malformed familyId', () => {
    expect(
      paymentResponseSchema.safeParse({ ...VALID_BASE, familyId: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});

describe('recordManualPaymentSchema — FB-4.1 single-target back-compat + multi-target input', () => {
  const INVOICE_1 = '11111111-aaaa-4aaa-8aaa-111111111111';
  const INVOICE_2 = '22222222-bbbb-4bbb-8bbb-222222222222';
  const FAMILY_ID = '55555555-dddd-4ddd-8ddd-555555555555';

  const LEGACY_SINGLE_TARGET = {
    invoiceId: INVOICE_1,
    gateway: 'cash' as const,
    amount: 5000,
    currency: 'NPR' as const,
    referenceNumber: 'CHQ-123',
    notes: 'term 1 fees',
    paidDate: '2026-07-04',
    idempotencyKey: '44444444-4444-4444-8444-444444444444',
  };

  it('back-compat: the pre-FB single-invoice request shape parses unchanged', () => {
    const parsed = recordManualPaymentSchema.parse(LEGACY_SINGLE_TARGET);
    expect(parsed.invoiceId).toBe(INVOICE_1);
    expect(parsed.applications).toBeUndefined();
  });

  it('accepts a multi-target request (applications, no invoiceId) with optional familyId', () => {
    const parsed = recordManualPaymentSchema.parse({
      gateway: 'bank_transfer',
      amount: 25000,
      familyId: FAMILY_ID,
      applications: [
        { invoiceId: INVOICE_1, amount: 15000 },
        { invoiceId: INVOICE_2, amount: 10000 },
      ],
    });
    expect(parsed.applications).toHaveLength(2);
    expect(parsed.familyId).toBe(FAMILY_ID);
  });

  it('rejects BOTH invoiceId and applications (ambiguous target)', () => {
    expect(() =>
      recordManualPaymentSchema.parse({
        ...LEGACY_SINGLE_TARGET,
        applications: [{ invoiceId: INVOICE_2, amount: 5000 }],
      }),
    ).toThrow(/exactly one of 'invoiceId'.*got both/);
  });

  it('rejects NEITHER invoiceId nor applications', () => {
    const { invoiceId: _i, ...noTarget } = LEGACY_SINGLE_TARGET;
    expect(() => recordManualPaymentSchema.parse(noTarget)).toThrow(
      /exactly one of 'invoiceId'.*got neither/,
    );
  });

  it('rejects duplicate invoice targets in applications', () => {
    expect(() =>
      recordManualPaymentSchema.parse({
        gateway: 'cash',
        amount: 4000,
        applications: [
          { invoiceId: INVOICE_1, amount: 2000 },
          { invoiceId: INVOICE_1, amount: 2000 },
        ],
      }),
    ).toThrow(/distinct invoiceIds/);
  });

  it('rejects over-allocation (Σ applications > amount) but allows under-allocation (remainder is service policy)', () => {
    expect(() =>
      recordManualPaymentSchema.parse({
        gateway: 'cash',
        amount: 3000,
        applications: [
          { invoiceId: INVOICE_1, amount: 2000 },
          { invoiceId: INVOICE_2, amount: 2000 },
        ],
      }),
    ).toThrow(/cannot exceed the payment amount/);

    const parsed = recordManualPaymentSchema.parse({
      gateway: 'cash',
      amount: 5000,
      applications: [
        { invoiceId: INVOICE_1, amount: 2000 },
        { invoiceId: INVOICE_2, amount: 2000 },
      ],
    });
    expect(parsed.amount).toBe(5000);
  });

  it('caps applications at 20 entries and requires at least 1', () => {
    const many = Array.from({ length: 21 }, (_, i) => ({
      invoiceId: `${i.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`,
      amount: 10,
    }));
    expect(
      recordManualPaymentSchema.safeParse({ gateway: 'cash', amount: 210, applications: many })
        .success,
    ).toBe(false);
    expect(
      recordManualPaymentSchema.safeParse({ gateway: 'cash', amount: 210, applications: [] })
        .success,
    ).toBe(false);
  });

  it('rejects non-positive application amounts and malformed invoice uuids', () => {
    expect(
      recordManualPaymentSchema.safeParse({
        gateway: 'cash',
        amount: 100,
        applications: [{ invoiceId: INVOICE_1, amount: 0 }],
      }).success,
    ).toBe(false);
    expect(
      recordManualPaymentSchema.safeParse({
        gateway: 'cash',
        amount: 100,
        applications: [{ invoiceId: 'nope', amount: 100 }],
      }).success,
    ).toBe(false);
  });
});
