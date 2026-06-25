/**
 * DynamoDB Client Service for Finance Service
 *
 * Provides low-level DynamoDB operations with tenant isolation.
 * Identical pattern to academics service — single-table design.
 */

import { Injectable, Logger, OnApplicationShutdown, ConflictException } from '@nestjs/common';
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
    this.tableName = process.env.TABLE_NAME || 'edforge-finance';
    this.logger.log(`DynamoDB table: ${this.tableName}`);

    const region = process.env.AWS_REGION || 'us-east-1';
    this.systemClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region }),
      { marshallOptions: { removeUndefinedValues: true } }
    );
  }

  onApplicationShutdown(signal?: string): void {
    this.logger.log(`Shutting down DynamoDB client (signal: ${signal || 'none'})`);
    this.systemClient.destroy();
  }

  getTableName(): string {
    return this.tableName;
  }

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
      { marshallOptions: { removeUndefinedValues: true } }
    );
  }

  /**
   * Returns the system DynamoDB client using the ECS task role directly.
   * Bypasses TVM/ABAC tenant isolation — must ONLY be used in background jobs
   * (OverdueDetectionService, PaymentSweepService, BillingReconciliationService),
   * never in request-scoped handlers. For user-initiated requests, use
   * getClient(tenantId, jwtToken) which enforces tenant isolation via STS session tags.
   */
  getSystemClient(): DynamoDBDocumentClient {
    return this.systemClient;
  }

  async putItem<T extends Record<string, any>>(
    client: DynamoDBDocumentClient,
    item: T,
    conditionExpression?: string
  ): Promise<void> {
    await client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: conditionExpression,
    }));
  }

  async getItem<T>(
    client: DynamoDBDocumentClient,
    tenantId: string,
    entityKey: string
  ): Promise<T | null> {
    const result = await client.send(new GetCommand({
      TableName: this.tableName,
      Key: { tenantId, entityKey },
    }));
    return (result.Item as T) || null;
  }

  async query<T>(
    client: DynamoDBDocumentClient,
    tenantId: string,
    skPrefix?: string,
    filterExpression?: string,
    expressionAttributeValues?: Record<string, any>,
    expressionAttributeNames?: Record<string, string>,
    limit?: number,
    exclusiveStartKey?: Record<string, any>,
    /**
     * Sprint 0.3 / Codex P2 — when a caller needs a TRUE SK range
     * query (not a `begins_with` prefix), pass `skBetween` to push
     * the bounds into the KeyConditionExpression as
     * `entityKey BETWEEN :_skLower AND :_skUpper`. This avoids the
     * classic Limit-before-Filter starvation: a tenant with N older
     * rows outside the range cannot push the matching rows past the
     * page boundary because DDB only reads matching rows in the
     * first place.
     *
     * Mutually exclusive with `skPrefix` — if both are supplied,
     * `skBetween` wins and a warning is logged. The audit-event
     * range listing is the only V1 caller; existing prefix-style
     * callers are unaffected.
     */
    skBetween?: { lower: string; upper: string }
  ): Promise<PaginatedResult<T>> {
    let keyConditionExpression = 'tenantId = :tenantId';
    const attrValues: Record<string, any> = { ':tenantId': tenantId };

    if (skBetween) {
      if (skPrefix) {
        // Defensive: silently treating both as valid would yield an
        // invalid KeyConditionExpression; prefer `skBetween` since
        // it's the more specific bound.
        this.logger.warn(
          'DynamoDBClientService.query received both skPrefix and skBetween; ' +
            'using skBetween. Caller should pass only one.',
        );
      }
      keyConditionExpression +=
        ' AND entityKey BETWEEN :_skLower AND :_skUpper';
      attrValues[':_skLower'] = skBetween.lower;
      attrValues[':_skUpper'] = skBetween.upper;
    } else if (skPrefix) {
      keyConditionExpression += ' AND begins_with(entityKey, :skPrefix)';
      attrValues[':skPrefix'] = skPrefix;
    }

    if (expressionAttributeValues) {
      Object.assign(attrValues, expressionAttributeValues);
    }

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

    return {
      items: returnItems,
      lastEvaluatedKey: result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : undefined,
      hasMore,
    };
  }

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
    const pkName = indexName === 'GSI1' ? 'gsi1pk' : indexName === 'GSI2' ? 'gsi2pk' : 'gsi3pk';
    const skName = indexName === 'GSI1' ? 'gsi1sk' : indexName === 'GSI2' ? 'gsi2sk' : 'gsi3sk';

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

    return {
      items: (result.Items || []) as T[],
      lastEvaluatedKey: result.LastEvaluatedKey
        ? Buffer.from(JSON.stringify(result.LastEvaluatedKey)).toString('base64')
        : undefined,
      hasMore: !!result.LastEvaluatedKey,
    };
  }

  async updateItem<T>(
    client: DynamoDBDocumentClient,
    tenantId: string,
    entityKey: string,
    updateExpression: string,
    expressionAttributeValues: Record<string, any>,
    conditionExpression?: string,
    expressionAttributeNames?: Record<string, string>
  ): Promise<T> {
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
      return result.Attributes as T;
    } catch (error: any) {
      if (error.name === 'ConditionalCheckFailedException') {
        throw new ConflictException(
          'Record was modified by another request. Please retry.',
        );
      }
      throw error;
    }
  }

  async deleteItem(
    client: DynamoDBDocumentClient,
    tenantId: string,
    entityKey: string,
    conditionExpression?: string
  ): Promise<void> {
    await client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { tenantId, entityKey },
      ConditionExpression: conditionExpression,
    }));
  }

  async batchGetItems<T>(
    client: DynamoDBDocumentClient,
    keys: Array<{ tenantId: string; entityKey: string }>
  ): Promise<T[]> {
    if (keys.length === 0) return [];

    const chunks: typeof keys[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      chunks.push(keys.slice(i, i + 100));
    }

    const results: T[] = [];
    for (const chunk of chunks) {
      const result = await client.send(new BatchGetCommand({
        RequestItems: {
          [this.tableName]: { Keys: chunk },
        },
      }));
      results.push(...((result.Responses?.[this.tableName] || []) as T[]));
    }

    return results;
  }

  async batchWriteItems(
    client: DynamoDBDocumentClient,
    items: Array<{ PutRequest?: { Item: any }; DeleteRequest?: { Key: any } }>
  ): Promise<void> {
    if (items.length === 0) return;

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

        const result = await client.send(new BatchWriteCommand({
          RequestItems: { [this.tableName]: unprocessed },
        }));
        unprocessed = result.UnprocessedItems?.[this.tableName] as typeof items | undefined;
        attempt++;
      }

      if (c < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
  }

  async transactWrite(
    client: DynamoDBDocumentClient,
    transactItems: TransactWriteCommandInput['TransactItems'],
  ): Promise<void> {
    if (!transactItems || transactItems.length === 0) return;
    await client.send(new TransactWriteCommand({ TransactItems: transactItems }));
  }
}
