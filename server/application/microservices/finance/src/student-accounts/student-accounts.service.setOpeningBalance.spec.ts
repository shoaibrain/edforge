/**
 * StudentAccountsService.setOpeningBalance —
 * Pilot Onboarding Hardening Sprint PD.1.4
 *
 * Pins the first-time-set + revision + idempotent-no-op + validation
 * + concurrency paths. All side effects (ledger entry, account update,
 * audit emit) verified through mocked DDB + FinanceAuditService.
 */

import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { StudentAccountsService } from './student-accounts.service';
import type { BillingAccountEntity, BillingAccountLookupEntity } from '../common/entities/billing-account.entity';
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
    balance: 0,
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
    version: 1,
    ...overrides,
  };
}

function makeLookup(): BillingAccountLookupEntity {
  return {
    tenantId: TENANT_ID,
    entityKey: `ACCOUNT#${ACCOUNT_ID}`,
    entityType: 'BILLING_ACCOUNT_LOOKUP',
    accountId: ACCOUNT_ID,
    schoolId: SCHOOL_ID,
    studentId: STUDENT_ID,
    billingAccountKey: `BILLING_ACCOUNT#${SCHOOL_ID}#${STUDENT_ID}`,
    createdAt: '2026-04-12T00:00:00Z',
    createdBy: USER_ID,
    updatedAt: '2026-04-12T00:00:00Z',
    updatedBy: USER_ID,
    version: 1,
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

interface Mocks {
  dynamoDBClient: any;
  identityClient: any;
  financeAudit: any;
}

function buildService(): { service: StudentAccountsService; mocks: Mocks } {
  const dynamoDBClient: any = {
    getClient: jest.fn().mockResolvedValue({}),
    getTableName: () => 'edforge-finance-basic',
    getItem: jest.fn(),
    updateItem: jest.fn().mockResolvedValue({}),
    transactWrite: jest.fn().mockResolvedValue(undefined),
  };
  const identityClient: any = {};
  const financeAudit: any = {
    emit: jest.fn().mockResolvedValue(undefined),
  };
  const service = new StudentAccountsService(dynamoDBClient, identityClient, financeAudit);
  return { service, mocks: { dynamoDBClient, identityClient, financeAudit } };
}

describe('StudentAccountsService.setOpeningBalance — PD.1.4', () => {
  describe('first-time set', () => {
    it('writes opening_balance ledger entry + updates account + emits audit (the demo path)', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())                                  // ACCOUNT#... lookup
        .mockResolvedValueOnce(makeAccount({ balance: 0 }));                  // canonical row

      const result = await service.setOpeningBalance(
        ACCOUNT_ID,
        5000,
        '2026-04-12',
        'BS 2082 carry-forward',
        makeCtx(),
      );

      // One TransactWriteItems call
      expect(mocks.dynamoDBClient.transactWrite).toHaveBeenCalledTimes(1);
      const items = mocks.dynamoDBClient.transactWrite.mock.calls[0][1];
      // 1 ledger Put + 1 account Update
      expect(items).toHaveLength(2);
      expect(items[0].Put.Item.entryType).toBe('opening_balance');
      expect(items[0].Put.Item.debit).toBe(5000);
      expect(items[0].Put.Item.credit).toBe(0);
      expect(items[0].Put.Item.balance).toBe(5000); // 0 starting + 5000 debit

      // Account Update sets balance + 3 opening-balance fields + version bump
      const upd = items[1].Update;
      expect(upd.ExpressionAttributeValues[':newBalance']).toBe(5000);
      expect(upd.ExpressionAttributeValues[':ob']).toBe(5000);
      expect(upd.ExpressionAttributeValues[':obAsOf']).toBe('2026-04-12');
      expect(upd.ExpressionAttributeValues[':obNote']).toBe('BS 2082 carry-forward');
      expect(upd.ConditionExpression).toBe('#v = :currentVersion');
      expect(upd.ExpressionAttributeValues[':currentVersion']).toBe(1);

      // Audit emit
      expect(mocks.financeAudit.emit).toHaveBeenCalledTimes(1);
      expect(mocks.financeAudit.emit).toHaveBeenCalledWith(
        'finance.opening_balance.set',
        expect.objectContaining({
          schoolId: SCHOOL_ID,
          metadata: expect.objectContaining({
            accountId: ACCOUNT_ID,
            studentId: STUDENT_ID,
            asOf: '2026-04-12',
            amount: 5000,
            note: 'BS 2082 carry-forward',
          }),
        }),
        expect.any(Object),
      );

      // Returned shape
      expect(result.isRevision).toBe(false);
      expect(result.ledgerEntryId).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.account.openingBalance).toBe(5000);
      expect(result.account.openingBalanceAsOf).toBe('2026-04-12');
      expect(result.account.openingBalanceNote).toBe('BS 2082 carry-forward');
      expect(result.account.balance).toBe(5000);
      expect(result.account.version).toBe(2);
    });

    it('balance += openingBalance on account with non-zero prior balance from existing invoices', async () => {
      const { service, mocks } = buildService();
      // Account already has 2000 outstanding from a prior invoice
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(makeAccount({ balance: 2000, version: 3 }));

      const result = await service.setOpeningBalance(
        ACCOUNT_ID,
        5000,
        '2026-04-12',
        undefined,
        makeCtx(),
      );

      const upd = mocks.dynamoDBClient.transactWrite.mock.calls[0][1][1].Update;
      // 2000 prior + 5000 opening = 7000
      expect(upd.ExpressionAttributeValues[':newBalance']).toBe(7000);
      expect(result.account.balance).toBe(7000);
    });

    it('note omitted ⇒ openingBalanceNote NOT included in account Update', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(makeAccount());

      await service.setOpeningBalance(ACCOUNT_ID, 5000, '2026-04-12', undefined, makeCtx());

      const upd = mocks.dynamoDBClient.transactWrite.mock.calls[0][1][1].Update;
      expect(upd.UpdateExpression).not.toMatch(/openingBalanceNote/);
      expect(upd.ExpressionAttributeValues[':obNote']).toBeUndefined();
    });
  });

  describe('revision', () => {
    it('new amount > old ⇒ adjustment ledger entry with positive debit, balance += delta', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(makeAccount({
          balance: 5000,
          openingBalance: 5000,
          openingBalanceAsOf: '2026-04-12',
          openingBalanceNote: 'original',
          version: 2,
        }));

      const result = await service.setOpeningBalance(
        ACCOUNT_ID,
        6500, // up 1500
        '2026-04-15',
        'revised upward',
        makeCtx(),
      );

      const items = mocks.dynamoDBClient.transactWrite.mock.calls[0][1];
      expect(items[0].Put.Item.entryType).toBe('adjustment');
      expect(items[0].Put.Item.debit).toBe(1500);
      expect(items[0].Put.Item.credit).toBe(0);
      expect(items[0].Put.Item.description).toMatch(/Opening balance revision: 5000 → 6500/);

      const upd = items[1].Update;
      expect(upd.ExpressionAttributeValues[':newBalance']).toBe(6500); // 5000 + 1500
      expect(upd.ExpressionAttributeValues[':ob']).toBe(6500);

      expect(mocks.financeAudit.emit).toHaveBeenCalledWith(
        'finance.opening_balance.revised',
        expect.objectContaining({
          metadata: expect.objectContaining({
            oldAmount: 5000,
            newAmount: 6500,
            delta: 1500,
          }),
        }),
        expect.any(Object),
      );
      expect(result.isRevision).toBe(true);
    });

    it('new amount < old ⇒ adjustment ledger entry with positive credit, balance -= |delta|', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(makeAccount({
          balance: 5000,
          openingBalance: 5000,
          openingBalanceAsOf: '2026-04-12',
          version: 2,
        }));

      const result = await service.setOpeningBalance(
        ACCOUNT_ID,
        3000, // down 2000
        '2026-04-15',
        undefined,
        makeCtx(),
      );

      const items = mocks.dynamoDBClient.transactWrite.mock.calls[0][1];
      expect(items[0].Put.Item.entryType).toBe('adjustment');
      expect(items[0].Put.Item.debit).toBe(0);
      expect(items[0].Put.Item.credit).toBe(2000);

      const upd = items[1].Update;
      expect(upd.ExpressionAttributeValues[':newBalance']).toBe(3000); // 5000 − 2000
      expect(result.account.balance).toBe(3000);
      expect(result.account.openingBalance).toBe(3000);
    });

    it('revision down to 0 ⇒ allowed; full credit; openingBalance becomes 0 (not undefined)', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(makeAccount({
          balance: 5000,
          openingBalance: 5000,
          openingBalanceAsOf: '2026-04-12',
          version: 2,
        }));

      const result = await service.setOpeningBalance(ACCOUNT_ID, 0, '2026-04-15', undefined, makeCtx());

      const items = mocks.dynamoDBClient.transactWrite.mock.calls[0][1];
      expect(items[0].Put.Item.credit).toBe(5000);
      expect(result.account.openingBalance).toBe(0);
      expect(result.account.balance).toBe(0);
    });

    it('revision with same amount ⇒ idempotent no-op for amount; single UpdateItem; no ledger; no audit; NO version bump', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(makeAccount({
          balance: 5000,
          openingBalance: 5000,
          openingBalanceAsOf: '2026-04-12',
          openingBalanceNote: 'original',
          version: 3,
        }));

      const result = await service.setOpeningBalance(
        ACCOUNT_ID,
        5000, // same amount
        '2026-04-15', // different asOf
        'updated note',
        makeCtx(),
      );

      // NO TransactWriteItems
      expect(mocks.dynamoDBClient.transactWrite).not.toHaveBeenCalled();
      // YES single UpdateItem (asOf + note + updatedAt only)
      expect(mocks.dynamoDBClient.updateItem).toHaveBeenCalledTimes(1);
      const updateArgs = mocks.dynamoDBClient.updateItem.mock.calls[0];
      expect(updateArgs[3]).toMatch(/SET openingBalanceAsOf = :asOf/);
      expect(updateArgs[3]).toMatch(/openingBalanceNote = :note/);
      // NO version bump
      expect(updateArgs[3]).not.toMatch(/#v = #v \+ :one/);

      // NO audit emit
      expect(mocks.financeAudit.emit).not.toHaveBeenCalled();

      expect(result.ledgerEntryId).toBeNull();
      expect(result.isRevision).toBe(true);
      expect(result.account.openingBalance).toBe(5000); // unchanged
      expect(result.account.openingBalanceAsOf).toBe('2026-04-15'); // updated
      expect(result.account.openingBalanceNote).toBe('updated note');
    });

    it('no-op revision with note cleared ⇒ REMOVE openingBalanceNote in UpdateExpression', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(makeAccount({
          openingBalance: 5000,
          openingBalanceAsOf: '2026-04-12',
          openingBalanceNote: 'original note to clear',
        }));

      await service.setOpeningBalance(ACCOUNT_ID, 5000, '2026-04-15', undefined, makeCtx());

      const updateExpr = mocks.dynamoDBClient.updateItem.mock.calls[0][3];
      expect(updateExpr).toMatch(/REMOVE openingBalanceNote/);
    });

    it('revision with note cleared (delta ≠ 0) ⇒ REMOVE openingBalanceNote on the account Update', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(makeAccount({
          balance: 5000,
          openingBalance: 5000,
          openingBalanceAsOf: '2026-04-12',
          openingBalanceNote: 'original',
          version: 2,
        }));

      await service.setOpeningBalance(ACCOUNT_ID, 6500, '2026-04-15', undefined, makeCtx());

      const upd = mocks.dynamoDBClient.transactWrite.mock.calls[0][1][1].Update;
      expect(upd.UpdateExpression).toMatch(/REMOVE openingBalanceNote/);
    });
  });

  describe('validation', () => {
    it('negative amount ⇒ BadRequestException with OPENING_BALANCE_NEGATIVE code', async () => {
      const { service, mocks } = buildService();
      // Should reject BEFORE any DDB call
      await expect(
        service.setOpeningBalance(ACCOUNT_ID, -1, '2026-04-12', undefined, makeCtx()),
      ).rejects.toThrow(BadRequestException);
      await expect(
        service.setOpeningBalance(ACCOUNT_ID, -1, '2026-04-12', undefined, makeCtx()),
      ).rejects.toMatchObject({ response: { code: 'OPENING_BALANCE_NEGATIVE' } });

      expect(mocks.dynamoDBClient.getItem).not.toHaveBeenCalled();
    });

    it('malformed asOf string ⇒ BadRequestException with OPENING_BALANCE_ASOF_FORMAT code', async () => {
      const { service } = buildService();
      await expect(
        service.setOpeningBalance(ACCOUNT_ID, 5000, 'yesterday', undefined, makeCtx()),
      ).rejects.toMatchObject({ response: { code: 'OPENING_BALANCE_ASOF_FORMAT' } });
    });

    it('future asOf date ⇒ BadRequestException with OPENING_BALANCE_ASOF_FUTURE code', async () => {
      const { service } = buildService();
      const future = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      await expect(
        service.setOpeningBalance(ACCOUNT_ID, 5000, future, undefined, makeCtx()),
      ).rejects.toMatchObject({ response: { code: 'OPENING_BALANCE_ASOF_FUTURE' } });
    });

    it('note > 500 chars ⇒ BadRequestException with OPENING_BALANCE_NOTE_TOO_LONG code', async () => {
      const { service } = buildService();
      await expect(
        service.setOpeningBalance(ACCOUNT_ID, 5000, '2026-04-12', 'x'.repeat(501), makeCtx()),
      ).rejects.toMatchObject({ response: { code: 'OPENING_BALANCE_NOTE_TOO_LONG' } });
    });

    it('account not found via lookup ⇒ NotFoundException with BILLING_ACCOUNT_NOT_FOUND code', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem.mockResolvedValueOnce(undefined); // no lookup

      await expect(
        service.setOpeningBalance(ACCOUNT_ID, 5000, '2026-04-12', undefined, makeCtx()),
      ).rejects.toMatchObject({ response: { code: 'BILLING_ACCOUNT_NOT_FOUND' } });
    });

    it('canonical row missing despite lookup hit ⇒ NotFoundException with BILLING_ACCOUNT_CANONICAL_MISSING code', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(undefined); // canonical gone

      await expect(
        service.setOpeningBalance(ACCOUNT_ID, 5000, '2026-04-12', undefined, makeCtx()),
      ).rejects.toMatchObject({ response: { code: 'BILLING_ACCOUNT_CANONICAL_MISSING' } });
    });
  });

  describe('concurrency', () => {
    it('TransactionCanceledException ⇒ 409 ConflictException with CONCURRENT_UPDATE code (PD.1.4 race contract)', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(makeAccount());

      const error = new Error('cancelled');
      (error as any).name = 'TransactionCanceledException';
      mocks.dynamoDBClient.transactWrite.mockRejectedValueOnce(error);

      try {
        await service.setOpeningBalance(ACCOUNT_ID, 5000, '2026-04-12', undefined, makeCtx());
        fail('expected ConflictException');
      } catch (err: any) {
        expect(err).toBeInstanceOf(ConflictException);
        expect(err.response).toEqual(
          expect.objectContaining({ code: 'CONCURRENT_UPDATE' }),
        );
      }
    });

    it('ConditionalCheckFailedException ⇒ same 409 path', async () => {
      const { service, mocks } = buildService();
      mocks.dynamoDBClient.getItem
        .mockResolvedValueOnce(makeLookup())
        .mockResolvedValueOnce(makeAccount());

      const error = new Error('condition failed');
      (error as any).name = 'ConditionalCheckFailedException';
      mocks.dynamoDBClient.transactWrite.mockRejectedValueOnce(error);

      await expect(
        service.setOpeningBalance(ACCOUNT_ID, 5000, '2026-04-12', undefined, makeCtx()),
      ).rejects.toThrow(ConflictException);
    });
  });
});
