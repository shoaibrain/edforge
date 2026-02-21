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
    const region = process.env.AWS_REGION || 'us-east-1';
    this.systemClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region }),
      {
        marshallOptions: {
          removeUndefinedValues: true,
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
    await client.send(new PutCommand({
      TableName: this.tableName,
      Item: item,
      ConditionExpression: conditionExpression,
    }));
  }

  /**
   * Get item by primary key
   */
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
    let keyConditionExpression = 'tenantId = :tenantId';
    const attrValues: Record<string, any> = { ':tenantId': tenantId };

    if (skPrefix) {
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
    await client.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { tenantId, entityKey },
      ConditionExpression: conditionExpression,
    }));
  }

  /**
   * Batch get items
   */
  async batchGetItems<T>(
    client: DynamoDBDocumentClient,
    keys: Array<{ tenantId: string; entityKey: string }>
  ): Promise<T[]> {
    if (keys.length === 0) return [];

    // DynamoDB batch get limit is 100 items
    const chunks: typeof keys[] = [];
    for (let i = 0; i < keys.length; i += 100) {
      chunks.push(keys.slice(i, i + 100));
    }

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

    return results;
  }

  /**
   * Batch write items
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

    for (const chunk of chunks) {
      await client.send(new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: chunk,
        },
      }));
    }
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

    await client.send(new TransactWriteCommand({
      TransactItems: transactItems,
    }));
  }
}

