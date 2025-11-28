/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Athena Mock Service - Mock query execution for testing
 */

import { Injectable } from '@nestjs/common';
import {
  StartQueryExecutionCommandInput,
  StartQueryExecutionCommandOutput,
  GetQueryExecutionCommandInput,
  GetQueryExecutionCommandOutput,
  GetQueryResultsCommandInput,
  GetQueryResultsCommandOutput,
  QueryExecutionState
} from '@aws-sdk/client-athena';

export interface MockQueryResult {
  queryExecutionId: string;
  rows: any[];
  columnInfo: Array<{ name: string; type: string }>;
}

/**
 * In-memory Athena mock for unit and integration testing
 * Allows pre-defining query results for testing
 */
@Injectable()
export class MockAthenaService {
  private queryResults = new Map<string, MockQueryResult>();
  private queryStates = new Map<string, QueryExecutionState>();

  /**
   * Register a query result for a specific query pattern
   */
  registerQueryResult(queryPattern: string | RegExp, result: MockQueryResult): void {
    const key = queryPattern instanceof RegExp ? queryPattern.toString() : queryPattern;
    this.queryResults.set(key, result);
    this.queryStates.set(result.queryExecutionId, QueryExecutionState.SUCCEEDED);
  }

  /**
   * Register a query result by execution ID
   */
  registerQueryResultById(queryExecutionId: string, result: MockQueryResult): void {
    this.queryResults.set(queryExecutionId, result);
    this.queryStates.set(queryExecutionId, QueryExecutionState.SUCCEEDED);
  }

  /**
   * Set query execution state
   */
  setQueryState(queryExecutionId: string, state: QueryExecutionState): void {
    this.queryStates.set(queryExecutionId, state);
  }

  /**
   * Clear all registered results
   */
  clear(): void {
    this.queryResults.clear();
    this.queryStates.clear();
  }

  /**
   * Start query execution (mock)
   */
  async startQueryExecution(
    params: StartQueryExecutionCommandInput
  ): Promise<StartQueryExecutionCommandOutput> {
    // Find matching query result
    const queryString = params.QueryString || '';
    let queryExecutionId: string | undefined;
    let result: MockQueryResult | undefined;

    // Try to find by query pattern
    for (const [pattern, res] of this.queryResults.entries()) {
      if (pattern.startsWith('/') && pattern.endsWith('/')) {
        // Regex pattern
        const regex = new RegExp(pattern.slice(1, -1));
        if (regex.test(queryString)) {
          queryExecutionId = res.queryExecutionId;
          result = res;
          break;
        }
      } else if (queryString.includes(pattern)) {
        // String pattern
        queryExecutionId = res.queryExecutionId;
        result = res;
        break;
      }
    }

    // If no match, generate new execution ID
    if (!queryExecutionId) {
      queryExecutionId = `mock-query-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      this.queryStates.set(queryExecutionId, QueryExecutionState.RUNNING);
    }

    return {
      QueryExecutionId: queryExecutionId
    };
  }

  /**
   * Get query execution status (mock)
   */
  async getQueryExecution(
    params: GetQueryExecutionCommandInput
  ): Promise<GetQueryExecutionCommandOutput> {
    const queryExecutionId = params.QueryExecutionId || '';
    const state = this.queryStates.get(queryExecutionId) || QueryExecutionState.RUNNING;

    return {
      QueryExecution: {
        QueryExecutionId: queryExecutionId,
        Status: {
          State: state,
          StateChangeReason: state === QueryExecutionState.FAILED ? 'Mock failure' : undefined
        }
      }
    };
  }

  /**
   * Get query results (mock)
   */
  async getQueryResults(
    params: GetQueryResultsCommandInput
  ): Promise<GetQueryResultsCommandOutput> {
    const queryExecutionId = params.QueryExecutionId || '';
    const result = this.queryResults.get(queryExecutionId);

    if (!result) {
      throw new Error(`No result registered for query execution ID: ${queryExecutionId}`);
    }

    // Convert rows to Athena format
    const rows = result.rows.map((row, index) => {
      if (index === 0) {
        // Header row
        return {
          Data: result.columnInfo.map(col => ({ VarCharValue: col.name }))
        };
      }
      return {
        Data: Object.values(row).map(val => ({ VarCharValue: String(val) }))
      };
    });

    return {
      ResultSet: {
        ResultSetMetadata: {
          ColumnInfo: result.columnInfo.map(col => ({
            Name: col.name,
            Type: col.type
          }))
        },
        Rows: rows
      }
    };
  }
}

