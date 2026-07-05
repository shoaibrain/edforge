/**
 * PaymentsService.recordManualPayment — SINGLE-TARGET GOLDEN REGRESSION
 * EPIC-FB Sprint FB-4.4 (methodology mirror of Package E's invoice golden).
 *
 * Pins the EXACT transact composition + payment-entity shape of the legacy
 * single-invoice path AS IT EXISTS BEFORE the multi-target write path lands,
 * so the FB-4.4 refactor is provably behavior-preserving:
 *
 *   1. TransactWriteItems ordering: [payment Put, invoice apply Update,
 *      ...composite ledger Puts, account Update] — nothing inserted,
 *      nothing reordered.
 *   2. Payment Put item: top-level invoiceId + studentAccountId + studentId
 *      POPULATED (single-target identity), gsi2 keys PRESENT
 *      (student-scoped GSI2), applications = [invoice entry] (+ opening
 *      entry only when the account carries an opening remainder).
 *   3. buildApplyPaymentTransactItem receives the invoice-allocated portion
 *      only; the composite ledger helper receives one input per application
 *      with the receipt-numbered description.
 *   4. PaymentCompleted event args unchanged.
 *   5. Idempotency-key short-circuit returns the existing row's DTO without
 *      any write.
 *
 * DO NOT weaken these assertions to accommodate multi-target changes —
 * multi-target behavior gets its own spec; this file IS the single-target
 * contract.
 */

import { Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type { BillingAccountEntity } from '../common/entities/billing-account.entity';
import type { PaymentEntity } from '../common/entities/payment.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';
const INVOICE_ID = 'invoice-uuid';
const ACCOUNT_ID = 'account-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

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

function makeAccount(overrides: Partial<BillingAccountEntity> = {}): BillingAccountEntity {
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
    ...overrides,
  } as BillingAccountEntity;
}

interface Mocks {
  dynamoDBClient: any;
  invoicesService: any;
  studentAccountsService: any;
  eventsService: any;
  sequenceService: any;
}

function buildService(): { service: PaymentsService; mocks: Mocks } {
  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn(),
    transactWrite: jest.fn().mockResolvedValue(undefined),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
  const invoicesService: any = {
    getEntity: jest.fn(),
    buildApplyPaymentTransactItem: jest.fn().mockImplementation((invoice: any, amount: number) => ({
      item: {
        Update: {
          TableName: 'edforge-finance-test',
          Key: { tenantId: invoice.tenantId, entityKey: invoice.entityKey },
          _tag: 'invoice_apply',
          _amount: amount,
        },
      },
      newStatus: amount >= invoice.amountDue ? 'paid' : 'partially_paid',
      newAmountPaid: invoice.amountPaid + amount,
      newAmountDue: Math.max(0, invoice.grandTotal - invoice.amountPaid - amount),
    })),
  };
  const studentAccountsService: any = {
    buildCompositeLedgerTransactItems: jest.fn().mockImplementation((acct: any, inputs: any[]) => {
      const ledgerPuts = inputs.map((i: any, idx: number) => ({
        Put: {
          TableName: 'edforge-finance-test',
          Item: { entityType: 'LEDGER_ENTRY', _idx: idx, _credit: i.credit, _description: i.description },
        },
      }));
      const accountUpdate: any = {
        Update: {
          TableName: 'edforge-finance-test',
          Key: { tenantId: acct.tenantId, entityKey: acct.entityKey },
          UpdateExpression:
            'SET balance = :b, totalPaid = :tp, updatedAt = :now, #v = #v + :one, lastPaymentDate = :payDate',
          ExpressionAttributeValues: {
            ':b': 0, ':tp': 0, ':now': 'now', ':one': 1, ':payDate': '2026-07-15', ':currentVersion': 1,
          },
          ExpressionAttributeNames: { '#v': 'version' },
          ConditionExpression: '#v = :currentVersion',
        },
      };
      return {
        items: [...ledgerPuts, accountUpdate],
        ledgerEntries: inputs.map((_: any, idx: number) => ({ entryId: `ledger-${idx}` })),
        summedDelta: 0,
      };
    }),
  };
  const eventsService: any = {
    publishPaymentCompleted: jest.fn().mockResolvedValue(undefined),
  };
  const sequenceService: any = {
    nextReceiptNumber: jest.fn().mockResolvedValue('RCP-2026-0042'),
  };
  const service = new PaymentsService(
    dynamoDBClient,
    eventsService,
    sequenceService,
    invoicesService,
    studentAccountsService,
    {} as any,
    {} as any,
    { getStudentInfo: jest.fn() } as any,
    { optimize: jest.fn(async (u: any) => u) } as any,
  );
  return { service, mocks: { dynamoDBClient, invoicesService, studentAccountsService, eventsService, sequenceService } };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('GOLDEN — single-target recordManualPayment transact composition (pre-FB-4.4 contract)', () => {
  it('full payment: item order is [payment Put, invoice apply, ledger Put, account Update]; entity carries single-target identity + GSI2 keys', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice());
    mocks.dynamoDBClient.getItem.mockResolvedValue(makeAccount());

    const dto: any = { invoiceId: INVOICE_ID, gateway: 'cash', amount: 2000 };
    const result = await service.recordManualPayment(SCHOOL_ID, dto, ctx);

    expect(mocks.dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
    const items = mocks.dynamoDBClient.transactWrite.mock.calls[0][1];

    // 1. Exact ordering, exactly 4 items for a no-opening account.
    expect(items).toHaveLength(4);
    expect(items[0].Put?.Item?.entityType).toBe('PAYMENT');
    expect(items[0].Put?.ConditionExpression).toBe('attribute_not_exists(entityKey)');
    expect(items[1].Update?._tag).toBe('invoice_apply');
    expect(items[1].Update?._amount).toBe(2000);
    expect(items[2].Put?.Item?.entityType).toBe('LEDGER_ENTRY');
    expect(items[3].Update?.ConditionExpression).toContain('#v = :currentVersion');

    // 2. Payment entity single-target identity.
    const payment = items[0].Put.Item as PaymentEntity;
    expect(payment.invoiceId).toBe(INVOICE_ID);
    expect(payment.studentAccountId).toBe(ACCOUNT_ID);
    expect(payment.studentId).toBe(STUDENT_ID);
    expect(payment.gsi2pk).toBe(`TENANT#${TENANT_ID}#STUDENT#${STUDENT_ID}`);
    expect(payment.gsi2sk).toMatch(/^PAYMENT#/);
    expect(payment.status).toBe('completed');
    expect(payment.receiptNumber).toBe('RCP-2026-0042');
    expect(payment.applications).toEqual([
      { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 },
    ]);
    expect((payment as any).familyId).toBeUndefined();

    // 3. Helper call contracts.
    expect(mocks.invoicesService.buildApplyPaymentTransactItem).toHaveBeenCalledWith(
      expect.objectContaining({ invoiceId: INVOICE_ID }),
      2000,
      ctx,
    );
    const compositeCall = mocks.studentAccountsService.buildCompositeLedgerTransactItems.mock.calls[0];
    expect(compositeCall[0]).toEqual(expect.objectContaining({ accountId: ACCOUNT_ID }));
    expect(compositeCall[1]).toEqual([
      expect.objectContaining({
        entryType: 'payment',
        referenceId: payment.paymentId,
        description: `Payment RCP-2026-0042 via cash → invoice INV-2026-0001`,
        debit: 0,
        credit: 2000,
      }),
    ]);

    // 4. Event args unchanged.
    expect(mocks.eventsService.publishPaymentCompleted).toHaveBeenCalledWith(
      TENANT_ID, SCHOOL_ID, payment.paymentId, INVOICE_ID, 2000, 'cash',
    );

    // 5. DTO reflects the single-target row.
    expect(result.invoiceId).toBe(INVOICE_ID);
    expect(result.studentAccountId).toBe(ACCOUNT_ID);
    expect(result.familyId).toBeUndefined();
  });

  it('split payment (invoice + opening remainder): 5 items — [payment, invoice apply, invoice ledger, opening ledger, account Update with settled increment]', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 1500, grandTotal: 1500, subtotal: 1500 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(
      makeAccount({ openingBalance: 1000, openingBalanceSettled: 0, openingBalanceAsOf: '2026-01-01' }),
    );

    const dto: any = { invoiceId: INVOICE_ID, gateway: 'cheque', amount: 2000, referenceNumber: 'CHQ-9' };
    await service.recordManualPayment(SCHOOL_ID, dto, ctx);

    const items = mocks.dynamoDBClient.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(5);
    const payment = items[0].Put.Item as PaymentEntity;
    expect(payment.applications).toEqual([
      { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 1500 },
      { targetType: 'opening_balance', amount: 500 },
    ]);
    expect(payment.gatewayTransactionId).toBe('CHQ-9');
    // invoice apply receives ONLY the invoice-allocated portion
    expect(items[1].Update?._amount).toBe(1500);
    // account Update (last) carries the openingBalanceSettled increment
    const acctUpdate = items[4].Update;
    expect(acctUpdate.UpdateExpression).toContain('openingBalanceSettled');
    expect(acctUpdate.ExpressionAttributeValues[':toOpening']).toBe(500);
  });

  it('idempotency-key hit short-circuits: returns existing row DTO, zero writes', async () => {
    const { service, mocks } = buildService();
    const existing: Partial<PaymentEntity> = {
      paymentId: 'existing-pay',
      invoiceId: INVOICE_ID,
      studentAccountId: ACCOUNT_ID,
      schoolId: SCHOOL_ID,
      studentId: STUDENT_ID,
      amount: 700,
      currency: 'NPR',
      gateway: 'cash',
      status: 'completed',
      paidAt: '2026-07-15T00:00:00Z',
      paidBy: 'user-1',
      receiptNumber: 'RCP-OLD',
      metadata: {},
      refunds: [],
      createdAt: '2026-07-15T00:00:00Z',
      updatedAt: '2026-07-15T00:00:00Z',
    };
    mocks.dynamoDBClient.queryGSI.mockResolvedValue({ items: [existing], hasMore: false });

    const dto: any = { invoiceId: INVOICE_ID, gateway: 'cash', amount: 700, idempotencyKey: '3f1d0a34-9f47-4a3b-8b3c-2f4f4d1c9e01' };
    const result = await service.recordManualPayment(SCHOOL_ID, dto, ctx);

    expect(result.id).toBe('existing-pay');
    expect(mocks.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
    expect(mocks.invoicesService.getEntity).not.toHaveBeenCalled();
  });
});
