/**
 * EPIC LILI-BUG #502 A1 + A4 — cancel/write-off must retire the receivable.
 *
 * A1: `update()` was the only path for issued/partially_paid/overdue →
 * cancelled|written_off and it wrote nothing to the ledger or the billing
 * account, so a cancelled invoice's debit stayed on the books. The pilot's
 * production data carried NPR 9,397 of receivables the school had already
 * cancelled.
 *
 * A4: the same path (and the bulk draft-cleanup path) left `amountDue`
 * untouched, so every surface that sums `amountDue` — the Finance KPI tiles
 * included — kept reporting cancelled money as outstanding.
 *
 * Method note from the issue: `balance == Σ debits − Σ credits` held at ZERO
 * violations while the bug was live, because cancel touched neither side. An
 * internal-consistency assertion cannot catch A1. These tests assert the
 * REVERSAL happened — a reversing ledger entry exists, `amountDue = 0`, and
 * the account balance dropped by the cancelled amount.
 *
 * Route (ii) conformance: the reversal calls the UNCHANGED
 * `buildLedgerEntryTransactItems` with `debit = -outstanding, credit = 0`.
 * The real builder is used here (not a double) so a future drift in its
 * credit handling fails these tests: `credit = outstanding` would inflate
 * `totalPaid` and stamp `lastPaymentDate` for money that never moved.
 */

import { InvoicesService } from './invoices.service';
import { StudentAccountsService } from '../student-accounts/student-accounts.service';
import type { InvoiceEntity } from '../common/entities/invoice.entity';
import type { BillingAccountEntity } from '../common/entities/billing-account.entity';

const TENANT = 'tenant-1';
const SCHOOL = 'school-1';
const STUDENT = 'stu-1';
const INVOICE_ID = 'inv-1';
const INVOICE_KEY = `INVOICE#${SCHOOL}#${INVOICE_ID}`;
const ACCOUNT_KEY = `BILLING_ACCOUNT#${SCHOOL}#${STUDENT}`;
const TABLE = 'edforge-finance-basic';

const ctx = {
  tenantId: TENANT,
  userId: 'operator-9',
  jwtToken: 'jwt',
  role: 'TenantAdmin',
} as any;

function makeInvoice(overrides: Partial<InvoiceEntity> = {}): InvoiceEntity {
  return {
    tenantId: TENANT,
    entityKey: INVOICE_KEY,
    entityType: 'INVOICE',
    invoiceId: INVOICE_ID,
    invoiceNumber: 'INV-001-2606-0001',
    studentAccountId: 'acct-1',
    studentId: STUDENT,
    studentName: 'Test Student',
    schoolId: SCHOOL,
    schoolName: 'Test School',
    academicYear: '2025-2026',
    lineItems: [],
    subtotal: 8800,
    taxTotal: 0,
    discountTotal: 0,
    grandTotal: 8800,
    amountPaid: 0,
    amountDue: 8800,
    currency: 'NPR',
    dueDate: '2026-06-01',
    issuedDate: '2026-05-01',
    status: 'issued',
    gsi1pk: `TENANT#${TENANT}#SCHOOL#${SCHOOL}`,
    gsi1sk: 'INVOICE#issued#2026-06-01',
    gsi2pk: '', gsi2sk: '', gsi3pk: '', gsi3sk: '',
    createdAt: '2026-05-01T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-05-01T00:00:00Z',
    updatedBy: 'admin',
    version: 3,
    ...overrides,
  } as InvoiceEntity;
}

function makeAccount(overrides: Partial<BillingAccountEntity> = {}): BillingAccountEntity {
  return {
    tenantId: TENANT,
    entityKey: ACCOUNT_KEY,
    entityType: 'BILLING_ACCOUNT',
    accountId: 'acct-1',
    studentId: STUDENT,
    studentName: 'Test Student',
    schoolId: SCHOOL,
    balance: 8800,
    totalPaid: 0,
    lastPaymentDate: null,
    gsi1pk: '', gsi1sk: '', gsi2pk: '', gsi2sk: '',
    createdAt: '2026-05-01T00:00:00Z',
    createdBy: 'admin',
    updatedAt: '2026-05-01T00:00:00Z',
    updatedBy: 'admin',
    version: 7,
    ...overrides,
  } as BillingAccountEntity;
}

function makeService(invoice: InvoiceEntity, account: BillingAccountEntity | null) {
  const store = new Map<string, unknown>([[INVOICE_KEY, invoice]]);
  if (account) store.set(ACCOUNT_KEY, account);

  const dynamoDBClient = {
    getClient: jest.fn().mockResolvedValue({}),
    getTableName: jest.fn().mockReturnValue(TABLE),
    getItem: jest.fn(async (_c: unknown, _t: string, key: string) => store.get(key) ?? null),
    updateItem: jest.fn().mockImplementation(async () => ({ ...invoice, status: 'cancelled', amountDue: 0 })),
    transactWrite: jest.fn().mockResolvedValue(undefined),
    queryGSI: jest.fn().mockResolvedValue({ items: [], hasMore: false }),
  };
  const eventsService = {
    publishInvoiceStatusChanged: jest.fn().mockResolvedValue(undefined),
  };
  // The REAL builder — buildLedgerEntryTransactItems only needs getTableName.
  const studentAccounts = new StudentAccountsService(
    dynamoDBClient as any,
    {} as any,
    {} as any,
  );
  const service = new InvoicesService(
    dynamoDBClient as any,
    eventsService as any,
    { getSchoolName: jest.fn().mockResolvedValue(null) } as any,
    {} as any,
    {} as any,
    {} as any,
    studentAccounts,
    {} as any,
  );
  return { service, dynamoDBClient, eventsService, store };
}

/** The items of the most recent transactWrite. */
function transactItems(dynamoDBClient: { transactWrite: jest.Mock }): any[] {
  return dynamoDBClient.transactWrite.mock.calls.at(-1)![1] as any[];
}

describe('InvoicesService.update — #502 A1 cancel/write-off ledger reversal', () => {
  it('issued → cancelled posts a reversing ledger entry and drops the account balance to zero', async () => {
    const { service, dynamoDBClient } = makeService(makeInvoice(), makeAccount());

    await service.update(SCHOOL, INVOICE_ID, { status: 'cancelled' } as any, ctx);

    const items = transactItems(dynamoDBClient);
    expect(items).toHaveLength(3); // invoice Update + ledger Put + account Update

    const ledger = items[1].Put.Item;
    expect(ledger.entityType).toBe('LEDGER_ENTRY');
    expect(ledger.entryType).toBe('adjustment');
    expect(ledger.referenceId).toBe(INVOICE_ID);
    expect(ledger.description).toContain('INV-001-2606-0001');
    // Route (ii): the reversal is a NEGATIVE debit, never a credit.
    expect(ledger.debit).toBe(-8800);
    expect(ledger.credit).toBe(0);
    expect(ledger.balance).toBe(0);

    const accountUpdate = items[2].Update;
    expect(accountUpdate.Key).toEqual({ tenantId: TENANT, entityKey: ACCOUNT_KEY });
    expect(accountUpdate.ExpressionAttributeValues[':newBalance']).toBe(0);
  });

  it('the reversal leaves totalPaid alone and never stamps lastPaymentDate (no money moved)', async () => {
    const { service, dynamoDBClient } = makeService(
      makeInvoice({ status: 'partially_paid', amountPaid: 3000, amountDue: 5800 }),
      makeAccount({ balance: 5800, totalPaid: 3000 }),
    );

    await service.update(SCHOOL, INVOICE_ID, { status: 'cancelled' } as any, ctx);

    const accountUpdate = transactItems(dynamoDBClient)[2].Update;
    expect(accountUpdate.ExpressionAttributeValues[':newTotalPaid']).toBe(3000);
    expect(accountUpdate.UpdateExpression).not.toContain('lastPaymentDate');
    expect(accountUpdate.ExpressionAttributeValues[':payDate']).toBeUndefined();
  });

  it('reverses the OUTSTANDING amountDue, not the invoice grandTotal', async () => {
    const { service, dynamoDBClient } = makeService(
      makeInvoice({ status: 'partially_paid', amountPaid: 3000, amountDue: 5800 }),
      makeAccount({ balance: 5800, totalPaid: 3000 }),
    );

    await service.update(SCHOOL, INVOICE_ID, { status: 'cancelled' } as any, ctx);

    const ledger = transactItems(dynamoDBClient)[1].Put.Item;
    expect(ledger.debit).toBe(-5800);
    expect(ledger.balance).toBe(0);
  });

  it('overdue → written_off reverses under the write_off entry type', async () => {
    const { service, dynamoDBClient } = makeService(
      makeInvoice({ status: 'overdue' }),
      makeAccount(),
    );

    await service.update(SCHOOL, INVOICE_ID, { status: 'written_off' } as any, ctx);

    const ledger = transactItems(dynamoDBClient)[1].Put.Item;
    expect(ledger.entryType).toBe('write_off');
    expect(ledger.debit).toBe(-8800);
    expect(ledger.description).toContain('written off');
  });

  it('the reversal rides the SAME transactWrite as the status flip (no second write)', async () => {
    const { service, dynamoDBClient } = makeService(makeInvoice(), makeAccount());

    await service.update(SCHOOL, INVOICE_ID, { status: 'cancelled' } as any, ctx);

    expect(dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
    expect(dynamoDBClient.updateItem).not.toHaveBeenCalled();
    const invoiceUpdate = transactItems(dynamoDBClient)[0].Update;
    expect(invoiceUpdate.Key).toEqual({ tenantId: TENANT, entityKey: INVOICE_KEY });
    expect(invoiceUpdate.ConditionExpression).toBe('#v = :currentVersion');
    expect(invoiceUpdate.ExpressionAttributeValues[':currentVersion']).toBe(3);
  });

  it('agreement invoice: the lock Delete AND the reversal ride one transactWrite', async () => {
    const { service, dynamoDBClient } = makeService(
      makeInvoice({ agreementChainId: 'agr-1' } as Partial<InvoiceEntity>),
      makeAccount(),
    );

    await service.update(SCHOOL, INVOICE_ID, { status: 'cancelled' } as any, ctx);

    const items = transactItems(dynamoDBClient);
    expect(items).toHaveLength(4);
    expect(items[1].Delete.Key.entityKey).toBe(
      `AGREEMENT_TERM_LOCK#${SCHOOL}#${STUDENT}#agr-1`,
    );
    expect(items[2].Put.Item.entityType).toBe('LEDGER_ENTRY');
    expect(items[2].Put.Item.debit).toBe(-8800);
  });

  it('draft → cancelled posts NO reversal (issue() never debited the ledger)', async () => {
    const { service, dynamoDBClient } = makeService(
      makeInvoice({ status: 'draft', gsi1sk: 'INVOICE#draft#2026-06-01' }),
      makeAccount(),
    );

    await service.update(SCHOOL, INVOICE_ID, { status: 'cancelled' } as any, ctx);

    expect(dynamoDBClient.transactWrite).not.toHaveBeenCalled();
    expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
  });

  it('no billing account on file → the status flip still commits, unreversed', async () => {
    const { service, dynamoDBClient } = makeService(makeInvoice(), null);

    await service.update(SCHOOL, INVOICE_ID, { status: 'cancelled' } as any, ctx);

    expect(dynamoDBClient.transactWrite).not.toHaveBeenCalled();
    expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
  });

  it('nothing outstanding → no zero-value ledger noise', async () => {
    const { service, dynamoDBClient } = makeService(
      makeInvoice({ amountPaid: 8800, amountDue: 0 }),
      makeAccount({ balance: 0, totalPaid: 8800 }),
    );

    await service.update(SCHOOL, INVOICE_ID, { status: 'cancelled' } as any, ctx);

    expect(dynamoDBClient.transactWrite).not.toHaveBeenCalled();
    expect(dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
  });

  it('a non-status update (notes only) touches neither the ledger nor amountDue', async () => {
    const { service, dynamoDBClient } = makeService(makeInvoice(), makeAccount());

    await service.update(SCHOOL, INVOICE_ID, { notes: 'cheque pending' } as any, ctx);

    expect(dynamoDBClient.transactWrite).not.toHaveBeenCalled();
    const updateExpr = dynamoDBClient.updateItem.mock.calls[0][3] as string;
    expect(updateExpr).not.toContain('amountDue');
  });
});

describe('InvoicesService — #502 A4 amountDue is zeroed on every cancel path', () => {
  it('update() zeroes amountDue on issued → cancelled', async () => {
    const { service, dynamoDBClient } = makeService(makeInvoice(), makeAccount());

    await service.update(SCHOOL, INVOICE_ID, { status: 'cancelled' } as any, ctx);

    const invoiceUpdate = transactItems(dynamoDBClient)[0].Update;
    expect(invoiceUpdate.UpdateExpression).toContain('amountDue = :zero');
    expect(invoiceUpdate.ExpressionAttributeValues[':zero']).toBe(0);
  });

  it('update() zeroes amountDue on overdue → written_off', async () => {
    const { service, dynamoDBClient } = makeService(
      makeInvoice({ status: 'overdue' }),
      makeAccount(),
    );

    await service.update(SCHOOL, INVOICE_ID, { status: 'written_off' } as any, ctx);

    const invoiceUpdate = transactItems(dynamoDBClient)[0].Update;
    expect(invoiceUpdate.UpdateExpression).toContain('amountDue = :zero');
    expect(invoiceUpdate.ExpressionAttributeValues[':zero']).toBe(0);
  });

  it('update() zeroes amountDue on draft → cancelled (no ledger impact, still not outstanding)', async () => {
    const { service, dynamoDBClient } = makeService(
      makeInvoice({ status: 'draft', gsi1sk: 'INVOICE#draft#2026-06-01' }),
      makeAccount(),
    );

    await service.update(SCHOOL, INVOICE_ID, { status: 'cancelled' } as any, ctx);

    const [, , , updateExpr, values] = dynamoDBClient.updateItem.mock.calls[0];
    expect(updateExpr).toContain('amountDue = :zero');
    expect((values as Record<string, unknown>)[':zero']).toBe(0);
  });

  it('bulkCancelDrafts → cancelDraftInvoice zeroes amountDue too', async () => {
    const draft = makeInvoice({ status: 'draft', gsi1sk: 'INVOICE#draft#2026-06-01' });
    const { service, dynamoDBClient } = makeService(draft, null);
    dynamoDBClient.queryGSI.mockResolvedValue({ items: [draft], hasMore: false });

    const result = await service.bulkCancelDrafts(SCHOOL, { dryRun: false }, ctx);

    expect(result.cancelled).toBe(1);
    const [, , , updateExpr, values] = dynamoDBClient.updateItem.mock.calls[0];
    expect(updateExpr).toContain('amountDue = :zero');
    expect((values as Record<string, unknown>)[':zero']).toBe(0);
  });
});
