/**
 * DynamoDB Client Service for Identity Service
 *
 * Provides low-level DynamoDB operations with tenant isolation.
 * Uses Token Vending Machine (TVM) for scoped credentials.
 */

import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import {
  DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  QueryCommand,
  UpdateCommand,
  DeleteCommand,
  BatchGetCommand,
  BatchWriteCommand,
  TransactWriteCommand,
  TransactWriteCommandInput,
} from '@aws-sdk/lib-dynamodb';
import { TokenVendingMachine } from '@app/auth/token-vending-machine';
import { PaginatedResult } from '../entities/base.entity';

@Injectable()
export class DynamoDBClientService {
  private readonly logger = new Logger(DynamoDBClientService.name);
  private readonly tableName: string;

  constructor() {
    this.tableName = process.env.TABLE_NAME || 'edforge-identity';
    this.logger.log(`DynamoDB table: ${this.tableName}`);
  }

  /**
   * Get table name
   */
  getTableName(): string {
    return this.tableName;
  }

  /**
   * Get authenticated DynamoDB client for tenant
   */
  async getClient(tenantId: string, jwtToken: string): Promise<DynamoDBDocumentClient> {
    const tvm = new TokenVendingMachine(false);
    const credsJson = await tvm.assumeRole(jwtToken, 3600);
    const creds = JSON.parse(credsJson);

    const region = process.env.AWS_REGION || 'us-east-1';

    return DynamoDBDocumentClient.from(
      new DynamoDBClient({
        region,
        credentials: {
          accessKeyId: creds.AccessKeyId,
          secretAccessKey: creds.SecretAccessKey,
          sessionToken: creds.SessionToken,
        },
      }),
      {
        marshallOptions: {
          removeUndefinedValues: true,
        },
      }
    );
  }

  /**
   * Get a simple client without TVM (for system operations)
   */
  getSystemClient(): DynamoDBDocumentClient {
    const region = process.env.AWS_REGION || 'us-east-1';

    return DynamoDBDocumentClient.from(
      new DynamoDBClient({ region }),
      {
        marshallOptions: {
          removeUndefinedValues: true,
        },
      }
    );
  }

  /**
   * Run a DynamoDB op, remapping a cross-tenant IAM denial to a 403.
   *
   * The per-tenant ABAC client (`getClient`) holds STS credentials scoped by
   * `custom:tenantId` via an IAM `LeadingKeys` condition. Touching a row whose
   * `tenantId` partition key is not the session's tenant makes DynamoDB return
   * `AccessDeniedException` — a cross-tenant access attempt, not a server
   * fault — which would otherwise surface as a `500`. Remap it to
   * `403 CROSS_TENANT_FORBIDDEN`. **Only** `AccessDeniedException` is remapped;
   * every other error (incl. `ConditionalCheckFailedException`) propagates
   * unchanged so optimistic-locking / conditional-write semantics are untouched.
   */
  private async withTenantGuard<T>(
    op: () => Promise<T>,
    requestedTenantId?: string,
  ): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if ((err as { name?: string })?.name === 'AccessDeniedException') {
        this.logger.warn(
          `Cross-tenant access denied${requestedTenantId ? ` (requested tenant ${requestedTenantId})` : ''}`,
        );
        // `requestedTenantId` goes under `details` because GlobalExceptionFilter
        // only propagates errorCode/message/details from an HttpException payload
        // — a top-level field would be dropped from the wire response.
        throw new ForbiddenException({
          errorCode: 'CROSS_TENANT_FORBIDDEN',
          message: 'Access to the requested resource is denied for this tenant.',
          ...(requestedTenantId ? { details: { requestedTenantId } } : {}),
        });
      }
      throw err;
    }
  }

  /**
   * Put item
   */
  async putItem<T extends Record<string, any>>(
    client: DynamoDBDocumentClient,
    item: T,
    conditionExpression?: string
  ): Promise<void> {
    await this.withTenantGuard(
      () => client.send(new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: conditionExpression,
      })),
      item?.tenantId,
    );
  }

  /**
   * Get item by primary key
   */
  async getItem<T>(
    client: DynamoDBDocumentClient,
    tenantId: string,
    entityKey: string
  ): Promise<T | null> {
    const result = await this.withTenantGuard(
      () => client.send(new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, entityKey },
      })),
      tenantId,
    );

    return (result.Item as T) || null;
  }

  /**
   * Query items by partition key and optional sort key prefix
   */
  async query<T>(
    client: DynamoDBDocumentClient,
    tenantId: string,
    skPrefix?: string,
    filterExpression?: string,
    expressionAttributeValues?: Record<string, any>,
    expressionAttributeNames?: Record<string, string>,
    limit?: number,
    exclusiveStartKey?: Record<string, any>,
    // Sort-key scan direction. Undefined → DynamoDB default (ascending), which
    // preserves every existing caller. Pass false for descending (newest-first)
    // when the sort key is a timestamp and `limit` must select the LATEST rows,
    // not the oldest — otherwise Limit is applied to the ascending head.
    scanIndexForward?: boolean
  ): Promise<PaginatedResult<T>> {
    let keyConditionExpression = 'tenantId = :tenantId';
    const attrValues: Record<string, any> = { ':tenantId': tenantId };

    if (skPrefix) {
      keyConditionExpression += ' AND begins_with(entityKey, :skPrefix)';
      attrValues[':skPrefix'] = skPrefix;
    }

    // Merge additional attribute values
    if (expressionAttributeValues) {
      Object.assign(attrValues, expressionAttributeValues);
    }

    const result = await this.withTenantGuard(
      () => client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: keyConditionExpression,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: attrValues,
        ExpressionAttributeNames: expressionAttributeNames,
        Limit: limit ? limit + 1 : undefined,
        ExclusiveStartKey: exclusiveStartKey,
        ScanIndexForward: scanIndexForward,
      })),
      tenantId,
    );

    const items = (result.Items || []) as T[];
    const hasMore = limit ? items.length > limit : false;
    const returnItems = hasMore ? items.slice(0, limit) : items;

    return {
      items: returnItems,
      lastEvaluatedKey: result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : undefined,
      hasMore,
    };
  }

  /**
   * Query by GSI
   */
  async queryGSI<T>(
    client: DynamoDBDocumentClient,
    indexName: string,
    pkValue: string,
    skValue?: string,
    skOperator: 'eq' | 'begins_with' = 'eq',
    filterExpression?: string,
    expressionAttributeValues?: Record<string, any>,
    expressionAttributeNames?: Record<string, string>,
    limit?: number,
    exclusiveStartKey?: Record<string, any>
  ): Promise<PaginatedResult<T>> {
    const lowerIndex = indexName.toLowerCase();
    const pkName = `${lowerIndex}pk`;
    const skName = `${lowerIndex}sk`;

    let keyConditionExpression = `${pkName} = :pkValue`;
    const attrValues: Record<string, any> = { ':pkValue': pkValue };

    if (skValue) {
      if (skOperator === 'begins_with') {
        keyConditionExpression += ` AND begins_with(${skName}, :skValue)`;
      } else {
        keyConditionExpression += ` AND ${skName} = :skValue`;
      }
      attrValues[':skValue'] = skValue;
    }

    if (expressionAttributeValues) {
      Object.assign(attrValues, expressionAttributeValues);
    }

    const result = await this.withTenantGuard(
      () => client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression: keyConditionExpression,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: attrValues,
        ExpressionAttributeNames: expressionAttributeNames,
        Limit: limit,
        ExclusiveStartKey: exclusiveStartKey,
      })),
    );

    return {
      items: (result.Items || []) as T[],
      lastEvaluatedKey: result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : undefined,
      hasMore: !!result.LastEvaluatedKey,
    };
  }

  /**
   * Update item
   */
  async updateItem<T>(
    client: DynamoDBDocumentClient,
    tenantId: string,
    entityKey: string,
    updateExpression: string,
    expressionAttributeValues: Record<string, any>,
    conditionExpression?: string,
    expressionAttributeNames?: Record<string, string>
  ): Promise<T> {
    const result = await this.withTenantGuard(
      () => client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, entityKey },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: expressionAttributeNames,
        ConditionExpression: conditionExpression,
        ReturnValues: 'ALL_NEW',
      })),
      tenantId,
    );

    return result.Attributes as T;
  }

  /**
   * Delete item
   */
  async deleteItem(
    client: DynamoDBDocumentClient,
    tenantId: string,
    entityKey: string,
    conditionExpression?: string
  ): Promise<void> {
    await this.withTenantGuard(
      () => client.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, entityKey },
        ConditionExpression: conditionExpression,
      })),
      tenantId,
    );
  }

  /**
   * Batch get items
   */
  async batchGetItems<T>(
    client: DynamoDBDocumentClient,
    keys: Array<{ tenantId: string; entityKey: string }>
  ): Promise<T[]> {
    if (keys.length === 0) return [];

    const result = await this.withTenantGuard(
      () => client.send(new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: keys,
          },
        },
      })),
    );

    return (result.Responses?.[this.tableName] || []) as T[];
  }

  /**
   * Batch write items with retry logic for unprocessed items.
   * Handles DynamoDB's 25-item-per-batch limit, retries unprocessed items
   * with exponential backoff, and throttles between chunks.
   */
  async batchWriteItems(
    client: DynamoDBDocumentClient,
    items: Array<{ PutRequest?: { Item: any }; DeleteRequest?: { Key: any } }>
  ): Promise<void> {
    if (items.length === 0) return;

    // DynamoDB batch write limit is 25 items
    const chunks: typeof items[] = [];
    for (let i = 0; i < items.length; i += 25) {
      chunks.push(items.slice(i, i + 25));
    }

    for (let c = 0; c < chunks.length; c++) {
      let unprocessed: typeof items | undefined = chunks[c];
      let attempt = 0;
      const maxRetries = 6;

      while (unprocessed && unprocessed.length > 0) {
        if (attempt >= maxRetries) {
          throw new Error(
            `batchWriteItems failed: ${unprocessed.length} items remained unprocessed after ${maxRetries} retries`,
          );
        }

        if (attempt > 0) {
          const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 50, 5000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }

        const result = await this.withTenantGuard(
          () => client.send(new BatchWriteCommand({
            RequestItems: {
              [this.tableName]: unprocessed,
            },
          })),
        );

        unprocessed = result.UnprocessedItems?.[this.tableName] as typeof items | undefined;
        attempt++;
      }

      // Throttle between chunks to spread write load
      if (c < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  /**
   * Transact write items (atomic operations).
   *
   * Uses a task-role-scoped DocumentClient (not the per-tenant ABAC client)
   * because the tenant IAM policy lacks `dynamodb:TransactWriteItems`.
   * The task role retains broader DDB access, and we rely on the
   * application-level `tenantId` partition key + each item's
   * `ConditionExpression` to maintain isolation.
   *
   * **Command type (Sprint C4 hotfix #3):** uses `TransactWriteCommand`
   * from `@aws-sdk/lib-dynamodb` (the high-level DocumentClient command),
   * NOT `TransactWriteItemsCommand` from `@aws-sdk/client-dynamodb` (the
   * low-level one). The low-level command expects pre-marshalled
   * `AttributeValue` payloads (`{ S: '…' }`, `{ N: '…' }`, etc.); the
   * DocumentClient's auto-marshall + `removeUndefinedValues` middleware
   * does NOT run on it, so passing plain JS objects with optional fields
   * (CalendarDate has ~10) produces "Unexpected value type in payload"
   * — observed in prod 2026-05-17 during the Sprint C4 deploy smoke.
   * The high-level `TransactWriteCommand` works the same way for the
   * caller (plain JS object input) but DOES run through the
   * marshaller. Sibling services (academics/finance) already use this
   * command — identity was the outlier.
   *
   * Not wrapped by `withTenantGuard`: this uses the broad task-role client,
   * not the per-tenant ABAC client, so a DDB `AccessDeniedException` here is
   * not the cross-tenant signal the remap targets.
   */
  async transactWrite(
    client: DynamoDBDocumentClient,
    transactItems: TransactWriteCommandInput['TransactItems']
  ): Promise<void> {
    const rawClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' }),
      {
        marshallOptions: {
          removeUndefinedValues: true,
          convertEmptyValues: false,
        },
      }
    );

    await rawClient.send(new TransactWriteCommand({
      TransactItems: transactItems,
    }));
  }
}
