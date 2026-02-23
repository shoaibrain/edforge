/**
 * DynamoDB Client Service for Identity Service
 * 
 * Provides low-level DynamoDB operations with tenant isolation.
 * Uses Token Vending Machine (TVM) for scoped credentials.
 */

import { Injectable, Logger } from '@nestjs/common';
import { 
  DynamoDBClient, 
  TransactWriteItemsCommand,
  TransactWriteItemsCommandInput,
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

    // Merge additional attribute values
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

    const result = await client.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: indexName,
      KeyConditionExpression: keyConditionExpression,
      FilterExpression: filterExpression,
      ExpressionAttributeValues: attrValues,
      ExpressionAttributeNames: expressionAttributeNames,
      Limit: limit,
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

    const result = await client.send(new BatchGetCommand({
      RequestItems: {
        [this.tableName]: {
          Keys: keys,
        },
      },
    }));

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
  }

  /**
   * Transact write items (atomic operations)
   */
  async transactWrite(
    client: DynamoDBDocumentClient,
    transactItems: TransactWriteItemsCommandInput['TransactItems']
  ): Promise<void> {
    const rawClient = DynamoDBDocumentClient.from(
      new DynamoDBClient({ region: process.env.AWS_REGION || 'us-east-1' })
    );

    await rawClient.send(new TransactWriteItemsCommand({
      TransactItems: transactItems,
    }));
  }
}

