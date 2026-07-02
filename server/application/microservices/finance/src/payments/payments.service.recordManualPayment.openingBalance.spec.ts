/**
 * PaymentsService.recordManualPayment — opening-balance settlement
 * Pilot Onboarding Hardening Sprint PD.2.3
 *
 * Pins:
 *   1. Payment ≤ invoice debt → 1 invoice application, no opening (existing behavior).
 *   2. Payment = invoice debt → 1 invoice application, no opening.
 *   3. Payment > invoice debt but < (invoice + opening) → 2 applications;
 *      invoice gets settled to zero, remaining lands on opening_balance.
 *   4. Payment = invoice + opening → 2 applications; opening fully settled.
 *   5. Payment > invoice + opening → 400 PAYMENT_EXCEEDS_ALLOCATABLE;
 *      ZERO DDB writes (assert transactWrite NOT called).
 *   6. Account WITHOUT openingBalance set → behaves exactly like pre-PD
 *      (single invoice application; no opening logic invoked).
 *   7. Ledger ordering: invoice ledger entry precedes opening ledger
 *      entry in the composite array.
 *   8. openingBalanceSettled increment is folded into the account
 *      Update (SET fragment + protective ConditionExpression).
 *   9. TransactionCanceledException with the new "over-settle" reason
 *      surfaces as 409 CONCURRENT_UPDATE with descriptive labels.
 */

import { Logger, BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type { BillingAccountEntity } from '../common/entities/billing-account.entity';

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
  };
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
  };
}

interface Mocks {
  dynamoDBClient: any;
  invoicesService: any;
  studentAccountsService: any;
}

function buildService(): { service: PaymentsService; mocks: Mocks } {
  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    getItem: jest.fn(),
    transactWrite: jest.fn().mockResolvedValue(undefined),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
  };
  const invoicesService: any = {
    getEntity: jest.fn(),
    buildApplyPaymentTransactItem: jest.fn().mockImplementation((_invoice: any, amount: number) => ({
      item: { Update: { TableName: 'edforge-finance-test', Key: {}, _amount: amount } },
    })),
  };
  const studentAccountsService: any = {
    buildLedgerEntryTransactItems: jest.fn(),
    // PD.2.3 — return a real-looking composite shape so the service can
    // mutate the last Update's UpdateExpression in-place for the
    // openingBalanceSettled increment.
    buildCompositeLedgerTransactItems: jest.fn().mockImplementation((_acct: any, inputs: any[]) => {
      const ledgerPuts = inputs.map((i: any, idx: number) => ({
        Put: { TableName: 'edforge-finance-test', Item: { entryType: 'LEDGER_ENTRY', _idx: idx, _targetCredit: i.credit } },
      }));
      const accountUpdate: any = {
        Update: {
          TableName: 'edforge-finance-test',
          Key: {},
          UpdateExpression:
            'SET balance = :b, totalPaid = :tp, updatedAt = :now, #v = #v + :one, lastPaymentDate = :payDate',
          ExpressionAttributeValues: {
            ':b': 0,
            ':tp': 0,
            ':now': 'now',
            ':one': 1,
            ':payDate': '2026-07-15',
            ':currentVersion': 1,
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
  const service = new PaymentsService(
    dynamoDBClient,
    {
      publishPaymentRecorded: jest.fn().mockResolvedValue(undefined),
      publishPaymentCompleted: jest.fn().mockResolvedValue(undefined),
    } as any,
    { nextReceiptNumber: jest.fn().mockResolvedValue('RCP-2026-0001') } as any,
    invoicesService,
    studentAccountsService,
    {} as any,
    {} as any,
    { getStudentInfo: jest.fn(), resolveRecordedBy: jest.fn() } as any,
  
    { optimize: jest.fn(async (u) => u) } as any, // pdfLogoOptimizer (Plan §5d)
  );
  return { service, mocks: { dynamoDBClient, invoicesService, studentAccountsService } };
}

function getPaymentFromTransactWrite(mocks: Mocks): any {
  const items = mocks.dynamoDBClient.transactWrite.mock.calls[0][1];
  const paymentPut = items.find((it: any) => it.Put?.Item?.entityType === 'PAYMENT');
  return paymentPut.Put.Item;
}

function getAccountUpdate(mocks: Mocks): any {
  // The account Update is the LAST item from the composite helper's output,
  // appended to the transactWrite items by the service after the payment
  // Put + invoice apply.
  const items = mocks.dynamoDBClient.transactWrite.mock.calls[0][1];
  // Order in tx: [payment Put, invoice apply, ...composite (ledger Puts + account Update)]
  return items[items.length - 1].Update;
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PaymentsService.recordManualPayment — PD.2.3 opening-balance allocation', () => {
  it('case 1: payment < invoice debt ⇒ 1 invoice application, no opening (existing behavior)', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(makeAccount({ openingBalance: 5000 }));

    await service.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 1500, gateway: 'cash' } as any,
      ctx,
    );

    const payment = getPaymentFromTransactWrite(mocks);
    expect(payment.applications).toEqual([
      { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 1500 },
    ]);
    expect(payment.amount).toBe(1500);
    expect(payment.invoiceId).toBe(INVOICE_ID);

    // No opening settlement: openingBalanceSettled NOT in the Update
    const upd = getAccountUpdate(mocks);
    expect(upd.UpdateExpression).not.toMatch(/openingBalanceSettled/);
  });

  it('case 2: payment = invoice debt ⇒ 1 invoice application, no opening', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(makeAccount({ openingBalance: 5000 }));

    await service.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 2000, gateway: 'cash' } as any,
      ctx,
    );

    const payment = getPaymentFromTransactWrite(mocks);
    expect(payment.applications).toHaveLength(1);
    expect(payment.applications[0]).toEqual({ targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 });
  });

  it('case 3: payment > invoice debt but < (invoice + opening) ⇒ 2 applications; invoice fully settled, remainder on opening', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(makeAccount({ openingBalance: 5000 }));

    await service.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 3000, gateway: 'cash' } as any,
      ctx,
    );

    const payment = getPaymentFromTransactWrite(mocks);
    expect(payment.applications).toHaveLength(2);
    expect(payment.applications[0]).toEqual({ targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 });
    expect(payment.applications[1]).toEqual({ targetType: 'opening_balance', amount: 1000 });

    // Account Update carries the openingBalanceSettled increment
    const upd = getAccountUpdate(mocks);
    expect(upd.UpdateExpression).toMatch(
      /openingBalanceSettled = if_not_exists\(openingBalanceSettled, :zero\) \+ :toOpening/,
    );
    expect(upd.ExpressionAttributeValues[':toOpening']).toBe(1000);
    expect(upd.ExpressionAttributeValues[':zero']).toBe(0);

    // Phase C CONC-3 fix — ConditionExpression references the LIVE
    // openingBalance attribute (not a stale snapshot) in both the
    // openingBalance-equality check AND the over-settle ceiling.
    // `:snapshotOpeningBalance` is the value AT GET time (used for
    // the equality check); the over-settle ceiling references the
    // live `openingBalance` attribute (no `:` prefix).
    expect(upd.ConditionExpression).toMatch(
      /openingBalance = :snapshotOpeningBalance/,
    );
    expect(upd.ConditionExpression).toMatch(
      /if_not_exists\(openingBalanceSettled, :zero\) \+ :toOpening <= openingBalance/,
    );
    expect(upd.ExpressionAttributeValues[':snapshotOpeningBalance']).toBe(5000);

    // buildApplyPaymentTransactItem received the INVOICE-allocated amount,
    // not the full payment amount
    expect(mocks.invoicesService.buildApplyPaymentTransactItem).toHaveBeenCalledWith(
      expect.anything(),
      2000, // toInvoice
      expect.any(Object),
    );
  });

  it('case 4: payment = invoice + opening ⇒ 2 applications; opening fully settled', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(makeAccount({ openingBalance: 5000 }));

    await service.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 7000, gateway: 'cash' } as any,
      ctx,
    );

    const payment = getPaymentFromTransactWrite(mocks);
    expect(payment.applications).toEqual([
      { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 },
      { targetType: 'opening_balance', amount: 5000 },
    ]);
    const upd = getAccountUpdate(mocks);
    expect(upd.ExpressionAttributeValues[':toOpening']).toBe(5000);
  });

  it('case 5: payment > invoice + opening ⇒ 400 PAYMENT_EXCEEDS_ALLOCATABLE; ZERO DDB writes', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(makeAccount({ openingBalance: 5000 }));

    try {
      await service.recordManualPayment(
        SCHOOL_ID,
        { invoiceId: INVOICE_ID, amount: 10000, gateway: 'cash' } as any,
        ctx,
      );
      fail('expected PAYMENT_EXCEEDS_ALLOCATABLE');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.response.code).toBe('PAYMENT_EXCEEDS_ALLOCATABLE');
      expect(err.response.params).toEqual(
        expect.objectContaining({
          amount: 10000,
          invoiceDue: 2000,
          openingRemaining: 5000,
          allocatable: 7000,
        }),
      );
    }

    expect(mocks.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
  });

  it('case 6: account WITHOUT openingBalance ⇒ pre-PD behavior; openingBalanceSettled NOT in Update', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(makeAccount({})); // no openingBalance

    await service.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 2000, gateway: 'cash' } as any,
      ctx,
    );

    const payment = getPaymentFromTransactWrite(mocks);
    expect(payment.applications).toHaveLength(1);
    const upd = getAccountUpdate(mocks);
    expect(upd.UpdateExpression).not.toMatch(/openingBalanceSettled/);
  });

  it('case 7: ledger ordering — invoice ledger Put precedes opening ledger Put in composite call', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(makeAccount({ openingBalance: 5000 }));

    await service.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 3000, gateway: 'cash' } as any,
      ctx,
    );

    // Inspect the inputs the service handed to the composite helper
    const compositeCalls = mocks.studentAccountsService.buildCompositeLedgerTransactItems.mock.calls;
    expect(compositeCalls.length).toBe(1);
    const inputs = compositeCalls[0][1];
    expect(inputs).toHaveLength(2);
    // Invoice FIRST
    expect(inputs[0].description).toMatch(/invoice INV-2026-0001/);
    expect(inputs[0].credit).toBe(2000);
    // Opening LAST
    expect(inputs[1].description).toMatch(/opening balance/);
    expect(inputs[1].credit).toBe(1000);
  });

  it('case 8: openingBalanceSettled increment uses if_not_exists for sparse counter (PD account at first settlement)', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    // openingBalance set but openingBalanceSettled never written yet
    mocks.dynamoDBClient.getItem.mockResolvedValue(
      makeAccount({ openingBalance: 5000 /* no openingBalanceSettled */ }),
    );

    await service.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 3000, gateway: 'cash' } as any,
      ctx,
    );

    const upd = getAccountUpdate(mocks);
    // `if_not_exists` covers the sparse case so the first settlement
    // initializes the counter from 0 instead of throwing on missing.
    expect(upd.UpdateExpression).toMatch(/if_not_exists\(openingBalanceSettled, :zero\)/);
    expect(upd.ConditionExpression).toMatch(/if_not_exists\(openingBalanceSettled, :zero\)/);
  });

  it('case 9: TransactionCanceledException ⇒ 409 CONCURRENT_UPDATE with dynamic per-application labels', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(makeAccount({ openingBalance: 5000 }));

    const txError = new Error('cancelled');
    (txError as any).name = 'TransactionCanceledException';
    (txError as any).CancellationReasons = [
      { Code: 'None' },
      { Code: 'None' },
      { Code: 'None' },
      { Code: 'None' },
      { Code: 'ConditionalCheckFailed' }, // account Update lost the race
    ];
    mocks.dynamoDBClient.transactWrite.mockRejectedValueOnce(txError);

    try {
      await service.recordManualPayment(
        SCHOOL_ID,
        { invoiceId: INVOICE_ID, amount: 3000, gateway: 'cash' } as any,
        ctx,
      );
      fail('expected ConflictException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(ConflictException);
      expect(err.response.code).toBe('CONCURRENT_UPDATE');
      expect(err.response.message).toMatch(/ledger_put_0_invoice/);
      expect(err.response.message).toMatch(/ledger_put_1_opening_balance/);
      expect(err.response.message).toMatch(/account_update=ConditionalCheckFailed/);
    }
  });

  // Phase C CONC-7 fix — payment paidDate must not predate the
  // account's opening-balance effective date (chronology guard).
  it('CONC-7: paidDate < openingBalanceAsOf ⇒ 400 PAYMENT_PAID_DATE_BEFORE_OPENING_AS_OF; no writes', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(
      makeAccount({
        openingBalance: 5000,
        openingBalanceAsOf: '2026-04-12',
      }),
    );

    try {
      await service.recordManualPayment(
        SCHOOL_ID,
        {
          invoiceId: INVOICE_ID,
          amount: 2000,
          gateway: 'cash',
          paidDate: '2026-04-01', // BEFORE openingBalanceAsOf
        } as any,
        ctx,
      );
      fail('expected PAYMENT_PAID_DATE_BEFORE_OPENING_AS_OF');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.response.code).toBe('PAYMENT_PAID_DATE_BEFORE_OPENING_AS_OF');
      expect(err.response.params).toEqual({
        paidDate: '2026-04-01',
        openingBalanceAsOf: '2026-04-12',
      });
    }
    expect(mocks.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
  });

  it('CONC-7 boundary: paidDate === openingBalanceAsOf ⇒ allowed (same-day permitted)', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(
      makeAccount({
        openingBalance: 5000,
        openingBalanceAsOf: '2026-04-12',
      }),
    );

    await service.recordManualPayment(
      SCHOOL_ID,
      {
        invoiceId: INVOICE_ID,
        amount: 2000,
        gateway: 'cash',
        paidDate: '2026-04-12', // EXACTLY openingBalanceAsOf
      } as any,
      ctx,
    );
    expect(mocks.dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
  });

  it('CONC-7 sparse: account WITHOUT openingBalanceAsOf ⇒ no chronology check (pre-PD accounts)', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(makeAccount({})); // no opening fields

    await service.recordManualPayment(
      SCHOOL_ID,
      {
        invoiceId: INVOICE_ID,
        amount: 2000,
        gateway: 'cash',
        paidDate: '2020-01-01', // arbitrarily old; no chronology check fires
      } as any,
      ctx,
    );
    expect(mocks.dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
  });

  it('case 10: account row missing ⇒ NotFoundException ACCOUNT_NOT_FOUND; no transactWrite', async () => {
    const { service, mocks } = buildService();
    mocks.invoicesService.getEntity.mockResolvedValue(makeInvoice({ amountDue: 2000 }));
    mocks.dynamoDBClient.getItem.mockResolvedValue(undefined);

    try {
      await service.recordManualPayment(
        SCHOOL_ID,
        { invoiceId: INVOICE_ID, amount: 2000, gateway: 'cash' } as any,
        ctx,
      );
      fail('expected NotFoundException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(NotFoundException);
      expect(err.response.code).toBe('ACCOUNT_NOT_FOUND');
    }
    expect(mocks.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
  });
});
