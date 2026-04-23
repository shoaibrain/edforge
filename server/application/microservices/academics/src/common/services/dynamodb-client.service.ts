/**
 * DynamoDB Client Service for Academics Service
 * 
 * Provides low-level DynamoDB operations with tenant isolation.
 */

import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
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
export class DynamoDBClientService implements OnApplicationShutdown {
  private readonly logger = new Logger(DynamoDBClientService.name);
  private readonly tableName: string;
  private systemClient: DynamoDBDocumentClient;

  constructor() {
    this.tableName = process.env.TABLE_NAME || 'edforge-academics';
    this.logger.log(`DynamoDB table: ${this.tableName}`);

    // Initialize system client
    // WARNING: removeUndefinedValues silently strips undefined fields from queries/writes.
    // This means passing schoolId=undefined will NOT error — it will silently omit the field,
    // potentially causing queries against malformed keys like "SCHOOL#undefined".
    // All callers MUST validate parameters before passing them to DynamoDB operations.
    const region = process.env.AWS_REGION || 'us-east-1';
    this.systemClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region }),
      {
        marshallOptions: {
          removeUndefinedValues: true, // ⚠️ See warning above
        },
      }
    );
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.log(`Shutting down DynamoDB client (signal: ${signal || 'none'})`);
    this.systemClient.destroy();
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
   * Get system client (for internal operations)
   */
  getSystemClient(): DynamoDBDocumentClient {
    return this.systemClient;
  }

  /**
   * Put item
   */
  async putItem<T extends Record<string, any>>(
    client: DynamoDBDocumentClient,
    item: T,
    conditionExpression?: string
  ): Promise<void> {
    const entityType = item.entityType || 'unknown';
    const entityKey = item.entityKey || 'unknown';
    const start = Date.now();
    this.logger.debug(`putItem: entityType=${entityType} entityKey=${entityKey} condition=${conditionExpression || 'none'}`);
    try {
      await client.send(new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: conditionExpression,
      }));
      this.logger.debug(`putItem: OK entityType=${entityType} entityKey=${entityKey} ${Date.now() - start}ms`);
    } catch (error: any) {
      this.logger.error(`putItem FAILED: entityType=${entityType} entityKey=${entityKey} ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
  }

  /**
   * Get item by primary key
   */
  async getItem<T>(
    client: DynamoDBDocumentClient,
    tenantId: string,
    entityKey: string
  ): Promise<T | null> {
    const start = Date.now();
    this.logger.debug(`getItem: entityKey=${entityKey}`);
    try {
      const result = await client.send(new GetCommand({
        TableName: this.tableName,
        Key: { tenantId, entityKey },
      }));
      const found = !!result.Item;
      this.logger.debug(`getItem: entityKey=${entityKey} found=${found} ${Date.now() - start}ms`);
      return (result.Item as T) || null;
    } catch (error: any) {
      this.logger.error(`getItem FAILED: entityKey=${entityKey} ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
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
    exclusiveStartKey?: Record<string, any>
  ): Promise<PaginatedResult<T>> {
    const start = Date.now();
    this.logger.debug(`query: PK=tenantId skPrefix=${skPrefix || 'none'} filter=${filterExpression || 'none'} limit=${limit || 'none'}`);

    let keyConditionExpression = 'tenantId = :tenantId';
    const attrValues: Record<string, any> = { ':tenantId': tenantId };

    if (skPrefix) {
      keyConditionExpression += ' AND begins_with(entityKey, :skPrefix)';
      attrValues[':skPrefix'] = skPrefix;
    }

    if (expressionAttributeValues) {
      Object.assign(attrValues, expressionAttributeValues);
    }

    try {
      const result = await client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: keyConditionExpression,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: attrValues,
        ExpressionAttributeNames: expressionAttributeNames,
        Limit: limit ? limit + 1 : undefined,
        ExclusiveStartKey: exclusiveStartKey,
      }));

      const items = (result.Items || []) as T[];
      const hasMore = limit ? items.length > limit : false;
      const returnItems = hasMore ? items.slice(0, limit) : items;

      this.logger.debug(`query: skPrefix=${skPrefix || 'none'} ${returnItems.length} items returned hasMore=${hasMore} ${Date.now() - start}ms`);

      return {
        items: returnItems,
        lastEvaluatedKey: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
        hasMore,
      };
    } catch (error: any) {
      this.logger.error(`query FAILED: skPrefix=${skPrefix || 'none'} ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
  }

  /**
   * Query items by partition key with SK range (between) condition.
   * Task 3.3: Enables efficient date-range queries on main table.
   */
  async queryRange<T>(
    client: DynamoDBDocumentClient,
    tenantId: string,
    skStart: string,
    skEnd: string,
    filterExpression?: string,
    expressionAttributeValues?: Record<string, any>,
    expressionAttributeNames?: Record<string, string>,
    limit?: number,
  ): Promise<PaginatedResult<T>> {
    const start = Date.now();
    this.logger.debug(`queryRange: skStart=${skStart} skEnd=${skEnd} filter=${filterExpression || 'none'} limit=${limit || 'none'}`);

    const keyConditionExpression = 'tenantId = :tenantId AND entityKey BETWEEN :skStart AND :skEnd';
    const attrValues: Record<string, any> = {
      ':tenantId': tenantId,
      ':skStart': skStart,
      ':skEnd': skEnd,
    };

    if (expressionAttributeValues) {
      Object.assign(attrValues, expressionAttributeValues);
    }

    try {
      const result = await client.send(new QueryCommand({
        TableName: this.tableName,
        KeyConditionExpression: keyConditionExpression,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: attrValues,
        ExpressionAttributeNames: expressionAttributeNames,
        Limit: limit,
      }));

      const items = (result.Items || []) as T[];
      this.logger.debug(`queryRange: skStart=${skStart} skEnd=${skEnd} ${items.length} items returned hasMore=${!!result.LastEvaluatedKey} ${Date.now() - start}ms`);

      return {
        items,
        lastEvaluatedKey: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
        hasMore: !!result.LastEvaluatedKey,
      };
    } catch (error: any) {
      this.logger.error(`queryRange FAILED: skStart=${skStart} skEnd=${skEnd} ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
  }

  /**
   * Query by GSI
   */
  async queryGSI<T>(
    client: DynamoDBDocumentClient,
    indexName: string,
    pkValue: string,
    skValue?: string,
    skOperator: 'eq' | 'begins_with' | 'between' = 'eq',
    filterExpression?: string,
    expressionAttributeValues?: Record<string, any>,
    expressionAttributeNames?: Record<string, string>,
    limit?: number,
    scanIndexForward: boolean = true,
    exclusiveStartKey?: Record<string, any>
  ): Promise<PaginatedResult<T>> {
    const start = Date.now();
    this.logger.debug(
      `queryGSI: index=${indexName} PK=${pkValue} SK=${skValue || 'none'} op=${skOperator} filter=${filterExpression || 'none'} limit=${limit || 'none'}`,
    );

    // Derive the gsiNpk / gsiNsk attribute names from the index name. Works
    // for GSI1..GSI12 (the full provisioned set). Earlier hardcoded mapping
    // silently mis-routed GSI4+ queries to `gsi3pk` — see the GSI7 EMIS
    // lookup added in Project Midnight Lockin P0.2.
    const indexSuffix = indexName.replace(/^GSI/, '');
    const pkName = `gsi${indexSuffix}pk`;
    const skName = `gsi${indexSuffix}sk`;

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

    try {
      const result = await client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression: keyConditionExpression,
        FilterExpression: filterExpression,
        ExpressionAttributeValues: attrValues,
        ExpressionAttributeNames: expressionAttributeNames,
        Limit: limit,
        ScanIndexForward: scanIndexForward,
        ExclusiveStartKey: exclusiveStartKey,
      }));

      const items = (result.Items || []) as T[];
      this.logger.debug(
        `queryGSI: index=${indexName} PK=${pkValue} SK=${skValue || 'none'} ${items.length} items returned hasMore=${!!result.LastEvaluatedKey} ${Date.now() - start}ms`,
      );

      return {
        items,
        lastEvaluatedKey: result.LastEvaluatedKey
          ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
          : undefined,
        hasMore: !!result.LastEvaluatedKey,
      };
    } catch (error: any) {
      this.logger.error(
        `queryGSI FAILED: index=${indexName} PK=${pkValue} SK=${skValue || 'none'} ${Date.now() - start}ms — ${error.message}`,
      );
      throw error;
    }
  }

  /**
   * Query GSI3 (date-based attendance index) with simplified signature
   */
  async queryGSI3<T>(
    client: DynamoDBDocumentClient,
    gsi3pk: string,
    gsi3skValue: string,
    skOperator: 'eq' | 'begins_with' = 'begins_with',
    limit = 1000,
  ): Promise<PaginatedResult<T>> {
    return this.queryGSI<T>(client, 'GSI3', gsi3pk, gsi3skValue, skOperator, undefined, undefined, undefined, limit);
  }

  /**
   * Query GSI2 (student-centric index) with simplified signature
   */
  async queryGSI2<T>(
    client: DynamoDBDocumentClient,
    gsi2pk: string,
    gsi2skValue: string,
    skOperator: 'eq' | 'begins_with' = 'begins_with',
    limit = 1000,
  ): Promise<PaginatedResult<T>> {
    return this.queryGSI<T>(client, 'GSI2', gsi2pk, gsi2skValue, skOperator, undefined, undefined, undefined, limit);
  }

  /**
   * Query GSI2 with BETWEEN range on sort key
   */
  async queryGSI2Range<T>(
    client: DynamoDBDocumentClient,
    gsi2pk: string,
    skStart: string,
    skEnd: string,
    limit = 1000,
  ): Promise<T[]> {
    const start = Date.now();
    this.logger.debug(`queryGSI2Range: PK=${gsi2pk} skStart=${skStart} skEnd=${skEnd} limit=${limit}`);
    try {
      const result = await client.send(new QueryCommand({
        TableName: this.tableName,
        IndexName: 'GSI2',
        KeyConditionExpression: 'gsi2pk = :pk AND gsi2sk BETWEEN :skStart AND :skEnd',
        ExpressionAttributeValues: {
          ':pk': gsi2pk,
          ':skStart': skStart,
          ':skEnd': skEnd,
        },
        Limit: limit,
      }));
      const items = (result.Items || []) as T[];
      this.logger.debug(`queryGSI2Range: PK=${gsi2pk} ${items.length} items returned ${Date.now() - start}ms`);
      return items;
    } catch (error: any) {
      this.logger.error(`queryGSI2Range FAILED: PK=${gsi2pk} ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
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
    const start = Date.now();
    this.logger.debug(`updateItem: entityKey=${entityKey} condition=${conditionExpression || 'none'}`);
    try {
      const result = await client.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { tenantId, entityKey },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ExpressionAttributeNames: expressionAttributeNames,
        ConditionExpression: conditionExpression,
        ReturnValues: 'ALL_NEW',
      }));
      this.logger.debug(`updateItem: OK entityKey=${entityKey} ${Date.now() - start}ms`);
      return result.Attributes as T;
    } catch (error: any) {
      this.logger.error(`updateItem FAILED: entityKey=${entityKey} ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
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
    const start = Date.now();
    this.logger.debug(`deleteItem: entityKey=${entityKey} condition=${conditionExpression || 'none'}`);
    try {
      await client.send(new DeleteCommand({
        TableName: this.tableName,
        Key: { tenantId, entityKey },
        ConditionExpression: conditionExpression,
      }));
      this.logger.debug(`deleteItem: OK entityKey=${entityKey} ${Date.now() - start}ms`);
    } catch (error: any) {
      this.logger.error(`deleteItem FAILED: entityKey=${entityKey} ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
  }

  /**
   * Batch get items
   */
  async batchGetItems<T>(
    client: DynamoDBDocumentClient,
    keys: Array<{ tenantId: string; entityKey: string }>
  ): Promise<T[]> {
    if (keys.length === 0) return [];

    const start = Date.now();
    this.logger.debug(`batchGetItems: ${keys.length} keys requested`);

    // DynamoDB batch get limit is 100 items
    const chunks: typeof keys[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      chunks.push(keys.slice(i, i + 100));
    }

    try {
      const results: T[] = [];
      for (const chunk of chunks) {
        const result = await client.send(new BatchGetCommand({
          RequestItems: {
            [this.tableName]: {
              Keys: chunk,
            },
          },
        }));

        results.push(...((result.Responses?.[this.tableName] || []) as T[]));
      }

      this.logger.debug(`batchGetItems: ${keys.length} keys requested, ${results.length} items returned (${chunks.length} chunks) ${Date.now() - start}ms`);
      return results;
    } catch (error: any) {
      this.logger.error(`batchGetItems FAILED: ${keys.length} keys ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
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

    const start = Date.now();
    this.logger.debug(`batchWriteItems: ${items.length} items to write`);

    // DynamoDB batch write limit is 25 items
    const chunks: typeof items[] = [];
    for (let i = 0; i < items.length; i += 25) {
      chunks.push(items.slice(i, i + 25));
    }

    try {
      for (let c = 0; c < chunks.length; c++) {
        let unprocessed: typeof items | undefined = chunks[c];
        let attempt = 0;
        const maxRetries = 6;

        while (unprocessed && unprocessed.length > 0) {
          if (attempt >= maxRetries) {
            this.logger.error(`batchWriteItems: ${unprocessed.length} items remained unprocessed after ${maxRetries} retries`);
            throw new Error(
              `batchWriteItems failed: ${unprocessed.length} items remained unprocessed after ${maxRetries} retries`,
            );
          }

          if (attempt > 0) {
            this.logger.debug(`batchWriteItems: retry attempt=${attempt} unprocessed=${unprocessed.length}`);
            const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 50, 5000);
            await new Promise(resolve => setTimeout(resolve, delay));
          }

          const result = await client.send(new BatchWriteCommand({
            RequestItems: {
              [this.tableName]: unprocessed,
            },
          }));

          unprocessed = result.UnprocessedItems?.[this.tableName] as typeof items | undefined;
          attempt++;
        }

        // Throttle between chunks to spread write load
        if (c < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }

      this.logger.debug(`batchWriteItems: OK ${items.length} items written (${chunks.length} chunks) ${Date.now() - start}ms`);
    } catch (error: any) {
      this.logger.error(`batchWriteItems FAILED: ${items.length} items ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
  }

  /**
   * Atomically increment a DDB numeric counter and return the post-increment
   * value. Uses ADD on a reserved attribute; caller owns the item shape.
   *
   * Caller supplies the already-authenticated client (do not cache cross-tenant),
   * the canonical entity key for the counter row, and the delta (default 1).
   * One ConditionalCheckFailed retry for contention; beyond that, throws.
   *
   * The item shape is `{ tenantId, entityKey, counterValue }` plus any
   * additional attributes the caller's `extraSet` map supplies (e.g.,
   * `entityType`, `lastIncrementedAt`). Those are applied via SET in the
   * same UpdateItem call.
   */
  async atomicIncrement(
    client: DynamoDBDocumentClient,
    tenantId: string,
    entityKey: string,
    delta = 1,
    extraSet?: Record<string, any>,
  ): Promise<number> {
    const start = Date.now();
    this.logger.debug(`atomicIncrement: entityKey=${entityKey} delta=${delta}`);

    const exprAttrValues: Record<string, any> = { ':delta': delta };
    let updateExpression = 'ADD counterValue :delta';

    if (extraSet && Object.keys(extraSet).length > 0) {
      const setClauses: string[] = [];
      const exprAttrNames: Record<string, string> = {};
      for (const [key, value] of Object.entries(extraSet)) {
        const safeName = `#${key}`;
        const safeValue = `:${key}`;
        exprAttrNames[safeName] = key;
        exprAttrValues[safeValue] = value;
        setClauses.push(`${safeName} = ${safeValue}`);
      }
      updateExpression += ` SET ${setClauses.join(', ')}`;

      return this.runAtomicIncrement(client, tenantId, entityKey, updateExpression, exprAttrValues, exprAttrNames, start);
    }

    return this.runAtomicIncrement(client, tenantId, entityKey, updateExpression, exprAttrValues, undefined, start);
  }

  private async runAtomicIncrement(
    client: DynamoDBDocumentClient,
    tenantId: string,
    entityKey: string,
    updateExpression: string,
    exprAttrValues: Record<string, any>,
    exprAttrNames: Record<string, string> | undefined,
    start: number,
  ): Promise<number> {
    const maxAttempts = 2;
    let lastError: any;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const result = await client.send(new UpdateCommand({
          TableName: this.tableName,
          Key: { tenantId, entityKey },
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: exprAttrValues,
          ExpressionAttributeNames: exprAttrNames,
          ReturnValues: 'UPDATED_NEW',
        }));

        const post = result.Attributes?.counterValue;
        if (typeof post !== 'number') {
          throw new Error(`atomicIncrement: counterValue missing on UPDATED_NEW response (entityKey=${entityKey})`);
        }
        this.logger.debug(`atomicIncrement: OK entityKey=${entityKey} post=${post} attempt=${attempt} ${Date.now() - start}ms`);
        return post;
      } catch (error: any) {
        lastError = error;
        if (error?.name === 'ConditionalCheckFailedException' && attempt < maxAttempts) {
          this.logger.warn(`atomicIncrement: ConditionalCheckFailed entityKey=${entityKey} attempt=${attempt}, retrying`);
          continue;
        }
        this.logger.error(`atomicIncrement FAILED: entityKey=${entityKey} attempt=${attempt} ${Date.now() - start}ms — ${error.message}`);
        throw error;
      }
    }

    throw lastError;
  }

  /**
   * Transactional write — atomically execute up to 100 operations.
   * Supports Put, Update, Delete, and ConditionCheck within a single transaction.
   */
  async transactWrite(
    client: DynamoDBDocumentClient,
    transactItems: TransactWriteCommandInput['TransactItems'],
  ): Promise<void> {
    if (!transactItems || transactItems.length === 0) return;

    const start = Date.now();
    const opCount = transactItems.length;
    this.logger.debug(`transactWrite: ${opCount} operations`);
    try {
      await client.send(new TransactWriteCommand({
        TransactItems: transactItems,
      }));
      this.logger.debug(`transactWrite: OK ${opCount} operations ${Date.now() - start}ms`);
    } catch (error: any) {
      this.logger.error(`transactWrite FAILED: ${opCount} operations ${Date.now() - start}ms — ${error.message}`);
      throw error;
    }
  }
}

