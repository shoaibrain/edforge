/**
 * LILI-BUG #501 — idempotent manual payment, and the pending-session lookup
 * that shared its root cause.
 *
 * Runtime evidence (issue #501): posting the SAME manual payment twice with
 * the SAME idempotencyKey booked TWO payments. The duplicate check was a GSI1
 * Query carrying `Limit: 1` and a FilterExpression on `idempotencyKey`, and
 * DynamoDB applies `Limit` BEFORE the filter — so against a school-scoped
 * partition holding every payment the school ever took, one arbitrary row was
 * read, filtered away, and the caller concluded "not a duplicate". The check
 * effectively never matched.
 *
 * `findPendingForInvoice` carried the identical `Limit: 1`-before-filter shape
 * and is fixed alongside it.
 *
 * The replacement is an O(1) GetItem on a sentinel row written as the LAST
 * item of the payment's own TransactWriteItems under
 * `attribute_not_exists(entityKey)`. Making it part of the transaction is what
 * closes the read-then-write TOCTOU: the pre-check at the top of
 * recordManualPayment cannot see a concurrent retry that has not committed.
 *
 * The subtle correctness property pinned here is INDEX ALIGNMENT. The replay
 * decision reads `CancellationReasons[sentinelIndex]`, and that index comes
 * from a positional label array built separately from the transact items. If
 * the two ever drift, a ledger failure would be misread as a duplicate and
 * silently replayed as success. Several tests below exist only to pin that.
 */

import { Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type { BillingAccountEntity } from '../common/entities/billing-account.entity';
import type { PaymentEntity } from '../common/entities/payment.entity';
import {
  createPaymentIdempotencySentinel,
  PAYMENT_IDEMPOTENCY_TTL_HOURS,
} from '../common/entities/payment.entity';
import { EntityKeyBuilder } from '../common/entities/base.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';
const INVOICE_ID = 'invoice-uuid';
const ACCOUNT_ID = 'account-uuid';
const IDEM_KEY = '3f1d0a34-9f47-4a3b-8b3c-2f4f4d1c9e01';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as unknown as Parameters<PaymentsService['recordManualPayment']>[2];

function makeInvoice(overrides: Partial<InvoiceEntity> = {}): InvoiceEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `INVOICE#${SCHOOL_ID}#${INVOICE_ID}`,
    entityType: 'INVOICE',
    invoiceId: INVOICE_ID,
    invoiceNumber: 'INV-2026-0001',
    studentAccountId: ACCOUNT_ID,
    studentId: STUDENT_ID,
    studentName: 'Test Student',
    schoolId: SCHOOL_ID,
    schoolName: 'Test School',
    academicYear: '2025-2026',
    lineItems: [],
    subtotal: 2000,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 2000,
    amountPaid: 0,
    amountDue: 2000,
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

function makeAccount(): BillingAccountEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `BILLING_ACCOUNT#${SCHOOL_ID}#${STUDENT_ID}`,
    entityType: 'BILLING_ACCOUNT',
    accountId: ACCOUNT_ID,
    schoolId: SCHOOL_ID,
    studentId: STUDENT_ID,
    studentName: 'Test Student',
    balance: 0,
    totalPaid: 0,
    lastPaymentDate: null,
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '',
    createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1,
  } as unknown as BillingAccountEntity;
}

function makePayment(overrides: Partial<PaymentEntity> = {}): PaymentEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: EntityKeyBuilder.payment(SCHOOL_ID, 'pay-prior'),
    entityType: 'PAYMENT',
    paymentId: 'pay-prior',
    idempotencyKey: IDEM_KEY,
    schoolId: SCHOOL_ID,
    studentId: STUDENT_ID,
    invoiceId: INVOICE_ID,
    amount: 2000,
    currency: 'NPR',
    gateway: 'cash',
    status: 'completed',
    paidAt: '2026-07-15T00:00:00Z',
    paidBy: 'user-1',
    receiptNumber: 'RCP-PRIOR',
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '',
    metadata: {},
    refunds: [],
    createdAt: '2026-07-15T00:00:00Z',
    createdBy: 'user-1',
    updatedAt: '2026-07-15T00:00:00Z',
    updatedBy: 'user-1',
    version: 1,
    ...overrides,
  } as PaymentEntity;
}

interface DdbMock {
  getClient: jest.Mock;
  getItem: jest.Mock;
  transactWrite: jest.Mock;
  getTableName: jest.Mock;
  queryGSI: jest.Mock;
}

/** The private members these tests drive directly. */
interface PaymentsServicePrivates {
  findPendingForInvoice(
    schoolId: string,
    invoiceId: string,
    gateway: string,
    context: typeof ctx,
  ): Promise<PaymentEntity | null>;
}

function buildService(): { service: PaymentsService; ddb: DdbMock } {
  const ddb: DdbMock = {
    getClient: jest.fn().mockResolvedValue({}),
    // Default: the billing account resolves, nothing else exists.
    getItem: jest.fn().mockImplementation(async (_c: unknown, _t: string, entityKey: string) =>
      entityKey.startsWith('BILLING_ACCOUNT#') ? makeAccount() : null,
    ),
    transactWrite: jest.fn().mockResolvedValue(undefined),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
  const invoicesService = {
    getEntity: jest.fn().mockResolvedValue(makeInvoice()),
    buildApplyPaymentTransactItem: jest.fn().mockImplementation((invoice: InvoiceEntity, amount: number) => ({
      item: { Update: { TableName: 'edforge-finance-test', _tag: 'invoice_apply' } },
      newStatus: amount >= invoice.amountDue ? 'paid' : 'partially_paid',
      newAmountPaid: invoice.amountPaid + amount,
      newAmountDue: Math.max(0, invoice.grandTotal - invoice.amountPaid - amount),
    })),
  };
  const studentAccountsService = {
    buildCompositeLedgerTransactItems: jest.fn().mockImplementation(
      (acct: BillingAccountEntity, inputs: unknown[]) => ({
        items: [
          ...inputs.map((_, idx) => ({
            Put: { TableName: 'edforge-finance-test', Item: { entityType: 'LEDGER_ENTRY', _idx: idx } },
          })),
          { Update: { TableName: 'edforge-finance-test', Key: { tenantId: acct.tenantId, entityKey: acct.entityKey } } },
        ],
        ledgerEntries: inputs.map((_, idx) => ({ entryId: `ledger-${idx}` })),
        summedDelta: 0,
      }),
    ),
  };
  const eventsService = { publishPaymentCompleted: jest.fn().mockResolvedValue(undefined) };
  const sequenceService = { nextReceiptNumber: jest.fn().mockResolvedValue('RCP-2026-0042') };

  const service = new PaymentsService(
    ...([
      ddb, eventsService, sequenceService, invoicesService, studentAccountsService,
      {}, {}, { getStudentInfo: jest.fn() }, { optimize: jest.fn(async (u: unknown) => u) },
    ] as unknown as ConstructorParameters<typeof PaymentsService>),
  );
  return { service, ddb };
}

/** A TransactionCanceledException whose reason at `failIndex` is a condition failure. */
function cancelledAt(failIndex: number, itemCount: number): Error & {
  name: string;
  CancellationReasons: { Code?: string }[];
} {
  const err = new Error('Transaction cancelled') as Error & {
    name: string;
    CancellationReasons: { Code?: string }[];
  };
  err.name = 'TransactionCanceledException';
  err.CancellationReasons = Array.from({ length: itemCount }, (_, i) =>
    i === failIndex ? { Code: 'ConditionalCheckFailed' } : { Code: 'None' },
  );
  return err;
}

function singleDto(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: INVOICE_ID,
    gateway: 'cash',
    amount: 2000,
    idempotencyKey: IDEM_KEY,
    ...overrides,
  } as unknown as Parameters<PaymentsService['recordManualPayment']>[1];
}

/** A sentinel already visible to the pre-check — the simple duplicate case. */
function sentinelHit(ddb: DdbMock, payment: PaymentEntity) {
  ddb.getItem.mockImplementation(async (_c: unknown, _t: string, entityKey: string) => {
    if (entityKey === EntityKeyBuilder.paymentIdempotency(SCHOOL_ID, IDEM_KEY)) {
      return { paymentId: payment.paymentId };
    }
    if (entityKey === EntityKeyBuilder.payment(SCHOOL_ID, payment.paymentId)) return payment;
    if (entityKey.startsWith('BILLING_ACCOUNT#')) return makeAccount();
    return null;
  });
}

/**
 * The RACE the sentinel exists for: the pre-check sees nothing, a concurrent
 * attempt commits, and our conditional Put is the op that fails.
 *
 * Modelled by making the sentinel invisible to the FIRST read and visible
 * afterwards. Without this staging a test would short-circuit at the
 * pre-check and never reach transactWrite — passing while proving nothing
 * about the replay path.
 */
function sentinelAppearsAfterPrecheck(
  ddb: DdbMock,
  payment: PaymentEntity,
  opts: { paymentReadable?: boolean } = {},
) {
  const paymentReadable = opts.paymentReadable !== false;
  let sentinelReads = 0;
  ddb.getItem.mockImplementation(async (_c: unknown, _t: string, entityKey: string) => {
    if (entityKey === EntityKeyBuilder.paymentIdempotency(SCHOOL_ID, IDEM_KEY)) {
      sentinelReads += 1;
      return sentinelReads === 1 ? null : { paymentId: payment.paymentId };
    }
    if (entityKey === EntityKeyBuilder.payment(SCHOOL_ID, payment.paymentId)) {
      return paymentReadable ? payment : null;
    }
    if (entityKey.startsWith('BILLING_ACCOUNT#')) return makeAccount();
    return null;
  });
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// ---------------------------------------------------------------------------

describe('#501 — the sentinel row itself', () => {
  it('is keyed on school + idempotency key, so two schools cannot collide', () => {
    expect(EntityKeyBuilder.paymentIdempotency(SCHOOL_ID, IDEM_KEY))
      .toBe(`PAYMENT_IDEMPOTENCY#${SCHOOL_ID}#${IDEM_KEY}`);
    expect(EntityKeyBuilder.paymentIdempotency('other-school', IDEM_KEY))
      .not.toBe(EntityKeyBuilder.paymentIdempotency(SCHOOL_ID, IDEM_KEY));
  });

  it('carries the paymentId, which is the only thing a replay needs', () => {
    const s = createPaymentIdempotencySentinel(TENANT_ID, SCHOOL_ID, IDEM_KEY, 'pay-1', 'user-1');
    expect(s.paymentId).toBe('pay-1');
    expect(s.entityType).toBe('PAYMENT_IDEMPOTENCY');
    expect(s.tenantId).toBe(TENANT_ID);
  });

  it('expires in epoch SECONDS, not milliseconds — DDB TTL silently ignores ms', () => {
    const before = Math.floor(Date.now() / 1000);
    const s = createPaymentIdempotencySentinel(TENANT_ID, SCHOOL_ID, IDEM_KEY, 'pay-1', 'user-1');
    const expected = before + PAYMENT_IDEMPOTENCY_TTL_HOURS * 3600;

    expect(s.ttl).toBeGreaterThanOrEqual(expected - 2);
    expect(s.ttl).toBeLessThanOrEqual(expected + 2);
    // A millisecond value would be ~1000x larger. Pin the magnitude so a unit
    // slip cannot pass: a ms timestamp in 2026 exceeds 1e12, seconds are ~1e9.
    expect(s.ttl).toBeLessThan(1e12);
  });

  it('names the expiry attribute `ttl`, matching the table timeToLiveAttribute', () => {
    const s = createPaymentIdempotencySentinel(TENANT_ID, SCHOOL_ID, IDEM_KEY, 'pay-1', 'user-1');
    // A rename here is invisible at compile time on the DDB side and would
    // silently disable expiry, leaving sentinels forever.
    expect(Object.keys(s)).toContain('ttl');
  });
});

describe('#501 — the sentinel is written inside the payment transaction', () => {
  it('appends it LAST, guarded by attribute_not_exists(entityKey)', async () => {
    const { service, ddb } = buildService();
    await service.recordManualPayment(SCHOOL_ID, singleDto(), ctx);

    const items = ddb.transactWrite.mock.calls[0][1] as Array<Record<string, unknown>>;
    const last = items[items.length - 1] as { Put?: { Item?: Record<string, unknown>; ConditionExpression?: string } };

    expect(last.Put).toBeDefined();
    expect(last.Put!.Item!.entityType).toBe('PAYMENT_IDEMPOTENCY');
    expect(last.Put!.Item!.entityKey).toBe(EntityKeyBuilder.paymentIdempotency(SCHOOL_ID, IDEM_KEY));
    expect(last.Put!.ConditionExpression).toBe('attribute_not_exists(entityKey)');
  });

  it('rides the SAME transactWrite as the payment — one call, not two writes', async () => {
    const { service, ddb } = buildService();
    await service.recordManualPayment(SCHOOL_ID, singleDto(), ctx);

    // Atomicity is the whole guarantee: a sentinel written separately could
    // commit while the payment failed, permanently swallowing a real payment.
    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
  });

  it('writes NO sentinel when the caller supplied no idempotencyKey', async () => {
    const { service, ddb } = buildService();
    await service.recordManualPayment(SCHOOL_ID, singleDto({ idempotencyKey: undefined }), ctx);

    const items = ddb.transactWrite.mock.calls[0][1] as Array<Record<string, unknown>>;
    const sentinels = items.filter(
      (i) => (i as { Put?: { Item?: { entityType?: string } } }).Put?.Item?.entityType === 'PAYMENT_IDEMPOTENCY',
    );
    expect(sentinels).toHaveLength(0);
  });
});

describe('#501 — replay when the sentinel loses the race', () => {
  it('returns the winning payment instead of throwing, when the SENTINEL is the failed op', async () => {
    const { service, ddb } = buildService();
    const prior = makePayment();

    sentinelAppearsAfterPrecheck(ddb, prior);
    ddb.transactWrite.mockImplementationOnce(async (_c: unknown, items: unknown[]) => {
      // The sentinel is last, so its reason index is items.length - 1.
      throw cancelledAt(items.length - 1, items.length);
    });

    const result = await service.recordManualPayment(SCHOOL_ID, singleDto(), ctx);

    expect(result.id).toBe('pay-prior');
    expect(result.receiptNumber).toBe('RCP-PRIOR');
    // Proves the replay came from the FAILED TRANSACTION, not the pre-check
    // short-circuit — otherwise this test would pass without exercising it.
    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
  });

  it('does NOT replay when a DIFFERENT op failed — a ledger conflict is a real error', async () => {
    const { service, ddb } = buildService();
    sentinelAppearsAfterPrecheck(ddb, makePayment());

    ddb.transactWrite.mockImplementationOnce(async (_c: unknown, items: unknown[]) => {
      // index 1 is the invoice apply, not the sentinel.
      throw cancelledAt(1, items.length);
    });

    // Misreading this as a duplicate would report a failed write as success.
    await expect(service.recordManualPayment(SCHOOL_ID, singleDto(), ctx)).rejects.toThrow();
  });

  it('does NOT replay when no idempotencyKey was supplied, even on a cancelled transaction', async () => {
    const { service, ddb } = buildService();
    ddb.transactWrite.mockImplementationOnce(async (_c: unknown, items: unknown[]) => {
      throw cancelledAt(items.length - 1, items.length);
    });

    await expect(
      service.recordManualPayment(SCHOOL_ID, singleDto({ idempotencyKey: undefined }), ctx),
    ).rejects.toThrow();
  });

  it('falls through to the error when the winner cannot be read back', async () => {
    const { service, ddb } = buildService();
    // Sentinel exists but the payment row does not — never expected, but it
    // must surface as an error rather than a silent success with no payment.
    sentinelAppearsAfterPrecheck(ddb, makePayment(), { paymentReadable: false });
    ddb.transactWrite.mockImplementationOnce(async (_c: unknown, items: unknown[]) => {
      throw cancelledAt(items.length - 1, items.length);
    });

    await expect(service.recordManualPayment(SCHOOL_ID, singleDto(), ctx)).rejects.toThrow();
  });
});

describe('#501 — the duplicate pre-check is an O(1) GetItem', () => {
  it('short-circuits on a sentinel hit without touching the invoice or writing', async () => {
    const { service, ddb } = buildService();
    sentinelHit(ddb, makePayment());

    const result = await service.recordManualPayment(SCHOOL_ID, singleDto(), ctx);

    expect(result.id).toBe('pay-prior');
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });

  it('uses GetItem, NOT a filtered GSI1 Query — the Limit-before-Filter bug itself', async () => {
    const { service, ddb } = buildService();
    sentinelHit(ddb, makePayment());

    await service.recordManualPayment(SCHOOL_ID, singleDto(), ctx);

    // The original lookup was queryGSI('GSI1', …, filter on idempotencyKey,
    // limit 1). DDB applied the limit first, so it read one arbitrary row of
    // the school partition and filtered it away. Any queryGSI on this path is
    // a regression to that shape.
    expect(ddb.queryGSI).not.toHaveBeenCalled();
    expect(ddb.getItem).toHaveBeenCalledWith(
      expect.anything(),
      TENANT_ID,
      EntityKeyBuilder.paymentIdempotency(SCHOOL_ID, IDEM_KEY),
    );
  });

  it('records normally when no sentinel exists — payments predating this change do not regress', async () => {
    const { service, ddb } = buildService();
    // The default mock has no sentinel — exactly the state of every payment
    // recorded before this change shipped.
    await service.recordManualPayment(SCHOOL_ID, singleDto(), ctx);

    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
  });
});

describe('#501 — findPendingForInvoice no longer starves on Limit-before-Filter', () => {
  function priv(service: PaymentsService): PaymentsServicePrivates {
    return service as unknown as PaymentsServicePrivates;
  }

  it('does not pass Limit 1, and reads newest-first so the page cap truncates the OLDEST rows', async () => {
    const { service, ddb } = buildService();
    ddb.queryGSI.mockResolvedValue({ items: [], hasMore: false });

    await priv(service).findPendingForInvoice(SCHOOL_ID, INVOICE_ID, 'esewa', ctx);

    const call = ddb.queryGSI.mock.calls[0];
    expect(call[8]).toBeGreaterThan(1);   // limit — a page, not a single row
    expect(call[9]).toBe(false);          // scanIndexForward: newest first
  });

  it('re-asserts status in JS — a voided payment keeps its PAYMENT#pending gsi1sk', async () => {
    const { service, ddb } = buildService();
    // The key prefix alone does not prove the row is still pending: voidPayment
    // flipped status without re-keying gsi1sk (fixed separately in #502b), so
    // cancelled rows linger under this prefix. Trusting the index would hand
    // back a cancelled payment as an active session.
    ddb.queryGSI.mockResolvedValue({
      items: [makePayment({ paymentId: 'pay-cancelled', status: 'cancelled' })],
      hasMore: false,
    });

    const found = await priv(service).findPendingForInvoice(SCHOOL_ID, INVOICE_ID, 'esewa', ctx);
    expect(found).toBeNull();
  });

  it('returns the pending row when one is present on the page', async () => {
    const { service, ddb } = buildService();
    ddb.queryGSI.mockResolvedValue({
      items: [
        makePayment({ paymentId: 'pay-cancelled', status: 'cancelled' }),
        makePayment({ paymentId: 'pay-pending', status: 'pending' }),
      ],
      hasMore: false,
    });

    const found = await priv(service).findPendingForInvoice(SCHOOL_ID, INVOICE_ID, 'esewa', ctx);
    expect(found?.paymentId).toBe('pay-pending');
  });

  it('follows the cursor across pages instead of giving up after the first', async () => {
    const { service, ddb } = buildService();
    const cursor = Buffer.from(JSON.stringify({ entityKey: 'x' })).toString('base64');
    ddb.queryGSI
      .mockResolvedValueOnce({ items: [makePayment({ status: 'cancelled' })], lastEvaluatedKey: cursor, hasMore: true })
      .mockResolvedValueOnce({ items: [makePayment({ paymentId: 'pay-page2', status: 'pending' })], hasMore: false });

    const found = await priv(service).findPendingForInvoice(SCHOOL_ID, INVOICE_ID, 'esewa', ctx);

    expect(found?.paymentId).toBe('pay-page2');
    expect(ddb.queryGSI).toHaveBeenCalledTimes(2);
    // Page 2 must resume from page 1's decoded cursor, not restart.
    expect(ddb.queryGSI.mock.calls[1][10]).toEqual({ entityKey: 'x' });
  });

  it('stops at the page cap rather than reading a whole school partition', async () => {
    const { service, ddb } = buildService();
    const cursor = Buffer.from(JSON.stringify({ entityKey: 'x' })).toString('base64');
    // Always another page, never a match: without a cap this is unbounded.
    ddb.queryGSI.mockResolvedValue({ items: [], lastEvaluatedKey: cursor, hasMore: true });

    const found = await priv(service).findPendingForInvoice(SCHOOL_ID, INVOICE_ID, 'esewa', ctx);

    expect(found).toBeNull();
    expect(ddb.queryGSI.mock.calls.length).toBeLessThanOrEqual(20);
    expect(ddb.queryGSI.mock.calls.length).toBeGreaterThan(1);
  });
});
