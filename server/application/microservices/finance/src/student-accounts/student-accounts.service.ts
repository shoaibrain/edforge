import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DynamoDBClientService } from '../common/services/dynamodb-client.service';
import { IdentityClientService } from '../common/services/identity-client.service';
import {
  BillingAccountEntity,
  createBillingAccountEntity,
} from '../common/entities/billing-account.entity';
import { LedgerEntryEntity, createLedgerEntryEntity } from '../common/entities/ledger-entry.entity';
import { EntityKeyBuilder, GSIKeyBuilder, RequestContext } from '../common/entities/base.entity';
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

    if (existing) return existing;

    const entity = createBillingAccountEntity(
      context.tenantId,
      schoolId,
      studentId,
      studentName,
      context.userId,
    );

    // Conditional put to prevent race condition
    try {
      await this.dynamoDBClient.putItem(
        client,
        entity,
        'attribute_not_exists(entityKey)',
      );
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        // Another request created it first — fetch and return
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
      options.cursor ? JSON.parse(Buffer.from(options.cursor, 'base64').toString()) : undefined,
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

    // Query GSI1 for the school, filter by accountId
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
      options.cursor ? JSON.parse(Buffer.from(options.cursor, 'base64').toString()) : undefined,
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
   * Record a ledger entry and update the account balance atomically.
   * Uses DynamoDB TransactWriteItems to ensure consistency.
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

    // Atomic transaction: insert ledger entry + update account balance
    await this.dynamoDBClient.transactWrite(client, [
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
    ]);

    return ledgerEntry;
  }
}
