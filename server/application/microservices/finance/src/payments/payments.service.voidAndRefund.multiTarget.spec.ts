/**
 * PaymentsService.voidPayment / refund — MULTI-TARGET reversal
 * EPIC-FB Sprint FB-4.5.
 *
 * Pins:
 *   1. Voiding a multi-target payment reverses EVERY application in ONE
 *      transactWrite: [payment status Update, N invoice restores in
 *      application order, per-account reversing ledger Puts + account
 *      Updates]. No sequential drift window like the single path.
 *   2. Refund of a multi-target payment: FULL only (partial → 400
 *      PAYMENT_REFUND_MULTI_TARGET_PARTIAL_UNSUPPORTED); reversal is the
 *      same one-transact composition with 'refund' ledger entries.
 *   3. No openingBalanceSettled decrement on multi (never touches opening).
 *   4. Single-target void/refund behavior is UNCHANGED — covered by the
 *      pre-existing voidAndRefund.splitPayment.spec (kept green).
 */

import { Logger, BadRequestException, ConflictException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { PaymentEntity } from '../common/entities/payment.entity';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type { BillingAccountEntity } from '../common/entities/billing-account.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = '44444444-4444-4444-8444-444444444444';
const STUDENT_1 = 'student-1-uuid';
const STUDENT_2 = 'student-2-uuid';
const INVOICE_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const INVOICE_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PAYMENT_ID = 'multi-pay-uuid';

const ctx = { tenantId: TENANT_ID, userId: 'user-1', jwtToken: 'jwt', role: 'TenantAdmin', schoolId: SCHOOL_ID } as any;

function multiPayment(overrides: Partial<PaymentEntity> = {}): PaymentEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`,
    entityType: 'PAYMENT',
    paymentId: PAYMENT_ID,
    invoiceId: null,
    studentAccountId: null,
    studentId: null,
    familyId: '55555555-dddd-4ddd-8ddd-555555555555',
    schoolId: SCHOOL_ID,
    amount: 2500,
    currency: 'NPR',
    gateway: 'cheque',
    status: 'completed',
    paidAt: '2026-07-15T00:00:00Z',
    paidBy: 'user-1',
    receiptNumber: 'RCP-2026-0800',
    metadata: {},
    refunds: [],
    applications: [
      { targetType: 'invoice', invoiceId: INVOICE_A, amount: 1000 },
      { targetType: 'invoice', invoiceId: INVOICE_B, amount: 1500 },
    ],
    applicationInvoiceIds: [INVOICE_A, INVOICE_B],
    gsi1pk: '', gsi1sk: '',
    createdAt: '2026-07-15T00:00:00Z',
    createdBy: 'user-1',
    updatedAt: '2026-07-15T00:00:00Z',
    updatedBy: 'user-1',
    version: 3,
    ...overrides,
  } as PaymentEntity;
}

function invoiceEntity(invoiceId: string, studentId: string, amountPaid: number): InvoiceEntity {
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
    subtotal: amountPaid,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: amountPaid,
    amountPaid,
    amountDue: 0,
    currency: 'NPR',
    dueDate: '2026-08-15',
    issuedDate: '2026-07-15',
    status: 'paid',
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '', gsi3pk: '', gsi3sk: '',
    createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 2,
  } as InvoiceEntity;
}

function account(studentId: string): BillingAccountEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `BILLING_ACCOUNT#${SCHOOL_ID}#${studentId}`,
    entityType: 'BILLING_ACCOUNT',
    accountId: `acct-${studentId}`,
    schoolId: SCHOOL_ID,
    studentId,
    studentName: `Student ${studentId.slice(8, 9)}`,
    balance: -2500,
    totalPaid: 2500,
    lastPaymentDate: '2026-07-15',
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '',
    createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 4,
  } as BillingAccountEntity;
}

interface Harness {
  service: PaymentsService;
  dynamoDBClient: any;
  invoicesService: any;
  studentAccountsService: any;
  eventsService: any;
}

function buildHarness(payment: PaymentEntity): Harness {
  const rows = new Map<string, any>([
    [payment.entityKey, payment],
    [`INVOICE#${SCHOOL_ID}#${INVOICE_A}`, invoiceEntity(INVOICE_A, STUDENT_1, 1000)],
    [`INVOICE#${SCHOOL_ID}#${INVOICE_B}`, invoiceEntity(INVOICE_B, STUDENT_2, 1500)],
    [`BILLING_ACCOUNT#${SCHOOL_ID}#${STUDENT_1}`, account(STUDENT_1)],
    [`BILLING_ACCOUNT#${SCHOOL_ID}#${STUDENT_2}`, account(STUDENT_2)],
  ]);
  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn().mockImplementation(async (_c: any, _t: string, entityKey: string) => rows.get(entityKey) ?? null),
    batchGetItems: jest.fn().mockImplementation(async (_c: any, keys: Array<{ entityKey: string }>) =>
      keys.map(k => rows.get(k.entityKey)).filter(Boolean),
    ),
    transactWrite: jest.fn().mockResolvedValue(undefined),
    updateItem: jest.fn().mockImplementation(async (_c: any, _t: string, entityKey: string) => rows.get(entityKey)),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
  };
  const invoicesService: any = {
    buildReversePaymentTransactItem: jest.fn().mockImplementation((invoice: any, amount: number) => ({
      item: {
        Update: {
          TableName: 'edforge-finance-test',
          Key: { tenantId: invoice.tenantId, entityKey: invoice.entityKey },
          _tag: 'invoice_reverse',
          _invoiceId: invoice.invoiceId,
          _amount: amount,
        },
      },
      newStatus: 'issued',
      newAmountPaid: invoice.amountPaid - amount,
      newAmountDue: amount,
    })),
    reversePaymentOnInvoice: jest.fn().mockResolvedValue({}),
  };
  const studentAccountsService: any = {
    buildCompositeLedgerTransactItems: jest.fn().mockImplementation((acct: any, inputs: any[]) => ({
      items: [
        ...inputs.map((i: any, idx: number) => ({
          Put: {
            TableName: 'edforge-finance-test',
            Item: { entityType: 'LEDGER_ENTRY', _account: acct.accountId, _idx: idx, _debit: i.debit, _entryType: i.entryType, _description: i.description },
          },
        })),
        { Update: { TableName: 'edforge-finance-test', Key: { tenantId: acct.tenantId, entityKey: acct.entityKey }, _tag: 'account_update', _account: acct.accountId } },
      ],
      ledgerEntries: inputs.map((_: any, idx: number) => ({ entryId: `rev-${acct.accountId}-${idx}` })),
      summedDelta: 0,
    })),
    recordLedgerEntry: jest.fn().mockResolvedValue({}),
    decrementOpeningBalanceSettled: jest.fn().mockResolvedValue({}),
  };
  const eventsService: any = {
    publishRefundProcessed: jest.fn().mockResolvedValue(undefined),
  };
  const service = new PaymentsService(
    dynamoDBClient,
    eventsService,
    { nextReceiptNumber: jest.fn() } as any,
    invoicesService,
    studentAccountsService,
    {} as any,
    {} as any,
    { getStudentInfo: jest.fn() } as any,
    { optimize: jest.fn(async (u: any) => u) } as any,
  );
  return { service, dynamoDBClient, invoicesService, studentAccountsService, eventsService };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('voidPayment — multi-target (FB-4.5)', () => {
  it('reverses EVERY application in ONE transactWrite: [payment update, 2 invoice restores, per-account ledger+update]', async () => {
    const h = buildHarness(multiPayment());
    const dto = await h.service.voidPayment(SCHOOL_ID, PAYMENT_ID, 'wrong cheque', ctx);

    expect(h.dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
    const items = h.dynamoDBClient.transactWrite.mock.calls[0][1];
    // 1 payment + 2 invoice restores + (1 ledger + 1 update) × 2 accounts = 7
    expect(items).toHaveLength(7);

    expect(items[0].Update.Key.entityKey).toBe(`PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`);
    expect(items[0].Update.ExpressionAttributeValues[':newStatus']).toBe('cancelled');
    expect(items[0].Update.ExpressionAttributeValues[':currentVersion']).toBe(3);

    expect(items[1].Update._invoiceId).toBe(INVOICE_A);
    expect(items[1].Update._amount).toBe(1000);
    expect(items[2].Update._invoiceId).toBe(INVOICE_B);
    expect(items[2].Update._amount).toBe(1500);

    expect(items[3].Put.Item._account).toBe(`acct-${STUDENT_1}`);
    expect(items[3].Put.Item._entryType).toBe('adjustment');
    expect(items[3].Put.Item._debit).toBe(1000);
    expect(items[3].Put.Item._description).toContain('voided');
    expect(items[3].Put.Item._description).toContain('INV-AAAA');
    expect(items[4].Update._account).toBe(`acct-${STUDENT_1}`);
    expect(items[5].Put.Item._account).toBe(`acct-${STUDENT_2}`);
    expect(items[5].Put.Item._debit).toBe(1500);
    expect(items[6].Update._account).toBe(`acct-${STUDENT_2}`);

    // Legacy single-target machinery NOT used on this path.
    expect(h.invoicesService.reversePaymentOnInvoice).not.toHaveBeenCalled();
    expect(h.studentAccountsService.recordLedgerEntry).not.toHaveBeenCalled();
    expect(h.studentAccountsService.decrementOpeningBalanceSettled).not.toHaveBeenCalled();
    expect(h.dynamoDBClient.updateItem).not.toHaveBeenCalled();

    expect(dto.status).toBe('cancelled');
    expect(dto.invoiceId).toBeNull();
    expect((dto.metadata as any).voidReason).toBe('wrong cheque');
  });

  it('TransactionCanceledException during multi-void → 409 CONCURRENT_UPDATE; nothing else attempted', async () => {
    const h = buildHarness(multiPayment());
    h.dynamoDBClient.transactWrite.mockRejectedValue(
      Object.assign(new Error('cancelled'), {
        name: 'TransactionCanceledException',
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }],
      }),
    );
    await expect(h.service.voidPayment(SCHOOL_ID, PAYMENT_ID, 'x', ctx)).rejects.toBeInstanceOf(ConflictException);
    expect(h.invoicesService.reversePaymentOnInvoice).not.toHaveBeenCalled();
  });

  it('void of a non-completed multi payment → 400 (shared guard)', async () => {
    const h = buildHarness(multiPayment({ status: 'cancelled' }));
    await expect(h.service.voidPayment(SCHOOL_ID, PAYMENT_ID, 'x', ctx)).rejects.toBeInstanceOf(BadRequestException);
    expect(h.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
  });
});

describe('refund — multi-target (FB-4.5)', () => {
  it('partial refund → 400 PAYMENT_REFUND_MULTI_TARGET_PARTIAL_UNSUPPORTED; no writes', async () => {
    const h = buildHarness(multiPayment());
    try {
      await h.service.refund(SCHOOL_ID, PAYMENT_ID, { amount: 500, reason: 'partial' } as any, ctx);
      fail('expected BadRequestException');
    } catch (e: any) {
      expect(e).toBeInstanceOf(BadRequestException);
      expect(e.getResponse().code).toBe('PAYMENT_REFUND_MULTI_TARGET_PARTIAL_UNSUPPORTED');
    }
    expect(h.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
    expect(h.dynamoDBClient.updateItem).not.toHaveBeenCalled();
  });

  it('FULL refund reverses every target atomically with refund ledger entries; status → refunded; event published', async () => {
    const h = buildHarness(multiPayment());
    const dto = await h.service.refund(SCHOOL_ID, PAYMENT_ID, { amount: 2500, reason: 'overcharge' } as any, ctx);

    expect(h.dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
    const items = h.dynamoDBClient.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(7);

    expect(items[0].Update.ExpressionAttributeValues[':newStatus']).toBe('refunded');
    expect(items[0].Update.ExpressionAttributeValues[':refunds']).toHaveLength(1);
    expect(items[1].Update._amount).toBe(1000);
    expect(items[2].Update._amount).toBe(1500);
    expect(items[3].Put.Item._entryType).toBe('refund');
    expect(items[3].Put.Item._description).toContain('Refund for payment RCP-2026-0800');
    expect(items[3].Put.Item._description).toContain('INV-AAAA');
    expect(items[5].Put.Item._debit).toBe(1500);

    expect(h.studentAccountsService.decrementOpeningBalanceSettled).not.toHaveBeenCalled();
    expect(h.eventsService.publishRefundProcessed).toHaveBeenCalledWith(
      TENANT_ID, SCHOOL_ID, PAYMENT_ID, expect.any(String), 2500,
    );
    expect(dto.status).toBe('refunded');
    expect(dto.refunds).toHaveLength(1);
    expect(dto.refunds[0].amount).toBe(2500);
  });

  it('refund exceeding payment amount still rejected upstream (shared guard)', async () => {
    const h = buildHarness(multiPayment());
    await expect(
      h.service.refund(SCHOOL_ID, PAYMENT_ID, { amount: 9999, reason: 'too much' } as any, ctx),
    ).rejects.toMatchObject({ response: { code: 'PAYMENT_REFUND_EXCEEDS_AMOUNT' } });
  });
});
