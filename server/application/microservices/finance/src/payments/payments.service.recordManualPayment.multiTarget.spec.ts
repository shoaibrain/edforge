/**
 * PaymentsService.recordManualPayment — MULTI-TARGET write path
 * EPIC-FB Sprint FB-4.4.
 *
 * Pins:
 *   1. Transact composition + item ordering: [payment Put,
 *      invoice_apply × N (canonical plan order), then per-account groups
 *      of (ledger Puts + account Update)].
 *   2. Payment entity identity: invoiceId/studentAccountId/studentId all
 *      null, familyId stamped, GSI2 keys ABSENT, GSI14 keys ABSENT,
 *      applications[] canonical, applicationInvoiceIds denormalized.
 *   3. Business re-validation: paid/cancelled target → 400; mixed
 *      currencies → 400; declared-currency mismatch → 400; stale
 *      amountDue → 409 PAYMENT_APPLICATION_EXCEEDS_DUE; missing account
 *      → 404; chronology violation → 409 naming the account.
 *   4. Idempotency-key short-circuit covers the multi shape.
 *   5. TransactionCanceledException → 409 with per-op labels.
 *   6. Event published with invoiceId=null.
 *   7. Response DTO satisfies the FB-4.1 representation matrix
 *      (validated against the real shared-types response schema).
 */

import { Logger, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type { BillingAccountEntity } from '../common/entities/billing-account.entity';
import type { PaymentEntity } from '../common/entities/payment.entity';
import { paymentResponseSchema } from '@aibrains/shared-types';

const TENANT_ID = 'tenant-uuid';
// Real UUID — the representation-matrix test parses the DTO with the real
// shared-types response schema, which validates schoolId's uuid shape.
const SCHOOL_ID = '44444444-4444-4444-8444-444444444444';
const STUDENT_1 = 'student-1-uuid';
const STUDENT_2 = 'student-2-uuid';
const INVOICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVOICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const INVOICE_C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FAMILY_ID = '55555555-dddd-4ddd-8ddd-555555555555';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

function makeInvoice(
  invoiceId: string,
  studentId: string,
  overrides: Partial<InvoiceEntity> = {},
): InvoiceEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `INVOICE#${SCHOOL_ID}#${invoiceId}`,
    entityType: 'INVOICE',
    invoiceId,
    invoiceNumber: `INV-${invoiceId.slice(0, 4).toUpperCase()}`,
    studentAccountId: `acct-${studentId}`,
    studentId,
    studentName: `Student ${studentId.slice(8, 9)}`,
    schoolId: SCHOOL_ID,
    schoolName: 'Test School',
    academicYear: '2025-2026',
    lineItems: [],
    subtotal: 1000,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 1000,
    amountPaid: 0,
    amountDue: 1000,
    currency: 'NPR',
    dueDate: '2026-08-15',
    issuedDate: '2026-07-15',
    status: 'issued',
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '', gsi3pk: '', gsi3sk: '',
    createdAt: '2026-07-15T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-07-15T00:00:00Z',
    updatedBy: 'admin',
    version: 1,
    ...overrides,
  } as InvoiceEntity;
}

function makeAccount(studentId: string, overrides: Partial<BillingAccountEntity> = {}): BillingAccountEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `BILLING_ACCOUNT#${SCHOOL_ID}#${studentId}`,
    entityType: 'BILLING_ACCOUNT',
    accountId: `acct-${studentId}`,
    schoolId: SCHOOL_ID,
    studentId,
    studentName: `Student ${studentId.slice(8, 9)}`,
    balance: 0,
    totalPaid: 0,
    lastPaymentDate: null,
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '',
    createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1,
    ...overrides,
  } as BillingAccountEntity;
}

interface Mocks {
  dynamoDBClient: any;
  invoicesService: any;
  studentAccountsService: any;
  eventsService: any;
}

function buildService(fixtures: {
  invoices: InvoiceEntity[];
  accounts: BillingAccountEntity[];
}): { service: PaymentsService; mocks: Mocks } {
  const invoiceById = new Map(fixtures.invoices.map(i => [i.invoiceId, i]));
  const accountByKey = new Map(fixtures.accounts.map(a => [a.entityKey, a]));

  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn().mockImplementation(async (_c: any, _t: string, entityKey: string) =>
      accountByKey.get(entityKey) ?? null,
    ),
    transactWrite: jest.fn().mockResolvedValue(undefined),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
  const invoicesService: any = {
    getEntity: jest.fn().mockImplementation(async (_s: string, invoiceId: string) => {
      const found = invoiceById.get(invoiceId);
      if (!found) throw new NotFoundException(`Invoice ${invoiceId} not found`);
      return found;
    }),
    buildApplyPaymentTransactItem: jest.fn().mockImplementation((invoice: any, amount: number) => ({
      item: {
        Update: {
          TableName: 'edforge-finance-test',
          Key: { tenantId: invoice.tenantId, entityKey: invoice.entityKey },
          _tag: 'invoice_apply',
          _invoiceId: invoice.invoiceId,
          _amount: amount,
        },
      },
      newStatus: amount >= invoice.amountDue ? 'paid' : 'partially_paid',
      newAmountPaid: invoice.amountPaid + amount,
      newAmountDue: Math.max(0, invoice.grandTotal - invoice.amountPaid - amount),
    })),
  };
  const studentAccountsService: any = {
    buildCompositeLedgerTransactItems: jest.fn().mockImplementation((acct: any, inputs: any[]) => ({
      items: [
        ...inputs.map((i: any, idx: number) => ({
          Put: {
            TableName: 'edforge-finance-test',
            Item: {
              entityType: 'LEDGER_ENTRY',
              _account: acct.accountId,
              _idx: idx,
              _credit: i.credit,
              _debit: i.debit,
              _description: i.description,
            },
          },
        })),
        {
          Update: {
            TableName: 'edforge-finance-test',
            Key: { tenantId: acct.tenantId, entityKey: acct.entityKey },
            _tag: 'account_update',
            _account: acct.accountId,
            UpdateExpression: 'SET balance = :b',
            ExpressionAttributeValues: { ':b': 0, ':currentVersion': acct.version },
            ExpressionAttributeNames: { '#v': 'version' },
            ConditionExpression: '#v = :currentVersion',
          },
        },
      ],
      ledgerEntries: inputs.map((_: any, idx: number) => ({ entryId: `ledger-${acct.accountId}-${idx}` })),
      summedDelta: 0,
    })),
  };
  const eventsService: any = { publishPaymentCompleted: jest.fn().mockResolvedValue(undefined) };
  const service = new PaymentsService(
    dynamoDBClient,
    eventsService,
    { nextReceiptNumber: jest.fn().mockResolvedValue('RCP-2026-0777') } as any,
    invoicesService,
    studentAccountsService,
    {} as any,
    {} as any,
    { getStudentInfo: jest.fn() } as any,
    { optimize: jest.fn(async (u: any) => u) } as any,
  );
  return { service, mocks: { dynamoDBClient, invoicesService, studentAccountsService, eventsService } };
}

/**
 * Standard 3-invoice/2-student fixture: A + B belong to student 1
 * (due 07-01 and 08-01), C belongs to student 2 (due 07-15). Canonical
 * plan order is therefore A (07-01), C (07-15), B (08-01).
 */
function threeInvoiceFixture() {
  return {
    invoices: [
      makeInvoice(INVOICE_A, STUDENT_1, { dueDate: '2026-07-01', amountDue: 1000, grandTotal: 1000 }),
      makeInvoice(INVOICE_B, STUDENT_1, { dueDate: '2026-08-01', amountDue: 2000, grandTotal: 2000, subtotal: 2000 }),
      makeInvoice(INVOICE_C, STUDENT_2, { dueDate: '2026-07-15', amountDue: 1500, grandTotal: 1500, subtotal: 1500 }),
    ],
    accounts: [makeAccount(STUDENT_1), makeAccount(STUDENT_2)],
  };
}

const multiDto = (overrides: Record<string, unknown> = {}): any => ({
  applications: [
    { invoiceId: INVOICE_A, amount: 1000 },
    { invoiceId: INVOICE_B, amount: 500 },
    { invoiceId: INVOICE_C, amount: 1500 },
  ],
  familyId: FAMILY_ID,
  gateway: 'cheque',
  amount: 3000,
  ...overrides,
});

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('recordManualPayment — FB-4.4 multi-target composition', () => {
  it('one transactWrite: [payment Put, 3 invoice applies in canonical order, S1 group (ledger+update), S2 group (ledger+update)]', async () => {
    const { service, mocks } = buildService(threeInvoiceFixture());
    await service.recordManualPayment(SCHOOL_ID, multiDto(), ctx);

    expect(mocks.dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
    const items = mocks.dynamoDBClient.transactWrite.mock.calls[0][1];

    // 1 payment + 3 invoice applies + (2 ledger + 1 update for S1) + (1 ledger + 1 update for S2)
    expect(items).toHaveLength(9);
    expect(items[0].Put?.Item?.entityType).toBe('PAYMENT');
    expect(items[0].Put?.ConditionExpression).toBe('attribute_not_exists(entityKey)');

    // Canonical plan order: A (due 07-01), C (due 07-15), B (due 08-01).
    expect(items[1].Update._invoiceId).toBe(INVOICE_A);
    expect(items[1].Update._amount).toBe(1000);
    expect(items[2].Update._invoiceId).toBe(INVOICE_C);
    expect(items[2].Update._amount).toBe(1500);
    expect(items[3].Update._invoiceId).toBe(INVOICE_B);
    expect(items[3].Update._amount).toBe(500);

    // Account grouping in first-appearance order of the plan: S1 (from A), then S2 (from C).
    expect(items[4].Put.Item._account).toBe(`acct-${STUDENT_1}`);
    expect(items[5].Put.Item._account).toBe(`acct-${STUDENT_1}`);
    expect(items[6].Update._account).toBe(`acct-${STUDENT_1}`);
    expect(items[7].Put.Item._account).toBe(`acct-${STUDENT_2}`);
    expect(items[8].Update._account).toBe(`acct-${STUDENT_2}`);

    // Per-account composite inputs: S1 gets A (1000) + B (500) in plan order; S2 gets C (1500).
    const compositeCalls = mocks.studentAccountsService.buildCompositeLedgerTransactItems.mock.calls;
    expect(compositeCalls).toHaveLength(2);
    expect(compositeCalls[0][1].map((i: any) => i.credit)).toEqual([1000, 500]);
    expect(compositeCalls[0][1][0].description).toContain('INV-AAAA');
    expect(compositeCalls[0][1][1].description).toContain('INV-BBBB');
    expect(compositeCalls[1][1].map((i: any) => i.credit)).toEqual([1500]);
    expect(compositeCalls[1][1][0].description).toContain('INV-CCCC');
  });

  it('payment entity: null ids, familyId stamped, NO gsi2/gsi14 keys, applicationInvoiceIds denormalized, receiptNumber assigned', async () => {
    const { service, mocks } = buildService(threeInvoiceFixture());
    await service.recordManualPayment(SCHOOL_ID, multiDto({ referenceNumber: 'CHQ-77', notes: 'family cheque' }), ctx);

    const payment = mocks.dynamoDBClient.transactWrite.mock.calls[0][1][0].Put.Item as PaymentEntity;
    expect(payment.invoiceId).toBeNull();
    expect(payment.studentAccountId).toBeNull();
    expect(payment.studentId).toBeNull();
    expect(payment.familyId).toBe(FAMILY_ID);
    expect(payment.gsi2pk).toBeUndefined();
    expect(payment.gsi2sk).toBeUndefined();
    expect(payment.gsi14pk).toBeUndefined();
    expect(payment.gsi14sk).toBeUndefined();
    expect(payment.gradeLevel).toBeUndefined();
    expect(payment.status).toBe('completed');
    expect(payment.receiptNumber).toBe('RCP-2026-0777');
    expect(payment.gatewayTransactionId).toBe('CHQ-77');
    expect(payment.metadata.notes).toBe('family cheque');
    // Canonical order (A, C, B) in the persisted applications.
    expect(payment.applications).toEqual([
      { targetType: 'invoice', invoiceId: INVOICE_A, amount: 1000 },
      { targetType: 'invoice', invoiceId: INVOICE_C, amount: 1500 },
      { targetType: 'invoice', invoiceId: INVOICE_B, amount: 500 },
    ]);
    expect(payment.applicationInvoiceIds).toEqual([INVOICE_A, INVOICE_C, INVOICE_B]);
  });

  it('response DTO satisfies the FB-4.1 representation matrix (real shared-types schema parse)', async () => {
    const { service } = buildService(threeInvoiceFixture());
    const dto = await service.recordManualPayment(SCHOOL_ID, multiDto(), ctx);

    expect(dto.invoiceId).toBeNull();
    expect(dto.studentAccountId).toBeNull();
    expect(dto.familyId).toBe(FAMILY_ID);
    // The mapper's output must pass the response superRefine on the way OUT.
    expect(() => paymentResponseSchema.parse(dto)).not.toThrow();
    // Entity-internal denormalization never leaks into the DTO.
    expect((dto as any).applicationInvoiceIds).toBeUndefined();
  });

  it('event published post-commit with invoiceId=null', async () => {
    const { service, mocks } = buildService(threeInvoiceFixture());
    await service.recordManualPayment(SCHOOL_ID, multiDto(), ctx);
    expect(mocks.eventsService.publishPaymentCompleted).toHaveBeenCalledWith(
      TENANT_ID, SCHOOL_ID, expect.any(String), null, 3000, 'cheque',
    );
  });

  it('idempotency-key hit short-circuits the multi shape: zero fetches, zero writes', async () => {
    const { service, mocks } = buildService(threeInvoiceFixture());
    const existing = {
      paymentId: 'existing-multi',
      invoiceId: null,
      studentAccountId: null,
      studentId: null,
      familyId: FAMILY_ID,
      schoolId: SCHOOL_ID,
      amount: 3000,
      currency: 'NPR',
      gateway: 'cheque',
      status: 'completed',
      paidAt: '2026-07-15T00:00:00Z',
      paidBy: 'user-1',
      receiptNumber: 'RCP-2026-0700',
      metadata: {},
      refunds: [],
      createdAt: '2026-07-15T00:00:00Z',
      updatedAt: '2026-07-15T00:00:00Z',
    };
    mocks.dynamoDBClient.queryGSI.mockResolvedValue({ items: [existing], hasMore: false });

    const result = await service.recordManualPayment(
      SCHOOL_ID,
      multiDto({ idempotencyKey: '3f1d0a34-9f47-4a3b-8b3c-2f4f4d1c9e01' }),
      ctx,
    );
    expect(result.id).toBe('existing-multi');
    expect(mocks.invoicesService.getEntity).not.toHaveBeenCalled();
    expect(mocks.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
  });

  it('TransactionCanceledException → 409 CONCURRENT_UPDATE with per-op labels (payment/invoice/ledger/account)', async () => {
    const { service, mocks } = buildService(threeInvoiceFixture());
    mocks.dynamoDBClient.transactWrite.mockRejectedValue(
      Object.assign(new Error('cancelled'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [
          { Code: 'None' }, { Code: 'ConditionalCheckFailed' }, { Code: 'None' },
          { Code: 'None' }, { Code: 'None' }, { Code: 'None' }, { Code: 'None' },
          { Code: 'None' }, { Code: 'None' },
        ],
      }),
    );
    try {
      await service.recordManualPayment(SCHOOL_ID, multiDto(), ctx);
      fail('expected ConflictException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      const body = e.getResponse();
      expect(body.code).toBe('CONCURRENT_UPDATE');
      expect(body.message).toContain('invoice_apply_0_INV-AAAA=ConditionalCheckFailed');
    }
  });
});

describe('recordManualPayment — FB-4.4 multi-target validation matrix', () => {
  it('paid target → 400 INVOICE_ALREADY_PAID naming the invoice', async () => {
    const fixture = threeInvoiceFixture();
    fixture.invoices[2] = makeInvoice(INVOICE_C, STUDENT_2, { status: 'paid', amountDue: 0 });
    const { service, mocks } = buildService(fixture);
    try {
      await service.recordManualPayment(SCHOOL_ID, multiDto(), ctx);
      fail('expected BadRequestException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getResponse().code).toBe('INVOICE_ALREADY_PAID');
      expect(e.getResponse().message).toContain('INV-CCCC');
    }
    expect(mocks.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
  });

  it('cancelled target → 400 INVOICE_CANCELLED', async () => {
    const fixture = threeInvoiceFixture();
    fixture.invoices[1] = makeInvoice(INVOICE_B, STUDENT_1, { status: 'cancelled' });
    const { service } = buildService(fixture);
    await expect(service.recordManualPayment(SCHOOL_ID, multiDto(), ctx)).rejects.toMatchObject({
      response: { code: 'INVOICE_CANCELLED' },
    });
  });

  it('unknown target invoice → 404 (school-scoped getEntity)', async () => {
    const fixture = threeInvoiceFixture();
    fixture.invoices = fixture.invoices.slice(0, 2); // C missing → wrong school / deleted
    const { service } = buildService(fixture);
    await expect(service.recordManualPayment(SCHOOL_ID, multiDto(), ctx)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('mixed target currencies → 400 PAYMENT_CURRENCY_MISMATCH', async () => {
    const fixture = threeInvoiceFixture();
    fixture.invoices[2] = makeInvoice(INVOICE_C, STUDENT_2, { currency: 'USD', dueDate: '2026-07-15', amountDue: 1500 });
    const { service } = buildService(fixture);
    await expect(service.recordManualPayment(SCHOOL_ID, multiDto(), ctx)).rejects.toMatchObject({
      response: { code: 'PAYMENT_CURRENCY_MISMATCH' },
    });
  });

  it('declared dto.currency differing from targets → 400 PAYMENT_CURRENCY_MISMATCH', async () => {
    const { service } = buildService(threeInvoiceFixture());
    await expect(
      service.recordManualPayment(SCHOOL_ID, multiDto({ currency: 'USD' }), ctx),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_CURRENCY_MISMATCH' } });
  });

  it('stale amountDue (allocation > current due) → 409 PAYMENT_APPLICATION_EXCEEDS_DUE with params', async () => {
    const fixture = threeInvoiceFixture();
    // Someone paid 800 of A concurrently — A's due is now 200 but the operator allocates 1000.
    fixture.invoices[0] = makeInvoice(INVOICE_A, STUDENT_1, { dueDate: '2026-07-01', amountDue: 200, amountPaid: 800 });
    const { service, mocks } = buildService(fixture);
    try {
      await service.recordManualPayment(SCHOOL_ID, multiDto(), ctx);
      fail('expected ConflictException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      const body = e.getResponse();
      expect(body.code).toBe('PAYMENT_APPLICATION_EXCEEDS_DUE');
      expect(body.params).toMatchObject({ invoiceId: INVOICE_A, allocated: 1000, amountDue: 200 });
    }
    expect(mocks.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
  });

  it('Σ(applications) < amount → 400 PAYMENT_EXCEEDS_ALLOCATABLE (no opening-balance leg for multi-target)', async () => {
    const { service } = buildService(threeInvoiceFixture());
    await expect(
      service.recordManualPayment(SCHOOL_ID, multiDto({ amount: 3500 }), ctx),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_EXCEEDS_ALLOCATABLE' } });
  });

  it('missing billing account for one student → 404 ACCOUNT_NOT_FOUND; no writes', async () => {
    const fixture = threeInvoiceFixture();
    fixture.accounts = [makeAccount(STUDENT_1)]; // S2 account missing
    const { service, mocks } = buildService(fixture);
    await expect(service.recordManualPayment(SCHOOL_ID, multiDto(), ctx)).rejects.toMatchObject({
      response: { code: 'ACCOUNT_NOT_FOUND' },
    });
    expect(mocks.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
  });

  it('chronology guard per affected account: paidDate < ANY account openingBalanceAsOf → 409 naming account + student', async () => {
    const fixture = threeInvoiceFixture();
    fixture.accounts = [
      makeAccount(STUDENT_1),
      makeAccount(STUDENT_2, { openingBalance: 5000, openingBalanceAsOf: '2026-04-01' }),
    ];
    const { service, mocks } = buildService(fixture);
    try {
      await service.recordManualPayment(SCHOOL_ID, multiDto({ paidDate: '2026-03-15' }), ctx);
      fail('expected ConflictException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(ConflictException);
      const body = e.getResponse();
      expect(body.code).toBe('PAYMENT_PAID_DATE_BEFORE_OPENING_AS_OF');
      expect(body.params).toMatchObject({ accountId: `acct-${STUDENT_2}`, studentId: STUDENT_2 });
    }
    expect(mocks.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
  });

  it('same-day paidDate === openingBalanceAsOf → allowed (boundary mirror of single-target CONC-7)', async () => {
    const fixture = threeInvoiceFixture();
    fixture.accounts = [
      makeAccount(STUDENT_1),
      makeAccount(STUDENT_2, { openingBalance: 5000, openingBalanceAsOf: '2026-04-01' }),
    ];
    const { service, mocks } = buildService(fixture);
    await service.recordManualPayment(SCHOOL_ID, multiDto({ paidDate: '2026-04-01' }), ctx);
    expect(mocks.dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
    const payment = mocks.dynamoDBClient.transactWrite.mock.calls[0][1][0].Put.Item;
    expect(payment.paidAt).toBe('2026-04-01');
  });
});
