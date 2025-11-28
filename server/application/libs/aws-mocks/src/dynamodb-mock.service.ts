/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * DynamoDB Mock Service - In-memory implementation for testing
 */

import { Injectable } from '@nestjs/common';
import {
  PutItemInput,
  PutItemOutput,
  GetItemInput,
  GetItemOutput,
  QueryInput,
  QueryOutput,
  UpdateItemInput,
  UpdateItemOutput,
  DeleteItemInput,
  DeleteItemOutput,
  BatchGetItemInput,
  BatchGetItemOutput,
  BatchWriteItemInput,
  BatchWriteItemOutput
} from '@aws-sdk/client-dynamodb';

/**
 * In-memory DynamoDB mock for unit and integration testing
 * Simulates DynamoDB behavior with Map-based storage
 */
@Injectable()
export class MockDynamoDBService {
  private store = new Map<string, any>();
  private gsiStore = new Map<string, any[]>(); // For GSI queries

  /**
   * Clear all stored data
   */
  clear(): void {
    this.store.clear();
    this.gsiStore.clear();
  }

  /**
   * Get all items (for debugging)
   */
  getAllItems(): any[] {
    return Array.from(this.store.values());
  }

  /**
   * Put item into store
   */
  async putItem(params: PutItemInput): Promise<PutItemOutput> {
    const key = this.buildKey(params.TableName!, params.Item);
    this.store.set(key, params.Item);
    
    // Index for GSI queries
    this.indexItem(params.Item, params.TableName!);
    
    return { Attributes: params.Item };
  }

  /**
   * Get item from store
   */
  async getItem(params: GetItemInput): Promise<GetItemOutput> {
    const key = this.buildKey(params.TableName!, params.Key);
    const item = this.store.get(key);
    return { Item: item };
  }

  /**
   * Query items (simplified - supports GSI queries)
   */
  async query(params: QueryInput): Promise<QueryOutput> {
    const items: any[] = [];
    
    if (params.IndexName) {
      // GSI query
      const gsiKey = `${params.TableName}#${params.IndexName}#${this.extractKeyValue(params.KeyConditionExpression || '')}`;
      items.push(...(this.gsiStore.get(gsiKey) || []));
    } else {
      // Primary key query
      const prefix = this.extractKeyValue(params.KeyConditionExpression || '');
      for (const [key, value] of this.store.entries()) {
        if (key.startsWith(`${params.TableName}#${prefix}`)) {
          items.push(value);
        }
      }
    }

    // Apply filter expression (simplified)
    let filteredItems = items;
    if (params.FilterExpression) {
      // Basic filter support - can be enhanced
      filteredItems = items.filter(item => this.evaluateFilter(item, params.FilterExpression || ''));
    }

    return {
      Items: filteredItems,
      Count: filteredItems.length,
      ScannedCount: items.length
    };
  }

  /**
   * Update item in store
   */
  async updateItem(params: UpdateItemInput): Promise<UpdateItemOutput> {
    const key = this.buildKey(params.TableName!, params.Key);
    const existingItem = this.store.get(key) || {};
    
    // Merge updates (simplified - real DynamoDB uses UpdateExpression)
    const updatedItem = { ...existingItem, ...params.AttributeUpdates };
    this.store.set(key, updatedItem);
    this.indexItem(updatedItem, params.TableName!);
    
    return { Attributes: updatedItem };
  }

  /**
   * Delete item from store
   */
  async deleteItem(params: DeleteItemInput): Promise<DeleteItemOutput> {
    const key = this.buildKey(params.TableName!, params.Key);
    const item = this.store.get(key);
    this.store.delete(key);
    return { Attributes: item };
  }

  /**
   * Batch get items
   */
  async batchGetItem(params: BatchGetItemInput): Promise<BatchGetItemOutput> {
    const responses: Record<string, any[]> = {};
    
    for (const [tableName, keys] of Object.entries(params.RequestItems)) {
      const items: any[] = [];
      for (const key of keys.Keys || []) {
        const itemKey = this.buildKey(tableName, key);
        const item = this.store.get(itemKey);
        if (item) {
          items.push(item);
        }
      }
      responses[tableName] = items;
    }
    
    return { Responses: responses };
  }

  /**
   * Batch write items
   */
  async batchWriteItem(params: BatchWriteItemInput): Promise<BatchWriteItemOutput> {
    for (const [tableName, requests] of Object.entries(params.RequestItems)) {
      for (const request of requests) {
        if (request.PutRequest) {
          await this.putItem({
            TableName: tableName,
            Item: request.PutRequest.Item
          });
        } else if (request.DeleteRequest) {
          await this.deleteItem({
            TableName: tableName,
            Key: request.DeleteRequest.Key
          });
        }
      }
    }
    
    return {};
  }

  /**
   * Build composite key from table name and item key
   */
  private buildKey(tableName: string, key: any): string {
    const tenantId = key.tenantId?.S || key.tenantId;
    const entityKey = key.entityKey?.S || key.entityKey;
    return `${tableName}#${tenantId}#${entityKey}`;
  }

  /**
   * Extract key value from KeyConditionExpression (simplified)
   */
  private extractKeyValue(expression: string): string {
    // Simple extraction - can be enhanced for complex expressions
    const match = expression.match(/= :(\w+)/);
    return match ? match[1] : '';
  }

  /**
   * Evaluate filter expression (simplified)
   */
  private evaluateFilter(item: any, filterExpression: string): boolean {
    // Basic filter support - can be enhanced
    // For now, return true (no filtering)
    return true;
  }

  /**
   * Index item for GSI queries
   */
  private indexItem(item: any, tableName: string): void {
    // Extract GSI keys from item (simplified)
    if (item.gsi1pk && item.gsi1sk) {
      const gsiKey = `${tableName}#gsi1#${item.gsi1pk.S || item.gsi1pk}`;
      if (!this.gsiStore.has(gsiKey)) {
        this.gsiStore.set(gsiKey, []);
      }
      this.gsiStore.get(gsiKey)!.push(item);
    }
  }
}

