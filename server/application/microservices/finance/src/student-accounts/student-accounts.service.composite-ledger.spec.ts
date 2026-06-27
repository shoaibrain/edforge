/**
 * StudentAccountsService.buildCompositeLedgerTransactItems —
 * Pilot Onboarding Hardening Sprint PD.1.3
 *
 * The existing single-row helper `buildLedgerEntryTransactItems` builds
 * one ledger Put + one account Update. DDB rejects duplicate keys in a
 * single TransactWriteItems, so Sprint PD.2.3 (payment + opening-balance
 * settlement in one atomic write) cannot fold two ledger writes against
 * the same account UNLESS we compose them into N ledger Puts + a SINGLE
 * account Update with the summed delta.
 *
 * This spec pins that composition.
 *
 * Why a separate spec file: the existing `student-accounts.service.spec.ts`
 * is large and exercises the standalone `recordLedgerEntry` path. Keeping
 * the composite helper's spec isolated keeps the new contract reviewable.
 */

import { StudentAccountsService } from './student-accounts.service';
import type { BillingAccountEntity } from '../common/entities/billing-account.entity';
import type { RequestContext } from '../common/entities/base.entity';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const SCHOOL_ID = '22222222-2222-4222-8222-222222222222';
const STUDENT_ID = '33333333-3333-4333-8333-333333333333';
const ACCOUNT_ID = '44444444-4444-4444-8444-444444444444';
const USER_ID = '55555555-5555-4555-8555-555555555555';

function makeAccount(overrides: Partial<BillingAccountEntity> = {}): BillingAccountEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `BILLING_ACCOUNT#${SCHOOL_ID}#${STUDENT_ID}`,
    entityType: 'BILLING_ACCOUNT',
    accountId: ACCOUNT_ID,
    studentId: STUDENT_ID,
    schoolId: SCHOOL_ID,
    studentName: 'Aakriti Sharma',
    balance: 2000, // starts with $2,000 debt from a prior invoice
    totalPaid: 0,
    lastPaymentDate: null,
    gsi1pk: `TENANT#${TENANT_ID}#SCHOOL#${SCHOOL_ID}`,
    gsi1sk: 'BILLING_ACCOUNT#AAKRITI SHARMA',
    gsi2pk: `TENANT#${TENANT_ID}#STUDENT#${STUDENT_ID}`,
    gsi2sk: `BILLING_ACCOUNT#${SCHOOL_ID}`,
    createdAt: '2026-04-12T00:00:00Z',
    createdBy: USER_ID,
    updatedAt: '2026-04-12T00:00:00Z',
    updatedBy: USER_ID,
    version: 3,
    ...overrides,
  };
}

function makeCtx(): RequestContext {
  return {
    tenantId: TENANT_ID,
    userId: USER_ID,
    jwtToken: 'jwt-token',
    email: 'op@example.com',
    role: 'TenantAdmin',
  };
}

function buildService(): StudentAccountsService {
  const dynamoDBClient: any = {
    getTableName: () => 'edforge-finance-basic',
  };
  const identityClient: any = {};
  // PD.1.4 adds FinanceAuditService as the 3rd constructor arg.
  // The composite helper does not emit audit events; a stub suffices.
  const financeAudit: any = { emit: jest.fn().mockResolvedValue(undefined) };
  return new StudentAccountsService(dynamoDBClient, identityClient, financeAudit);
}

describe('buildCompositeLedgerTransactItems — PD.1.3 N-ledger / single-account-delta', () => {
  let service: StudentAccountsService;

  beforeEach(() => {
    service = buildService();
  });

  it('1 input ⇒ behaves like the existing single-row helper (debit case)', () => {
    const account = makeAccount({ balance: 0 });
    const { ledgerEntries, items, summedDelta } =
      service.buildCompositeLedgerTransactItems(
        account,
        [
          {
            entryType: 'opening_balance',
            referenceId: 'opening-balance-set',
            description: 'Opening balance — BS 2082 carry-forward',
            debit: 5000,
            credit: 0,
          },
        ],
        makeCtx(),
      );

    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0].entryType).toBe('opening_balance');
    expect(ledgerEntries[0].debit).toBe(5000);
    expect(ledgerEntries[0].balance).toBe(5000); // 0 + 5000

    // 1 ledger Put + 1 account Update
    expect(items).toHaveLength(2);
    expect((items[0] as any).Put).toBeDefined();
    expect((items[1] as any).Update).toBeDefined();
    expect(summedDelta).toBe(5000);

    // Account Update is last; carries newBalance + version bump
    const update: any = (items[1] as any).Update;
    expect(update.ExpressionAttributeValues[':newBalance']).toBe(5000);
    expect(update.ExpressionAttributeValues[':currentVersion']).toBe(account.version);
    // No payment, no lastPaymentDate update
    expect(update.ExpressionAttributeValues[':payDate']).toBeUndefined();
    expect(update.UpdateExpression).not.toMatch(/lastPaymentDate/);
  });

  it('2 inputs with opposite signs (invoice debit + payment credit) ⇒ correct summed delta + lastPaymentDate', () => {
    const account = makeAccount({ balance: 0, totalPaid: 0 });
    const { ledgerEntries, items, summedDelta } =
      service.buildCompositeLedgerTransactItems(
        account,
        [
          {
            entryType: 'invoice',
            referenceId: 'invoice-1',
            description: 'Invoice INV-2026-0001 — Tuition',
            debit: 8000,
            credit: 0,
          },
          {
            entryType: 'payment',
            referenceId: 'payment-1',
            description: 'Payment received — Cash',
            debit: 0,
            credit: 3000,
          },
        ],
        makeCtx(),
      );

    // Running balance: 0 → +8000 → −3000 = 5000
    expect(ledgerEntries[0].balance).toBe(8000);
    expect(ledgerEntries[1].balance).toBe(5000);
    expect(summedDelta).toBe(5000); // 8000 − 3000

    // 2 ledger Puts + 1 account Update in order
    expect(items).toHaveLength(3);
    expect((items[0] as any).Put.Item.entryType).toBe('invoice');
    expect((items[1] as any).Put.Item.entryType).toBe('payment');
    expect((items[2] as any).Update).toBeDefined();

    // Account Update reflects summed delta + payment date
    const update: any = (items[2] as any).Update;
    expect(update.ExpressionAttributeValues[':newBalance']).toBe(5000);
    expect(update.ExpressionAttributeValues[':newTotalPaid']).toBe(3000);
    expect(update.ExpressionAttributeValues[':payDate']).toBeDefined();
    expect(update.UpdateExpression).toMatch(/lastPaymentDate = :payDate/);
  });

  it('3 inputs summed delta is correct (PD.2.3 split payment scenario)', () => {
    // Scenario: 1 invoice for 2000, then 1 payment of 3000 that
    // settles the invoice + applies remainder to opening balance.
    // In Sprint PD.2.3 this composes as ledger entries:
    //   1. invoice debit 2000  (the issued invoice)
    //   2. payment credit 2000  (allocated to invoice)
    //   3. payment credit 1000  (allocated to opening_balance)
    const account = makeAccount({ balance: 5000 }); // 5k opening balance already booked
    const { items, summedDelta } = service.buildCompositeLedgerTransactItems(
      account,
      [
        { entryType: 'invoice', referenceId: 'inv-1', description: 'INV-1', debit: 2000, credit: 0 },
        { entryType: 'payment', referenceId: 'pay-1', description: 'Pay→INV-1', debit: 0, credit: 2000 },
        { entryType: 'payment', referenceId: 'pay-1', description: 'Pay→opening', debit: 0, credit: 1000 },
      ],
      makeCtx(),
    );

    // Summed: +2000 − 2000 − 1000 = −1000
    expect(summedDelta).toBe(-1000);

    const update: any = (items[items.length - 1] as any).Update;
    expect(update.ExpressionAttributeValues[':newBalance']).toBe(4000); // 5000 − 1000
    expect(update.ExpressionAttributeValues[':newTotalPaid']).toBe(3000); // 2000 + 1000
  });

  it('account Update version check uses the entity version + bumps by 1', () => {
    const account = makeAccount({ version: 7 });
    const { items } = service.buildCompositeLedgerTransactItems(
      account,
      [{ entryType: 'opening_balance', referenceId: 'r', description: 'd', debit: 100, credit: 0 }],
      makeCtx(),
    );

    const update: any = (items[items.length - 1] as any).Update;
    expect(update.ExpressionAttributeValues[':currentVersion']).toBe(7);
    expect(update.ExpressionAttributeValues[':one']).toBe(1);
    expect(update.ConditionExpression).toBe('#v = :currentVersion');
    expect(update.UpdateExpression).toMatch(/#v = #v \+ :one/);
  });

  it('empty inputs[] ⇒ throws (defensive — caller must always provide at least one entry)', () => {
    expect(() =>
      service.buildCompositeLedgerTransactItems(makeAccount(), [], makeCtx()),
    ).toThrow(/must contain at least one ledger entry/);
  });

  it('ledger entries appear in insertion order in the items array (predictable for review + receipts)', () => {
    const account = makeAccount({ balance: 0 });
    const { items } = service.buildCompositeLedgerTransactItems(
      account,
      [
        { entryType: 'invoice', referenceId: 'inv-A', description: 'A', debit: 100, credit: 0 },
        { entryType: 'invoice', referenceId: 'inv-B', description: 'B', debit: 200, credit: 0 },
        { entryType: 'invoice', referenceId: 'inv-C', description: 'C', debit: 300, credit: 0 },
      ],
      makeCtx(),
    );

    expect((items[0] as any).Put.Item.referenceId).toBe('inv-A');
    expect((items[1] as any).Put.Item.referenceId).toBe('inv-B');
    expect((items[2] as any).Put.Item.referenceId).toBe('inv-C');
    // Account Update LAST
    expect((items[3] as any).Update).toBeDefined();
  });

  it('balance running-total per entry matches summed application (running balance invariant)', () => {
    // Starting balance: 1000. Apply +500, −200, +300.
    // Expected per-entry balances: 1500, 1300, 1600.
    const account = makeAccount({ balance: 1000 });
    const { ledgerEntries } = service.buildCompositeLedgerTransactItems(
      account,
      [
        { entryType: 'invoice', referenceId: '1', description: '1', debit: 500, credit: 0 },
        { entryType: 'payment', referenceId: '2', description: '2', debit: 0, credit: 200 },
        { entryType: 'invoice', referenceId: '3', description: '3', debit: 300, credit: 0 },
      ],
      makeCtx(),
    );

    expect(ledgerEntries[0].balance).toBe(1500);
    expect(ledgerEntries[1].balance).toBe(1300);
    expect(ledgerEntries[2].balance).toBe(1600);
  });
});
