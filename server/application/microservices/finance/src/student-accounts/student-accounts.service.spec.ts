/**
 * student-accounts.service spec — Sprint C2.T3.
 *
 * Locks the new BILLING_ACCOUNT_LOOKUP mirror row contract:
 *   - getOrCreate writes the canonical BillingAccount AND the mirror row
 *     atomically via a single TransactWriteItems.
 *   - getByAccountId fast-paths through the mirror (two GetItems) and falls
 *     back to the legacy GSI1+filter scan when the mirror is missing
 *     (covers pre-backfill data on the first deploy).
 *   - Cross-school protection: a mirror row whose schoolId doesn't match the
 *     URL path's schoolId returns NotFoundException (no leak across schools).
 *   - Race handling: a TransactionCanceledException re-fetches the
 *     canonical BillingAccount instead of erroring.
 */

import { NotFoundException } from '@nestjs/common';
import { StudentAccountsService } from './student-accounts.service';
import {
  BillingAccountEntity,
  BillingAccountLookupEntity,
  createBillingAccountLookupEntity,
} from '../common/entities/billing-account.entity';
import { EntityKeyBuilder } from '../common/entities/base.entity';

const ctx = {
  tenantId: 'tenant-x',
  userId: 'user-1',
  email: 'admin@example.com',
  role: 'TenantAdmin',
  jwtToken: 'jwt-x',
} as any;

const SCHOOL_ID = 'school-a';
const STUDENT_ID = 'student-1';
const STUDENT_NAME = 'Lilia Rain';

function makeMockDdb() {
  return {
    getClient: jest.fn().mockResolvedValue({} as any),
    getItem: jest.fn(),
    putItem: jest.fn(),
    transactWrite: jest.fn(),
    queryGSI: jest.fn(),
    getTableName: jest.fn().mockReturnValue('edforge-finance-test'),
    updateItem: jest.fn(),
    query: jest.fn(),
  } as any;
}

function makeMockIdentity() {
  return {} as any;
}

describe('createBillingAccountLookupEntity', () => {
  it('produces an ACCOUNT# entity with the canonical billing-account SK reference', () => {
    const accountId = 'a1b2c3d4-0000-0000-0000-000000000000';
    const e = createBillingAccountLookupEntity(
      'tenant-x',
      accountId,
      'school-a',
      'student-1',
      'user-1',
    );
    expect(e.entityType).toBe('BILLING_ACCOUNT_LOOKUP');
    expect(e.entityKey).toBe(`ACCOUNT#${accountId}`);
    expect(e.accountId).toBe(accountId);
    expect(e.schoolId).toBe('school-a');
    expect(e.studentId).toBe('student-1');
    expect(e.billingAccountKey).toBe(EntityKeyBuilder.billingAccount('school-a', 'student-1'));
    expect(e.tenantId).toBe('tenant-x');
    expect(e.createdBy).toBe('user-1');
    expect(typeof e.createdAt).toBe('string');
    expect(e.version).toBe(1);
  });
});

describe('StudentAccountsService.getOrCreate (Sprint C2.T3 transactional write)', () => {
  it('writes the BillingAccount AND the mirror row in a single transactWrite', async () => {
    const ddb = makeMockDdb();
    ddb.getItem.mockResolvedValue(null); // no existing account
    ddb.transactWrite.mockResolvedValue(undefined);
    const svc = new StudentAccountsService(ddb, makeMockIdentity());

    const created = await svc.getOrCreate(SCHOOL_ID, STUDENT_ID, STUDENT_NAME, ctx);

    expect(ddb.transactWrite).toHaveBeenCalledTimes(1);
    const items = ddb.transactWrite.mock.calls[0][1];
    expect(items).toHaveLength(2);

    // First item: the canonical BillingAccount Put
    expect(items[0].Put.Item.entityType).toBe('BILLING_ACCOUNT');
    expect(items[0].Put.Item.entityKey).toBe(EntityKeyBuilder.billingAccount(SCHOOL_ID, STUDENT_ID));
    expect(items[0].Put.ConditionExpression).toBe('attribute_not_exists(entityKey)');

    // Second item: the mirror row Put
    expect(items[1].Put.Item.entityType).toBe('BILLING_ACCOUNT_LOOKUP');
    expect(items[1].Put.Item.entityKey).toBe(`ACCOUNT#${created.accountId}`);
    expect(items[1].Put.Item.billingAccountKey).toBe(items[0].Put.Item.entityKey);
    expect(items[1].Put.ConditionExpression).toBe('attribute_not_exists(entityKey)');

    // The mirror row must point at the same schoolId/studentId as the BillingAccount
    expect(items[1].Put.Item.schoolId).toBe(SCHOOL_ID);
    expect(items[1].Put.Item.studentId).toBe(STUDENT_ID);
    expect(items[1].Put.Item.accountId).toBe(created.accountId);
  });

  it('does NOT call transactWrite when an account already exists (idempotent fast path)', async () => {
    const ddb = makeMockDdb();
    const existing: Partial<BillingAccountEntity> = {
      tenantId: 'tenant-x',
      entityKey: EntityKeyBuilder.billingAccount(SCHOOL_ID, STUDENT_ID),
      entityType: 'BILLING_ACCOUNT',
      accountId: 'existing-uuid',
      schoolId: SCHOOL_ID,
      studentId: STUDENT_ID,
      studentName: STUDENT_NAME,
      balance: 0,
      totalPaid: 0,
      lastPaymentDate: null,
      version: 1,
    };
    ddb.getItem.mockResolvedValue(existing);
    const svc = new StudentAccountsService(ddb, makeMockIdentity());

    const result = await svc.getOrCreate(SCHOOL_ID, STUDENT_ID, STUDENT_NAME, ctx);

    expect(ddb.transactWrite).not.toHaveBeenCalled();
    expect(result.accountId).toBe('existing-uuid');
  });

  it('handles TransactionCanceledException by re-fetching the canonical account (race lost)', async () => {
    const ddb = makeMockDdb();
    // First getItem (existence pre-check) returns null → enters create path.
    // Second getItem (post-rollback recovery) returns the race winner.
    const winner: Partial<BillingAccountEntity> = {
      tenantId: 'tenant-x',
      entityKey: EntityKeyBuilder.billingAccount(SCHOOL_ID, STUDENT_ID),
      entityType: 'BILLING_ACCOUNT',
      accountId: 'race-winner-uuid',
      schoolId: SCHOOL_ID,
      studentId: STUDENT_ID,
      studentName: STUDENT_NAME,
      balance: 0,
      totalPaid: 0,
      lastPaymentDate: null,
      version: 1,
    };
    ddb.getItem.mockResolvedValueOnce(null).mockResolvedValueOnce(winner);

    const txError = new Error('Transaction cancelled by upstream');
    (txError as any).name = 'TransactionCanceledException';
    ddb.transactWrite.mockRejectedValue(txError);

    const svc = new StudentAccountsService(ddb, makeMockIdentity());

    const result = await svc.getOrCreate(SCHOOL_ID, STUDENT_ID, STUDENT_NAME, ctx);
    expect(result.accountId).toBe('race-winner-uuid');
    expect(ddb.getItem).toHaveBeenCalledTimes(2);
  });
});

describe('StudentAccountsService.getByAccountId (Sprint C2.T3 mirror-first read)', () => {
  function makeBillingAccountEntity(accountId: string, schoolId: string, studentId: string): BillingAccountEntity {
    return {
      tenantId: 'tenant-x',
      entityKey: EntityKeyBuilder.billingAccount(schoolId, studentId),
      entityType: 'BILLING_ACCOUNT',
      accountId,
      schoolId,
      studentId,
      studentName: 'Lilia Rain',
      balance: 0,
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

  it('uses the mirror row to resolve the account in two direct GetItems', async () => {
    const ddb = makeMockDdb();
    const accountId = 'd9072568-80c0-41ba-b1d6-aa2f9eaf9ad7';
    const lookup: Partial<BillingAccountLookupEntity> = {
      tenantId: 'tenant-x',
      entityKey: `ACCOUNT#${accountId}`,
      entityType: 'BILLING_ACCOUNT_LOOKUP',
      accountId,
      schoolId: SCHOOL_ID,
      studentId: STUDENT_ID,
      billingAccountKey: EntityKeyBuilder.billingAccount(SCHOOL_ID, STUDENT_ID),
    };
    const account = makeBillingAccountEntity(accountId, SCHOOL_ID, STUDENT_ID);
    ddb.getItem
      .mockResolvedValueOnce(lookup)   // mirror row hit
      .mockResolvedValueOnce(account); // billing account hit

    const svc = new StudentAccountsService(ddb, makeMockIdentity());
    const result = await svc.getByAccountId(SCHOOL_ID, accountId, ctx);

    expect(result.id).toBe(accountId);
    expect(ddb.getItem).toHaveBeenCalledTimes(2);
    expect(ddb.queryGSI).not.toHaveBeenCalled();
    // First GetItem: lookup row
    expect(ddb.getItem.mock.calls[0][2]).toBe(`ACCOUNT#${accountId}`);
    // Second GetItem: billing account row
    expect(ddb.getItem.mock.calls[1][2]).toBe(EntityKeyBuilder.billingAccount(SCHOOL_ID, STUDENT_ID));
  });

  it('rejects cross-school resolution: mirror schoolId mismatch returns NotFoundException', async () => {
    const ddb = makeMockDdb();
    const accountId = 'd9072568-80c0-41ba-b1d6-aa2f9eaf9ad7';
    const lookup = {
      tenantId: 'tenant-x',
      entityKey: `ACCOUNT#${accountId}`,
      entityType: 'BILLING_ACCOUNT_LOOKUP' as const,
      accountId,
      schoolId: 'other-school',
      studentId: STUDENT_ID,
      billingAccountKey: EntityKeyBuilder.billingAccount('other-school', STUDENT_ID),
    };
    ddb.getItem.mockResolvedValueOnce(lookup);
    const svc = new StudentAccountsService(ddb, makeMockIdentity());

    await expect(svc.getByAccountId(SCHOOL_ID, accountId, ctx)).rejects.toBeInstanceOf(NotFoundException);
    // Must NOT call the second GetItem (don't even fetch a record from the wrong school)
    expect(ddb.getItem).toHaveBeenCalledTimes(1);
  });

  it('falls back to GSI1 + filter when the mirror row is missing (legacy data, pre-backfill)', async () => {
    const ddb = makeMockDdb();
    const accountId = 'pre-backfill-uuid';
    ddb.getItem.mockResolvedValueOnce(null); // no mirror row
    ddb.queryGSI.mockResolvedValueOnce({
      items: [makeBillingAccountEntity(accountId, SCHOOL_ID, STUDENT_ID)],
      hasMore: false,
    });
    const svc = new StudentAccountsService(ddb, makeMockIdentity());

    const result = await svc.getByAccountId(SCHOOL_ID, accountId, ctx);

    expect(result.id).toBe(accountId);
    expect(ddb.queryGSI).toHaveBeenCalledTimes(1);
  });

  it('falls back to GSI1 + filter when the mirror points at a missing BillingAccount (defensive)', async () => {
    const ddb = makeMockDdb();
    const accountId = 'orphan-mirror-uuid';
    const orphan: Partial<BillingAccountLookupEntity> = {
      tenantId: 'tenant-x',
      entityKey: `ACCOUNT#${accountId}`,
      entityType: 'BILLING_ACCOUNT_LOOKUP',
      accountId,
      schoolId: SCHOOL_ID,
      studentId: STUDENT_ID,
      billingAccountKey: EntityKeyBuilder.billingAccount(SCHOOL_ID, STUDENT_ID),
    };
    ddb.getItem
      .mockResolvedValueOnce(orphan) // mirror exists
      .mockResolvedValueOnce(null);  // billing account vanished
    ddb.queryGSI.mockResolvedValueOnce({
      items: [makeBillingAccountEntity(accountId, SCHOOL_ID, STUDENT_ID)],
      hasMore: false,
    });

    const svc = new StudentAccountsService(ddb, makeMockIdentity());
    const result = await svc.getByAccountId(SCHOOL_ID, accountId, ctx);

    expect(result.id).toBe(accountId);
    expect(ddb.queryGSI).toHaveBeenCalledTimes(1);
  });

  it('throws NotFoundException when neither mirror nor GSI scan finds the account', async () => {
    const ddb = makeMockDdb();
    ddb.getItem.mockResolvedValueOnce(null);
    ddb.queryGSI.mockResolvedValueOnce({ items: [], hasMore: false });
    const svc = new StudentAccountsService(ddb, makeMockIdentity());

    await expect(svc.getByAccountId(SCHOOL_ID, 'no-such', ctx)).rejects.toBeInstanceOf(NotFoundException);
  });
});
