/**
 * PaymentsService.voidPayment + refund — split-payment handling
 * Pilot Onboarding Hardening Sprint PD.2, Phase C adversarial-review fixes
 * (SPEC-1, SPEC-2, SPEC-3).
 *
 * Pre-fix bugs (all confirmed in the review):
 *   - voidPayment of a split payment reversed `existing.amount` on the
 *     invoice → over-credits the invoice by the opening-allocated portion
 *   - voidPayment did NOT decrement `openingBalanceSettled` →
 *     openingBalanceRemaining permanently drifts above reality
 *   - refund had the same over-reversal + missing decrement bugs
 *   - Partial refunds on split payments lacked the pro-rata math
 *     (V1 rejects with PAYMENT_REFUND_SPLIT_PARTIAL_UNSUPPORTED)
 *
 * This spec pins all four behaviors.
 */

import { Logger, BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { PaymentEntity } from '../common/entities/payment.entity';
import type { BillingAccountEntity } from '../common/entities/billing-account.entity';

const TENANT_ID = 'tenant-uuid';
const SCHOOL_ID = 'school-uuid';
const STUDENT_ID = 'student-uuid';
const INVOICE_ID = 'invoice-uuid';
const PAYMENT_ID = 'payment-uuid';
const ACCOUNT_ID = 'account-uuid';

const ctx = {
  tenantId: TENANT_ID,
  userId: 'user-1',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
  schoolId: SCHOOL_ID,
} as any;

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

function makePayment(overrides: Partial<PaymentEntity> = {}): PaymentEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `PAYMENT#${SCHOOL_ID}#${PAYMENT_ID}`,
    entityType: 'PAYMENT',
    paymentId: PAYMENT_ID,
    invoiceId: INVOICE_ID,
    studentAccountId: ACCOUNT_ID,
    schoolId: SCHOOL_ID,
    studentId: STUDENT_ID,
    amount: 3000,
    currency: 'NPR',
    gateway: 'cash',
    status: 'completed',
    paidAt: '2026-07-15T10:00:00Z',
    paidBy: 'operator-1',
    receiptNumber: 'RCP-2026-0001',
    metadata: {},
    refunds: [],
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '',
    createdAt: '2026-07-15T10:00:00Z',
    createdBy: 'operator-1',
    updatedAt: '2026-07-15T10:00:00Z',
    updatedBy: 'operator-1',
    version: 1,
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
    updateItem: jest.fn().mockResolvedValue({}),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
  };
  const invoicesService: any = {
    reversePaymentOnInvoice: jest.fn().mockResolvedValue({}),
  };
  const studentAccountsService: any = {
    recordLedgerEntry: jest.fn().mockResolvedValue({ entryId: 'led-uuid' }),
    decrementOpeningBalanceSettled: jest.fn().mockResolvedValue({}),
  };
  const service = new PaymentsService(
    dynamoDBClient,
    {
      publishPaymentCompleted: jest.fn().mockResolvedValue(undefined),
      publishRefundProcessed: jest.fn().mockResolvedValue(undefined),
    } as any,
    { nextReceiptNumber: jest.fn() } as any,
    invoicesService,
    studentAccountsService,
    {} as any,
    {} as any,
    {} as any,

    { optimize: jest.fn(async (u) => u) } as any, // pdfLogoOptimizer (Plan §5d)
  );
  return { service, mocks: { dynamoDBClient, invoicesService, studentAccountsService } };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('PaymentsService.voidPayment — Phase C SPEC-1 + SPEC-3 fixes', () => {
  it('legacy single-invoice payment (no applications) ⇒ reverse full amount on invoice; NO openingBalanceSettled decrement (back-compat)', async () => {
    const { service, mocks } = buildService();
    const payment = makePayment({ amount: 2000 }); // legacy, no applications
    const account = makeAccount();
    mocks.dynamoDBClient.getItem
      .mockResolvedValueOnce(payment)            // payment lookup
      .mockResolvedValueOnce(account);           // account lookup
    mocks.dynamoDBClient.updateItem.mockResolvedValue(payment);

    await service.voidPayment(SCHOOL_ID, PAYMENT_ID, 'operator error', ctx);

    // Invoice reversed by full amount (legacy behavior preserved)
    expect(mocks.invoicesService.reversePaymentOnInvoice).toHaveBeenCalledWith(
      SCHOOL_ID,
      INVOICE_ID,
      2000,
      ctx,
    );
    // openingBalanceSettled NOT touched on legacy
    expect(mocks.studentAccountsService.decrementOpeningBalanceSettled).not.toHaveBeenCalled();
    // Ledger debit records full amount
    expect(mocks.studentAccountsService.recordLedgerEntry).toHaveBeenCalledWith(
      account, 'adjustment', PAYMENT_ID, expect.any(String), 2000, 0, ctx,
    );
  });

  it('split payment (invoice + opening) ⇒ reverse INVOICE-portion only on invoice + decrement openingBalanceSettled by opening-portion', async () => {
    const { service, mocks } = buildService();
    const payment = makePayment({
      amount: 3000,
      applications: [
        { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 },
        { targetType: 'opening_balance', amount: 1000 },
      ],
    });
    const account = makeAccount({ openingBalance: 5000, openingBalanceSettled: 1000 });
    mocks.dynamoDBClient.getItem
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(account);
    mocks.dynamoDBClient.updateItem.mockResolvedValue(payment);

    await service.voidPayment(SCHOOL_ID, PAYMENT_ID, 'operator error', ctx);

    // Invoice reversed by INVOICE PORTION ONLY (not full payment.amount)
    expect(mocks.invoicesService.reversePaymentOnInvoice).toHaveBeenCalledWith(
      SCHOOL_ID,
      INVOICE_ID,
      2000, // <-- NOT 3000
      ctx,
    );
    // openingBalanceSettled decremented by opening portion
    expect(mocks.studentAccountsService.decrementOpeningBalanceSettled).toHaveBeenCalledWith(
      ACCOUNT_ID,
      1000,
      ctx,
    );
    // Ledger debit still records FULL amount (operator-facing void total)
    expect(mocks.studentAccountsService.recordLedgerEntry).toHaveBeenCalledWith(
      account, 'adjustment', PAYMENT_ID, expect.any(String), 3000, 0, ctx,
    );
  });

  it('pure-invoice split (applications=[invoice]) ⇒ reverse invoice portion; openingBalanceSettled NOT touched', async () => {
    const { service, mocks } = buildService();
    const payment = makePayment({
      amount: 2000,
      applications: [
        { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 },
      ],
    });
    const account = makeAccount();
    mocks.dynamoDBClient.getItem
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(account);
    mocks.dynamoDBClient.updateItem.mockResolvedValue(payment);

    await service.voidPayment(SCHOOL_ID, PAYMENT_ID, 'reason', ctx);

    expect(mocks.invoicesService.reversePaymentOnInvoice).toHaveBeenCalledWith(
      SCHOOL_ID, INVOICE_ID, 2000, ctx,
    );
    expect(mocks.studentAccountsService.decrementOpeningBalanceSettled).not.toHaveBeenCalled();
  });

  it('decrementOpeningBalanceSettled failure ⇒ logged at WARN; void itself succeeds (counter drift acceptable; operator recovers via setOpeningBalance revision)', async () => {
    const { service, mocks } = buildService();
    const payment = makePayment({
      amount: 3000,
      applications: [
        { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 },
        { targetType: 'opening_balance', amount: 1000 },
      ],
    });
    const account = makeAccount();
    mocks.dynamoDBClient.getItem
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(account);
    mocks.dynamoDBClient.updateItem.mockResolvedValue(payment);
    mocks.studentAccountsService.decrementOpeningBalanceSettled.mockRejectedValueOnce(
      new Error('counter underflow'),
    );

    // Void completes despite counter failure (logs WARN)
    const result = await service.voidPayment(SCHOOL_ID, PAYMENT_ID, 'reason', ctx);
    expect(result).toBeDefined();
  });
});

describe('PaymentsService.refund — Phase C SPEC-2 fix', () => {
  it('full refund of legacy single-invoice payment ⇒ reverses full amount on invoice; no counter touch (back-compat)', async () => {
    const { service, mocks } = buildService();
    const payment = makePayment({ amount: 2000 }); // legacy, no applications
    const account = makeAccount();
    mocks.dynamoDBClient.getItem
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(account);
    mocks.dynamoDBClient.updateItem.mockResolvedValue(payment);

    await service.refund(SCHOOL_ID, PAYMENT_ID, { amount: 2000, reason: 'wrong gateway' } as any, ctx);

    expect(mocks.invoicesService.reversePaymentOnInvoice).toHaveBeenCalledWith(
      SCHOOL_ID, INVOICE_ID, 2000, ctx,
    );
    expect(mocks.studentAccountsService.decrementOpeningBalanceSettled).not.toHaveBeenCalled();
  });

  it('full refund of split payment ⇒ reverses INVOICE-portion on invoice + decrements counter by opening-portion', async () => {
    const { service, mocks } = buildService();
    const payment = makePayment({
      amount: 3000,
      applications: [
        { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 },
        { targetType: 'opening_balance', amount: 1000 },
      ],
    });
    const account = makeAccount();
    mocks.dynamoDBClient.getItem
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(account);
    mocks.dynamoDBClient.updateItem.mockResolvedValue(payment);

    await service.refund(SCHOOL_ID, PAYMENT_ID, { amount: 3000, reason: 'duplicate' } as any, ctx);

    expect(mocks.invoicesService.reversePaymentOnInvoice).toHaveBeenCalledWith(
      SCHOOL_ID, INVOICE_ID, 2000, ctx,
    );
    expect(mocks.studentAccountsService.decrementOpeningBalanceSettled).toHaveBeenCalledWith(
      ACCOUNT_ID, 1000, ctx,
    );
  });

  it('partial refund of split payment ⇒ 400 PAYMENT_REFUND_SPLIT_PARTIAL_UNSUPPORTED; no writes', async () => {
    const { service, mocks } = buildService();
    const payment = makePayment({
      amount: 3000,
      applications: [
        { targetType: 'invoice', invoiceId: INVOICE_ID, amount: 2000 },
        { targetType: 'opening_balance', amount: 1000 },
      ],
    });
    mocks.dynamoDBClient.getItem.mockResolvedValueOnce(payment);

    try {
      await service.refund(SCHOOL_ID, PAYMENT_ID, { amount: 1500, reason: 'partial' } as any, ctx);
      fail('expected BadRequestException');
    } catch (err: any) {
      expect(err).toBeInstanceOf(BadRequestException);
      expect(err.response.code).toBe('PAYMENT_REFUND_SPLIT_PARTIAL_UNSUPPORTED');
      expect(err.response.params).toEqual(
        expect.objectContaining({
          paymentAmount: 3000,
          refundAmount: 1500,
        }),
      );
    }

    // No mutations on rejection
    expect(mocks.dynamoDBClient.updateItem).not.toHaveBeenCalled();
    expect(mocks.invoicesService.reversePaymentOnInvoice).not.toHaveBeenCalled();
    expect(mocks.studentAccountsService.decrementOpeningBalanceSettled).not.toHaveBeenCalled();
  });

  it('partial refund of LEGACY single-invoice payment ⇒ allowed (existing behavior unchanged; not a split)', async () => {
    const { service, mocks } = buildService();
    const payment = makePayment({ amount: 2000 }); // legacy, no applications
    const account = makeAccount();
    mocks.dynamoDBClient.getItem
      .mockResolvedValueOnce(payment)
      .mockResolvedValueOnce(account);
    mocks.dynamoDBClient.updateItem.mockResolvedValue(payment);

    await service.refund(SCHOOL_ID, PAYMENT_ID, { amount: 500, reason: 'partial' } as any, ctx);

    // Partial refund accepted (no SPLIT_PARTIAL rejection)
    expect(mocks.invoicesService.reversePaymentOnInvoice).toHaveBeenCalledWith(
      SCHOOL_ID, INVOICE_ID, 500, ctx,
    );
    expect(mocks.studentAccountsService.decrementOpeningBalanceSettled).not.toHaveBeenCalled();
  });
});
