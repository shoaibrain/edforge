/**
 * payments.service spec — Sprint C2.B.T4 atomic-write contract.
 *
 * Locks the post-T4 invariant: `recordManualPayment` writes the Payment +
 * Invoice update + LedgerEntry + BillingAccount update as a single
 * `TransactWriteItems`, NOT as four sequential ops with try/catch wrappers.
 * Closes BUG-F3 — pre-T4 a partial failure left the Payment in `completed`
 * status while the invoice/ledger/account stayed unchanged, producing
 * silent corruption with only a "CRITICAL: manual reconciliation required"
 * log line.
 *
 * Coverage:
 *   1. Happy path — exactly 4 transact items, in the documented order,
 *      using the helpers from InvoicesService + StudentAccountsService.
 *   2. Account not found → 404 ACCOUNT_NOT_FOUND, no transactWrite called.
 *   3. TransactionCanceledException → 409 ConflictException carrying the
 *      per-op CancellationReasons string.
 *   4. Idempotency fast-path skip when the same idempotencyKey was seen.
 */

import { ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { FinanceErrors } from '../common/errors/finance-errors';
import type { BillingAccountEntity } from '../common/entities/billing-account.entity';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type { PaymentEntity } from '../common/entities/payment.entity';

const ctx = {
  tenantId: 'tenant-x',
  userId: 'user-1',
  email: 'admin@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt-x',
} as any;

const SCHOOL_ID = '6d0a8f2f-c710-4992-97bb-a6bcb824ebab';
const STUDENT_ID = '0edac5b2-0803-44ac-be0d-79ebeb934291';
const INVOICE_ID = '74db7ac8-8495-494b-89ae-99434cf3ed52';

function makeInvoice(): InvoiceEntity {
  return {
    tenantId: ctx.tenantId,
    entityKey: `INVOICE#${SCHOOL_ID}#${INVOICE_ID}`,
    entityType: 'INVOICE',
    invoiceId: INVOICE_ID,
    invoiceNumber: 'INV-001',
    studentAccountId: 'd9072568-80c0-41ba-b1d6-aa2f9eaf9ad7',
    studentId: STUDENT_ID,
    studentName: 'Lilia Rain',
    schoolId: SCHOOL_ID,
    schoolName: 'Saraswati',
    academicYear: '2026-2027',
    lineItems: [],
    subtotal: 5000,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 5000,
    amountPaid: 0,
    amountDue: 5000,
    currency: 'NPR',
    dueDate: '2026-05-29',
    issuedDate: '2026-04-29',
    status: 'issued',
    statusHistory: [],
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    gsi3pk: '',
    gsi3sk: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
    updatedBy: '',
    version: 1,
  } as InvoiceEntity;
}

function makeAccount(): BillingAccountEntity {
  return {
    tenantId: ctx.tenantId,
    entityKey: `BILLING_ACCOUNT#${SCHOOL_ID}#${STUDENT_ID}`,
    entityType: 'BILLING_ACCOUNT',
    accountId: 'd9072568-80c0-41ba-b1d6-aa2f9eaf9ad7',
    schoolId: SCHOOL_ID,
    studentId: STUDENT_ID,
    studentName: 'Lilia Rain',
    balance: 5000,
    totalPaid: 0,
    lastPaymentDate: null,
    gsi1pk: '',
    gsi1sk: '',
    gsi2pk: '',
    gsi2sk: '',
    createdAt: '',
    createdBy: '',
    updatedAt: '',
    updatedBy: '',
    version: 1,
  };
}

function makeMockDdb() {
  return {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn(),
    putItem: jest.fn(),
    updateItem: jest.fn(),
    transactWrite: jest.fn().mockResolvedValue(undefined),
    query: jest.fn(),
    queryGSI: jest.fn(),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
  } as any;
}

function makeMockServices(invoice: InvoiceEntity) {
  // Real-ish builders — tests assert the items shape so the helpers must
  // produce what the spec says.
  const invoicesService = {
    getEntity: jest.fn().mockResolvedValue(invoice),
    get: jest.fn().mockResolvedValue({ ...invoice, id: invoice.invoiceId }),
    applyPayment: jest.fn(),
    buildApplyPaymentTransactItem: jest.fn().mockReturnValue({
      item: {
        Update: {
          TableName: 'edforge-finance-test',
          Key: { tenantId: ctx.tenantId, entityKey: invoice.entityKey },
          UpdateExpression: 'SET ...',
          ConditionExpression: '#v = :currentVersion AND #status IN (:issued, :partially_paid, :overdue)',
        },
      },
      newStatus: 'paid',
      newAmountPaid: 5000,
      newAmountDue: 0,
    }),
  } as any;
  const studentAccountsService = {
    buildLedgerEntryTransactItems: jest.fn().mockReturnValue({
      ledgerEntry: { entryId: 'led-1' },
      items: [
        { Put: { TableName: 'edforge-finance-test', Item: { entityType: 'LEDGER_ENTRY' } } },
        { Update: { TableName: 'edforge-finance-test', Key: { entityKey: 'BILLING_ACCOUNT#...' } } },
      ],
    }),
    recordLedgerEntry: jest.fn(),
  } as any;
  const sequenceService = {
    nextReceiptNumber: jest.fn().mockResolvedValue('RCP-001'),
  } as any;
  const eventsService = { publishPaymentCompleted: jest.fn().mockResolvedValue(undefined) } as any;
  const gatewayRegistry = { get: jest.fn() } as any;
  const gatewayConfigService = {} as any;
  return { invoicesService, studentAccountsService, sequenceService, eventsService, gatewayRegistry, gatewayConfigService };
}

describe('PaymentsService.recordManualPayment (Sprint C2.B.T4 atomic write)', () => {
  it('writes payment + invoice + ledger + account in a single 4-op TransactWriteItems', async () => {
    const ddb = makeMockDdb();
    const invoice = makeInvoice();
    const account = makeAccount();
    ddb.getItem
      .mockResolvedValueOnce(invoice)   // findByIdempotencyKey miss → no, this is invoice fetch
      .mockResolvedValueOnce(account);  // accountKey getItem
    const services = makeMockServices(invoice);
    services.invoicesService.getEntity.mockResolvedValue(invoice);
    // The flow does: idempotency findByIdempotencyKey → invoicesService.getEntity → getItem(account)
    // No idempotencyKey passed in this test; first getItem is account fetch.
    ddb.getItem.mockReset();
    ddb.getItem.mockResolvedValueOnce(account);

    const svc = new PaymentsService(
      ddb,
      services.eventsService,
      services.sequenceService,
      services.invoicesService,
      services.studentAccountsService,
      services.gatewayRegistry,
      services.gatewayConfigService,
      // Sprint C.1.6 — identityClient injected for getReceiptPdf;
      // existing pre-C.1.6 specs don't exercise it, so a {} stub is enough.
      {} as any,
    );

    await svc.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 5000, gateway: 'cash' } as any,
      ctx,
    );

    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
    const items = ddb.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(4);

    // Op 1 — Payment Put with attribute_not_exists
    expect(items[0].Put.Item.entityType).toBe('PAYMENT');
    expect(items[0].Put.Item.status).toBe('completed');
    expect(items[0].Put.Item.receiptNumber).toBe('RCP-001');
    expect(items[0].Put.ConditionExpression).toBe('attribute_not_exists(entityKey)');

    // Op 2 — Invoice Update from buildApplyPaymentTransactItem
    expect(services.invoicesService.buildApplyPaymentTransactItem).toHaveBeenCalledWith(
      invoice,
      5000,
      ctx,
    );
    expect(items[1].Update.ConditionExpression).toContain('#v = :currentVersion');
    expect(items[1].Update.ConditionExpression).toContain('#status IN');

    // Op 3 + 4 — Ledger Put + Account Update from buildLedgerEntryTransactItems
    expect(services.studentAccountsService.buildLedgerEntryTransactItems).toHaveBeenCalledWith(
      account,
      'payment',
      expect.any(String),
      expect.stringContaining('Payment RCP-001 via cash'),
      0,
      5000,
      ctx,
    );
    expect(items[2].Put.Item.entityType).toBe('LEDGER_ENTRY');
    expect(items[3].Update.Key.entityKey).toContain('BILLING_ACCOUNT#');
  });

  it('throws 404 ACCOUNT_NOT_FOUND when the BillingAccount is missing — and does NOT call transactWrite', async () => {
    const ddb = makeMockDdb();
    const invoice = makeInvoice();
    ddb.getItem.mockResolvedValueOnce(null); // no account
    const services = makeMockServices(invoice);
    services.invoicesService.getEntity.mockResolvedValue(invoice);

    const svc = new PaymentsService(
      ddb,
      services.eventsService,
      services.sequenceService,
      services.invoicesService,
      services.studentAccountsService,
      services.gatewayRegistry,
      services.gatewayConfigService,
      // Sprint C.1.6 — identityClient injected for getReceiptPdf;
      // existing pre-C.1.6 specs don't exercise it, so a {} stub is enough.
      {} as any,
    );

    await expect(
      svc.recordManualPayment(
        SCHOOL_ID,
        { invoiceId: INVOICE_ID, amount: 5000, gateway: 'cash' } as any,
        ctx,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(ddb.transactWrite).not.toHaveBeenCalled();
  });

  it('translates DDB TransactionCanceledException into 409 ConflictException with CONCURRENT_UPDATE', async () => {
    const ddb = makeMockDdb();
    const invoice = makeInvoice();
    const account = makeAccount();
    ddb.getItem.mockResolvedValueOnce(account);
    const services = makeMockServices(invoice);
    services.invoicesService.getEntity.mockResolvedValue(invoice);

    const txError: any = new Error('Transaction cancelled by upstream');
    txError.name = 'TransactionCanceledException';
    txError.CancellationReasons = [
      { Code: 'None' },
      { Code: 'ConditionalCheckFailed', Message: 'invoice version drifted' },
      { Code: 'None' },
      { Code: 'None' },
    ];
    ddb.transactWrite.mockRejectedValueOnce(txError);

    const svc = new PaymentsService(
      ddb,
      services.eventsService,
      services.sequenceService,
      services.invoicesService,
      services.studentAccountsService,
      services.gatewayRegistry,
      services.gatewayConfigService,
      // Sprint C.1.6 — identityClient injected for getReceiptPdf;
      // existing pre-C.1.6 specs don't exercise it, so a {} stub is enough.
      {} as any,
    );

    let caught: any;
    try {
      await svc.recordManualPayment(
        SCHOOL_ID,
        { invoiceId: INVOICE_ID, amount: 5000, gateway: 'cash' } as any,
        ctx,
      );
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ConflictException);
    const body = (caught as ConflictException).getResponse() as any;
    expect(body.code).toBe(FinanceErrors.CONCURRENT_UPDATE);
    expect(body.message).toContain('invoice_apply=ConditionalCheckFailed');
  });

  it('does NOT call transactWrite when an idempotencyKey was already seen (fast-path skip)', async () => {
    const ddb = makeMockDdb();
    const services = makeMockServices(makeInvoice());
    const existing: Partial<PaymentEntity> = {
      tenantId: ctx.tenantId,
      entityKey: 'PAYMENT#x#y',
      entityType: 'PAYMENT',
      paymentId: 'pay-existing',
      idempotencyKey: 'idem-1',
      schoolId: SCHOOL_ID,
      studentId: STUDENT_ID,
      invoiceId: INVOICE_ID,
      amount: 5000,
      currency: 'NPR',
      gateway: 'cash',
      status: 'completed',
      paidAt: '2026-04-29T00:00:00Z',
      paidBy: 'u',
      receiptNumber: 'RCP-prior',
      gsi1pk: '',
      gsi1sk: '',
      gsi2pk: '',
      gsi2sk: '',
      metadata: {},
      refunds: [],
      createdAt: '',
      createdBy: '',
      updatedAt: '',
      updatedBy: '',
      version: 1,
    };
    ddb.queryGSI.mockResolvedValueOnce({ items: [existing], hasMore: false });

    const svc = new PaymentsService(
      ddb,
      services.eventsService,
      services.sequenceService,
      services.invoicesService,
      services.studentAccountsService,
      services.gatewayRegistry,
      services.gatewayConfigService,
      // Sprint C.1.6 — identityClient injected for getReceiptPdf;
      // existing pre-C.1.6 specs don't exercise it, so a {} stub is enough.
      {} as any,
    );

    const result = await svc.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 5000, gateway: 'cash', idempotencyKey: 'idem-1' } as any,
      ctx,
    );
    expect(ddb.transactWrite).not.toHaveBeenCalled();
    expect(result.id).toBe('pay-existing');
  });
});
