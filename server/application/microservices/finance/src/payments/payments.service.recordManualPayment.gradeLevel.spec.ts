/**
 * PaymentsService.recordManualPayment — gradeLevel denormalization (Sprint A.2)
 *
 * Pins the snapshot-from-parent-invoice behavior:
 *
 *   1. Parent invoice has `gradeLevel='4', status='resolved'`
 *      → payment row carries `gradeLevel='4', status='resolved'`
 *   2. Parent invoice has unresolved gradeLevel (undefined + 'unresolved')
 *      → payment row carries undefined + 'unresolved' (NOT 'UNKNOWN'
 *      sentinel, NOT empty string — stays sparse on the future GSI14)
 *   3. Pre-A.1 invoice with neither field present → payment carries
 *      neither field present (graceful degrade — backfill in A.5 fills
 *      both invoice + payment snapshots in lockstep)
 *
 * The snapshot is sealed on the payment's PutItem within the
 * TransactWriteItems block — later updates (void, refund, complete)
 * MUST NOT mutate it.
 */

import { Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type { PaymentEntity } from '../common/entities/payment.entity';
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
  };
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
    currentBalance: 0,
    totalInvoiced: 1000,
    totalPaid: 0,
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '',
    createdAt: '', createdBy: '', updatedAt: '', updatedBy: '', version: 1,
  } as any;
}

describe('PaymentsService.recordManualPayment — gradeLevel snapshot (Sprint A.2)', () => {
  let service: PaymentsService;
  let dynamoDBClient: any;
  let invoicesService: any;

  beforeEach(() => {
    // The atomic recordManualPayment block uses transactWrite (singular,
    // not transactWriteItems) on dynamoDBClient. Mock that + the
    // ledger/apply-payment builders on the right services.
    dynamoDBClient = {
      getClient: jest.fn().mockResolvedValue({}),
      getItem: jest.fn(),
      transactWrite: jest.fn().mockResolvedValue(undefined),
      getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    };
    invoicesService = {
      getEntity: jest.fn(),
      // applyItem.item is a TransactWriteItem (Put | Update | Delete)
      buildApplyPaymentTransactItem: jest.fn().mockReturnValue({
        item: { Update: { TableName: 'edforge-finance-test', Key: {} } },
      }),
    };
    const studentAccountsService = {
      // Service returns { items: [TransactWriteItem, ...], ledgerEntry: {...} }
      buildLedgerEntryTransactItems: jest.fn().mockReturnValue({
        items: [],
        ledgerEntry: { entryId: 'ledger-uuid' },
      }),
    };

    service = new PaymentsService(
      dynamoDBClient,
      {
        // Each event publisher returns a Promise; the service .catch()es
        // it for fire-and-forget. Mock as resolved.
        publishPaymentRecorded: jest.fn().mockResolvedValue(undefined),
        publishPaymentCompleted: jest.fn().mockResolvedValue(undefined),
      } as any,
      { nextReceiptNumber: jest.fn().mockResolvedValue('RCP-2026-0001') } as any,
      invoicesService,
      studentAccountsService as any,
      {} as any, // gatewayRegistry
      {} as any, // gatewayConfigService
      { getStudentInfo: jest.fn(), resolveRecordedBy: jest.fn() } as any, // identityClient
    );

    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => {});
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /**
   * recordManualPayment uses TransactWriteItems internally; the
   * payment row goes in as one of the Put operations. Pull the
   * payment item out of the transactWriteItems args for assertion.
   */
  function paymentPutFromTransactWrite(): PaymentEntity {
    const calls = dynamoDBClient.transactWrite.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    // signature: transactWrite(client, [TransactWriteItem, ...])
    const transactItems = calls[0][1] as any[];
    const paymentPut = transactItems.find(
      (item: any) => item.Put?.Item?.entityType === 'PAYMENT',
    );
    expect(paymentPut).toBeDefined();
    return paymentPut.Put.Item as PaymentEntity;
  }

  it('parent invoice gradeLevel="4" resolved → payment carries gradeLevel="4" resolved (snapshot copy)', async () => {
    invoicesService.getEntity.mockResolvedValue(
      makeInvoice({ gradeLevel: '4', gradeLevelResolutionStatus: 'resolved' }),
    );
    dynamoDBClient.getItem.mockResolvedValue(makeAccount());

    await service.recordManualPayment(
      SCHOOL_ID,
      {
        invoiceId: INVOICE_ID,
        amount: 1000,
        gateway: 'cash',
      } as any,
      ctx,
    );

    const payment = paymentPutFromTransactWrite();
    expect(payment.gradeLevel).toBe('4');
    expect(payment.gradeLevelResolutionStatus).toBe('resolved');
  });

  it('parent invoice unresolved (gradeLevel undefined, status=unresolved) → payment carries undefined + unresolved (NO sentinel, NO empty string)', async () => {
    invoicesService.getEntity.mockResolvedValue(
      makeInvoice({ gradeLevel: undefined, gradeLevelResolutionStatus: 'unresolved' }),
    );
    dynamoDBClient.getItem.mockResolvedValue(makeAccount());

    await service.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 1000, gateway: 'cash' } as any,
      ctx,
    );

    const payment = paymentPutFromTransactWrite();
    expect(payment.gradeLevel).toBeUndefined();
    expect(payment.gradeLevelResolutionStatus).toBe('unresolved');
  });

  it('pre-A.1 parent invoice (NEITHER field present) → payment carries NEITHER field (graceful degrade for backfill)', async () => {
    // Simulates an invoice row written before Sprint A.1 landed:
    // both fields absent. The payment must NOT fabricate a value —
    // it stays sparse so the A.5 backfill can fill both invoice +
    // payment in lockstep.
    const preA1Invoice = makeInvoice();
    delete (preA1Invoice as any).gradeLevel;
    delete (preA1Invoice as any).gradeLevelResolutionStatus;
    invoicesService.getEntity.mockResolvedValue(preA1Invoice);
    dynamoDBClient.getItem.mockResolvedValue(makeAccount());

    await service.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 1000, gateway: 'cash' } as any,
      ctx,
    );

    const payment = paymentPutFromTransactWrite();
    expect(payment.gradeLevel).toBeUndefined();
    expect(payment.gradeLevelResolutionStatus).toBeUndefined();
  });

  it('snapshot is sealed on the payment Put inside the transactWrite block — single payment write per call', async () => {
    invoicesService.getEntity.mockResolvedValue(
      makeInvoice({ gradeLevel: '5', gradeLevelResolutionStatus: 'resolved' }),
    );
    dynamoDBClient.getItem.mockResolvedValue(makeAccount());

    await service.recordManualPayment(
      SCHOOL_ID,
      { invoiceId: INVOICE_ID, amount: 1000, gateway: 'cash' } as any,
      ctx,
    );

    // Exactly one transactWrite call with exactly one payment Put.
    // Subsequent paths (completePayment, void, refund) MUST NOT touch
    // gradeLevel — snapshot semantics depend on this.
    expect(dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
    const transactItems = dynamoDBClient.transactWrite.mock.calls[0][1] as any[];
    const paymentPuts = transactItems.filter(
      (item: any) => item.Put?.Item?.entityType === 'PAYMENT',
    );
    expect(paymentPuts).toHaveLength(1);
    expect(paymentPuts[0].Put.Item.gradeLevel).toBe('5');
  });
});
