import { Injectable, Logger } from '@nestjs/common';
import { DynamoDBClient, DynamoDBClientConfig } from '@aws-sdk/client-dynamodb';
import { 
  DynamoDBDocumentClient, 
  PutCommand, 
  GetCommand, 
  UpdateCommand, 
  DeleteCommand, 
  QueryCommand, 
  ScanCommand,
  BatchGetCommand,
  BatchWriteCommand,
  TransactWriteCommand
} from '@aws-sdk/lib-dynamodb';
import {
  ConditionalCheckFailedException,
  ResourceNotFoundException,
  ProvisionedThroughputExceededException,
  ThrottlingException
} from '@aws-sdk/client-dynamodb';

@Injectable()
export class DynamoDBClientService {
  private readonly logger = new Logger(DynamoDBClientService.name);
  private readonly client: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor() {
    // Configure DynamoDB client
    const config: DynamoDBClientConfig = {
      region: process.env.AWS_REGION || 'us-east-1',
      maxAttempts: 3,
      retryMode: 'adaptive'
    };

    const dynamoClient = new DynamoDBClient(config);
    this.client = DynamoDBDocumentClient.from(dynamoClient, {
      marshallOptions: {
        convertClassInstanceToMap: true,
        removeUndefinedValues: true,
        convertEmptyValues: true
      },
      unmarshallOptions: {
        wrapNumbers: false
      }
    });
    this.tableName = process.env.TABLE_NAME || 'school-table-v2-basic';
    
    this.logger.log(`DynamoDB client initialized for table: ${this.tableName}`);
  }

  /**
   * Put item to DynamoDB
   */
  async putItem(item: any): Promise<void> {
    try {
      const command = new PutCommand({
        TableName: this.tableName,
        Item: item,
        ConditionExpression: 'attribute_not_exists(entityKey)'
      });

      await this.client.send(command);
      this.logger.debug(`Item put successfully: ${item.entityKey}`);
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        this.logger.warn(`Item already exists: ${item.entityKey}`);
        throw new Error('Item already exists');
      }
      this.handleDynamoError('putItem', error);
    }
  }

  /**
   * Get item from DynamoDB
   */
  async getItem(tenantId: string, entityKey: string): Promise<any | null> {
    try {
      const command = new GetCommand({
        TableName: this.tableName,
        Key: {
          tenantId,
          entityKey
        }
      });

      const result = await this.client.send(command);
      return result.Item || null;
    } catch (error) {
      this.handleDynamoError('getItem', error);
      return null;
    }
  }

  /**
   * Update item in DynamoDB
   */
  async updateItem(
    tenantId: string, 
    entityKey: string, 
    updateExpression: string, 
    expressionAttributeValues: any,
    conditionExpression?: string
  ): Promise<any> {
    try {
      const command = new UpdateCommand({
        TableName: this.tableName,
        Key: {
          tenantId,
          entityKey
        },
        UpdateExpression: updateExpression,
        ExpressionAttributeValues: expressionAttributeValues,
        ConditionExpression: conditionExpression,
        ReturnValues: 'ALL_NEW'
      });

      const result = await this.client.send(command);
      this.logger.debug(`Item updated successfully: ${entityKey}`);
      return result.Attributes;
    } catch (error) {
      if (error instanceof ConditionalCheckFailedException) {
        this.logger.warn(`Conditional check failed for update: ${entityKey}`);
        throw new Error('Update condition not met');
      }
      this.handleDynamoError('updateItem', error);
    }
  }

  /**
   * Delete item from DynamoDB
   */
  async deleteItem(tenantId: string, entityKey: string): Promise<void> {
    try {
      const command = new DeleteCommand({
        TableName: this.tableName,
        Key: {
          tenantId,
          entityKey
        }
      });

      await this.client.send(command);
      this.logger.debug(`Item deleted successfully: ${entityKey}`);
    } catch (error) {
      this.handleDynamoError('deleteItem', error);
    }
  }

  /**
   * Query items using GSI
   */
  async queryGSI(
    indexName: string,
    partitionKey: string,
    sortKey?: string,
    sortKeyCondition?: string,
    filterExpression?: string,
    expressionAttributeValues?: any,
    limit?: number
  ): Promise<any[]> {
    try {
      const queryParams: any = {
        TableName: this.tableName,
        IndexName: indexName,
        KeyConditionExpression: `gsi${indexName.slice(-1)}pk = :pk`,
        ExpressionAttributeValues: {
          ':pk': partitionKey,
          ...expressionAttributeValues
        }
      };

      if (sortKey) {
        if (sortKeyCondition === 'begins_with') {
          queryParams.KeyConditionExpression += ` AND begins_with(gsi${indexName.slice(-1)}sk, :sk)`;
          queryParams.ExpressionAttributeValues[':sk'] = sortKey;
        } else if (sortKeyCondition === 'between') {
          queryParams.KeyConditionExpression += ` AND gsi${indexName.slice(-1)}sk BETWEEN :sk_start AND :sk_end`;
        } else {
          queryParams.KeyConditionExpression += ` AND gsi${indexName.slice(-1)}sk = :sk`;
          queryParams.ExpressionAttributeValues[':sk'] = sortKey;
        }
      }

      if (filterExpression) {
        queryParams.FilterExpression = filterExpression;
      }

      if (limit) {
        queryParams.Limit = limit;
      }

      const command = new QueryCommand(queryParams);
      const result = await this.client.send(command);
      
      this.logger.debug(`Query executed on ${indexName}: ${result.Items?.length || 0} items returned`);
      return result.Items || [];
    } catch (error) {
      this.handleDynamoError('queryGSI', error);
      return [];
    }
  }

  /**
   * Batch get items
   */
  async batchGetItems(keys: Array<{tenantId: string, entityKey: string}>): Promise<any[]> {
    try {
      const command = new BatchGetCommand({
        RequestItems: {
          [this.tableName]: {
            Keys: keys
          }
        }
      });

      const result = await this.client.send(command);
      return result.Responses?.[this.tableName] || [];
    } catch (error) {
      this.handleDynamoError('batchGetItems', error);
      return [];
    }
  }

  /**
   * Batch write items
   */
  async batchWriteItems(items: any[]): Promise<void> {
    try {
      const putRequests = items.map(item => ({
        PutRequest: { Item: item }
      }));

      const command = new BatchWriteCommand({
        RequestItems: {
          [this.tableName]: putRequests
        }
      });

      await this.client.send(command);
      this.logger.debug(`Batch write completed: ${items.length} items`);
    } catch (error) {
      this.handleDynamoError('batchWriteItems', error);
    }
  }

  /**
   * Transaction write
   */
  async transactWrite(transactItems: any[]): Promise<void> {
    try {
      const command = new TransactWriteCommand({
        TransactItems: transactItems
      });

      await this.client.send(command);
      this.logger.debug(`Transaction completed: ${transactItems.length} operations`);
    } catch (error) {
      this.handleDynamoError('transactWrite', error);
    }
  }

  /**
   * Handle DynamoDB errors
   */
  private handleDynamoError(operation: string, error: any): never {
    this.logger.error(`DynamoDB ${operation} failed:`, {
      error: error.message,
      code: error.name,
      requestId: error.$metadata?.requestId
    });

    if (error instanceof ResourceNotFoundException) {
      throw new Error('DynamoDB table not found');
    } else if (error instanceof ProvisionedThroughputExceededException) {
      throw new Error('DynamoDB throughput exceeded');
    } else if (error instanceof ThrottlingException) {
      throw new Error('DynamoDB throttled');
    } else {
      throw new Error(`DynamoDB operation failed: ${error.message}`);
    }
  }

  /**
   * Get table name
   */
  getTableName(): string {
    return this.tableName;
  }
}
