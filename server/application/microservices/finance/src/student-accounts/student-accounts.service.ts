import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { TransactWriteCommandInput } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  BillingAccountEntity,
  BillingAccountLookupEntity,
  createBillingAccountEntity,
  createBillingAccountLookupEntity,
} from '../common/entities/billing-account.entity';
import { LedgerEntryEntity, createLedgerEntryEntity } from '../common/entities/ledger-entry.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext, decodeCursor } from '../common/entities/base.entity';
import { billingAccountEntityToDto } from '../common/mappers/billing-account.mapper';
import type { BillingAccount, StudentLedgerEntry, LedgerEntryType } from '@aibrains/shared-types';

@Injectable()
export class StudentAccountsService {
  private readonly logger = new Logger(StudentAccountsService.name);

  constructor(
    private readonly dynamoDBClient: DynamoDBClientService,
    private readonly identityClient: IdentityClientService,
  ) {}

  /**
   * Get or create a billing account for a student at a school.
   * Ensures exactly one account per student per school.
   */
  async getOrCreate(
    schoolId: string,
    studentId: string,
    studentName: string,
    context: RequestContext,
  ): Promise<BillingAccountEntity> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const entityKey = EntityKeyBuilder.billingAccount(schoolId, studentId);

    const existing = await this.dynamoDBClient.getItem<BillingAccountEntity>(
      client,
      context.tenantId,
      entityKey,
    );

    if (existing) {
      // Backfill empty student name if a non-empty name is now available
      if ((!existing.studentName || existing.studentName.trim() === '') && studentName && studentName.trim() !== '') {
        try {
          const updatedGsi1sk = GSIKeyBuilder.entitySort('BILLING_ACCOUNT', studentName.toUpperCase());
          await this.dynamoDBClient.updateItem(
            client,
            context.tenantId,
            entityKey,
            'SET studentName = :name, gsi1sk = :gsi1sk, updatedAt = :now',
            {
              ':name': studentName,
              ':gsi1sk': updatedGsi1sk,
              ':now': new Date().toISOString(),
            },
          );
          existing.studentName = studentName;
          existing.gsi1sk = updatedGsi1sk;
        } catch (err: any) {
          this.logger.warn(`Failed to backfill student name for ${studentId}: ${err.message}`);
        }
      }
      return existing;
    }

    const entity = createBillingAccountEntity(
      context.tenantId,
      schoolId,
      studentId,
      studentName,
      context.userId,
    );

    // Sprint C2.T3: write the canonical BillingAccount AND the
    // ACCOUNT#<accountId> mirror row in a single transaction. The mirror row
    // gives `getByAccountId` an O(1) GetItem path (replacing the GSI1 +
    // accountId-filter scan) and lets Sprint C2.T4 include the account
    // lookup as a transactional pre-condition for atomic payment writes.
    const lookupEntity = createBillingAccountLookupEntity(
      context.tenantId,
      entity.accountId,
      schoolId,
      studentId,
      context.userId,
    );

    const tableName = this.dynamoDBClient.getTableName();
    try {
      await this.dynamoDBClient.transactWrite(client, [
        {
          Put: {
            TableName: tableName,
            Item: entity,
            ConditionExpression: 'attribute_not_exists(entityKey)',
          },
        },
        {
          Put: {
            TableName: tableName,
            Item: lookupEntity,
            ConditionExpression: 'attribute_not_exists(entityKey)',
          },
        },
      ]);
    } catch (error: any) {
      // TransactionCanceledException covers both the BillingAccount race
      // (someone else won) and the rare case where the mirror row already
      // exists (e.g. backfill landed mid-flight). In either case the
      // canonical BillingAccount key is the source of truth — fetch it.
      const errorName = error?.name ?? '';
      if (errorName === 'TransactionCanceledException' || errorName === 'ConditionalCheckFailedException') {
        const justCreated = await this.dynamoDBClient.getItem<BillingAccountEntity>(
          client,
          context.tenantId,
          entityKey,
        );
        if (justCreated) return justCreated;
      }
      throw error;
    }

    return entity;
  }

  async list(
    schoolId: string,
    context: RequestContext,
    options: {
      searchTerm?: string;
      hasOutstandingBalance?: boolean;
      limit?: number;
      cursor?: string;
    } = {},
  ): Promise<{ items: BillingAccount[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);

    const filterParts: string[] = [];
    const filterValues: Record<string, any> = {};

    if (options.hasOutstandingBalance) {
      filterParts.push('balance > :zero');
      filterValues[':zero'] = 0;
    }

    const result = await this.dynamoDBClient.queryGSI<BillingAccountEntity>(
      client,
      'GSI1',
      gsi1pk,
      'BILLING_ACCOUNT',
      'begins_with',
      filterParts.length > 0 ? filterParts.join(' AND ') : undefined,
      Object.keys(filterValues).length > 0 ? filterValues : undefined,
      undefined,
      options.limit || 50,
      true,
      decodeCursor(options.cursor),
    );

    let items = result.items.map(billingAccountEntityToDto);

    // Client-side search filter (DynamoDB doesn't support LIKE)
    if (options.searchTerm) {
      const term = options.searchTerm.toLowerCase();
      items = items.filter(a => a.studentName.toLowerCase().includes(term));
    }

    return {
      items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  async getByAccountId(
    schoolId: string,
    accountId: string,
    context: RequestContext,
  ): Promise<BillingAccount> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    // Sprint C2.T3 — fast path: direct GetItem on the mirror row, then on the
    // canonical BillingAccount. Two GetItems beats the prior GSI1 + filter
    // scan (which was O(N) per school) on every dimension that matters here.
    const lookupKey = EntityKeyBuilder.billingAccountLookup(accountId);
    const lookup = await this.dynamoDBClient.getItem<BillingAccountLookupEntity>(
      client,
      context.tenantId,
      lookupKey,
    );

    if (lookup) {
      // Cross-school protection: the controller passes the schoolId from the
      // URL path. If the resolved account is for a different school, treat as
      // not-found (avoids leaking another school's account to a user with
      // permission only on `schoolId`).
      if (lookup.schoolId !== schoolId) {
        throw new NotFoundException(`Billing account ${accountId} not found`);
      }
      const entity = await this.dynamoDBClient.getItem<BillingAccountEntity>(
        client,
        context.tenantId,
        lookup.billingAccountKey,
      );
      if (entity) {
        return billingAccountEntityToDto(entity);
      }
      // Mirror row pointed at a non-existent BillingAccount — should not
      // happen post-backfill. Fall through to the legacy GSI scan path.
      this.logger.warn(
        `Mirror row for account ${accountId} points at missing BillingAccount ${lookup.billingAccountKey} — falling back to GSI1 scan`,
      );
    }

    // Legacy path — exercised for any pre-Sprint-C2.T3 BillingAccount that
    // hasn't yet been touched by the backfill. Removed in a follow-up PR
    // once the backfill confirms 100% coverage; until then, log a warning
    // so we can spot how often it fires.
    if (!lookup) {
      this.logger.warn(
        `getByAccountId: no mirror row for account ${accountId} — backfill not yet complete; falling back to GSI1 scan`,
      );
    }
    const gsi1pk = GSIKeyBuilder.schoolScope(context.tenantId, schoolId);
    const result = await this.dynamoDBClient.queryGSI<BillingAccountEntity>(
      client,
      'GSI1',
      gsi1pk,
      'BILLING_ACCOUNT',
      'begins_with',
      'accountId = :accountId',
      { ':accountId': accountId },
    );

    if (result.items.length === 0) {
      throw new NotFoundException(`Billing account ${accountId} not found`);
    }

    return billingAccountEntityToDto(result.items[0]);
  }

  async getLedger(
    accountId: string,
    context: RequestContext,
    options: { limit?: number; cursor?: string } = {},
  ): Promise<{ items: StudentLedgerEntry[]; lastEvaluatedKey?: string; hasMore: boolean }> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);

    const result = await this.dynamoDBClient.query<LedgerEntryEntity>(
      client,
      context.tenantId,
      `LEDGER#${accountId}`,
      undefined,
      undefined,
      undefined,
      options.limit || 50,
      decodeCursor(options.cursor),
    );

    return {
      items: result.items.map(e => ({
        id: e.entryId,
        studentAccountId: e.studentAccountId,
        entryType: e.entryType,
        referenceId: e.referenceId,
        description: e.description,
        debit: e.debit,
        credit: e.credit,
        balance: e.balance,
        date: e.date,
        createdAt: e.createdAt,
      })),
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Sprint C2.B.T4 — build the two TransactWriteItems ops that record a
   * ledger entry and update the account balance, WITHOUT executing them.
   *
   * Returned items can be folded into a larger transaction (e.g. the
   * payment + invoice + ledger + account write in
   * `PaymentsService.recordManualPayment` / `completePayment`) so the
   * whole sequence either commits or fails together — closing the
   * BUG-F3 silent-failure window where a payment was marked completed
   * without a ledger entry being written.
   *
   * Returns `{ ledgerEntry, items }`:
   *   - `ledgerEntry` — the newly-built `LedgerEntryEntity` (caller may
   *     want it for post-commit logging, event payloads, etc.)
   *   - `items` — array of two `Put` + `Update` ops ready for transactWrite
   *
   * Standalone callers that DON'T want to fold into a larger transaction
   * keep using `recordLedgerEntry` (below) which executes the items inline.
   */
  buildLedgerEntryTransactItems(
    accountEntity: BillingAccountEntity,
    entryType: LedgerEntryType,
    referenceId: string,
    description: string,
    debit: number,
    credit: number,
    context: RequestContext,
  ): {
    ledgerEntry: LedgerEntryEntity;
    items: NonNullable<TransactWriteCommandInput['TransactItems']>;
  } {
    const newBalance = accountEntity.balance + debit - credit;
    const newTotalPaid = accountEntity.totalPaid + credit;
    const date = new Date().toISOString().split('T')[0];

    const ledgerEntry = createLedgerEntryEntity(
      context.tenantId,
      {
        studentAccountId: accountEntity.accountId,
        studentId: accountEntity.studentId,
        entryType,
        referenceId,
        description,
        debit,
        credit,
        balance: newBalance,
        date,
      },
      context.userId,
    );

    const tableName = this.dynamoDBClient.getTableName();

    const items: NonNullable<TransactWriteCommandInput['TransactItems']> = [
      {
        Put: {
          TableName: tableName,
          Item: ledgerEntry,
          ConditionExpression: 'attribute_not_exists(entityKey)',
        },
      },
      {
        Update: {
          TableName: tableName,
          Key: {
            tenantId: accountEntity.tenantId,
            entityKey: accountEntity.entityKey,
          },
          UpdateExpression: 'SET balance = :newBalance, totalPaid = :newTotalPaid, updatedAt = :now, #v = #v + :one'
            + (credit > 0 ? ', lastPaymentDate = :payDate' : ''),
          ExpressionAttributeValues: {
            ':newBalance': newBalance,
            ':newTotalPaid': newTotalPaid,
            ':now': new Date().toISOString(),
            ':one': 1,
            ':currentVersion': accountEntity.version,
            ...(credit > 0 ? { ':payDate': date } : {}),
          },
          ExpressionAttributeNames: { '#v': 'version' },
          ConditionExpression: '#v = :currentVersion',
        },
      },
    ];

    return { ledgerEntry, items };
  }

  /**
   * Standalone wrapper: record a ledger entry and update the account
   * balance atomically. Used by callers that don't need to fold the write
   * into a larger transaction (void, refund, invoice auto-issue, manual
   * invoice issue). For the payment flow that DOES need larger
   * transactionality, callers should use `buildLedgerEntryTransactItems`
   * directly — see Sprint C2.B.T4.
   */
  async recordLedgerEntry(
    accountEntity: BillingAccountEntity,
    entryType: LedgerEntryType,
    referenceId: string,
    description: string,
    debit: number,
    credit: number,
    context: RequestContext,
  ): Promise<LedgerEntryEntity> {
    const client = await this.dynamoDBClient.getClient(context.tenantId, context.jwtToken);
    const { ledgerEntry, items } = this.buildLedgerEntryTransactItems(
      accountEntity,
      entryType,
      referenceId,
      description,
      debit,
      credit,
      context,
    );
    await this.dynamoDBClient.transactWrite(client, items);
    return ledgerEntry;
  }
}
