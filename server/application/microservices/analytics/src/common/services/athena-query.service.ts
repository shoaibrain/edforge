/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Athena Query Service - Execute SQL queries on S3 data lake via Athena
 */

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AthenaClient,
  StartQueryExecutionCommand,
  GetQueryExecutionCommand,
  GetQueryResultsCommand,
  QueryExecutionState,
  QueryExecutionStatus
} from '@aws-sdk/client-athena';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

export interface QueryResult {
  queryExecutionId: string;
  rows: any[];
  columnInfo: Array<{ name: string; type: string }>;
  executionTimeMs?: number;
}

export interface QueryParams {
  [key: string]: string | number | boolean;
}

@Injectable()
export class AthenaQueryService {
  private readonly logger = new Logger(AthenaQueryService.name);
  private readonly athenaClient: AthenaClient;
  private readonly s3Client: S3Client;
  private readonly workgroupName: string;
  private readonly databaseName: string;
  private readonly resultsBucket: string;
  private readonly region: string;

  constructor(private readonly configService: ConfigService) {
    this.region = process.env.AWS_REGION || 'us-east-1';
    this.workgroupName = this.configService.get<string>('ATHENA_WORKGROUP') || 'edforge-analytics-workgroup';
    this.databaseName = this.configService.get<string>('ATHENA_DATABASE') || 'edforge_analytics';
    this.resultsBucket = this.configService.get<string>('ATHENA_RESULTS_BUCKET') || '';

    this.athenaClient = new AthenaClient({
      region: this.region
    });

    this.s3Client = new S3Client({
      region: this.region
    });

    this.logger.log(
      `AthenaQueryService initialized. Workgroup: ${this.workgroupName}, Database: ${this.databaseName}`
    );
  }

  /**
   * Execute a parameterized SQL query on Athena with retry logic
   * 
   * @param query SQL query with parameter placeholders (use ? for parameters)
   * @param params Parameter values to substitute
   * @param timeoutMs Maximum time to wait for query completion (default: 30000ms)
   * @param maxRetries Maximum number of retry attempts for transient errors (default: 3)
   * @returns Query results
   */
  async executeQuery(
    query: string,
    params?: QueryParams,
    timeoutMs: number = 30000,
    maxRetries: number = 3
  ): Promise<QueryResult> {
    const startTime = Date.now();

    // Replace parameters in query
    const finalQuery = this.replaceQueryParams(query, params || {});

    this.logger.debug(`Executing Athena query: ${finalQuery.substring(0, 200)}...`);

    let lastError: any;
    let attempt = 0;

    // Retry loop for transient errors
    while (attempt <= maxRetries) {
      try {
        // Start query execution
      const startCommand = new StartQueryExecutionCommand({
        QueryString: finalQuery,
        QueryExecutionContext: {
          Database: this.databaseName
        },
        WorkGroup: this.workgroupName,
        ResultConfiguration: {
          OutputLocation: `s3://${this.resultsBucket}/`
        }
      });

      const startResponse = await this.athenaClient.send(startCommand);
      const queryExecutionId = startResponse.QueryExecutionId;

      if (!queryExecutionId) {
        throw new Error('Failed to start query execution: No query execution ID returned');
      }

      this.logger.debug(`Query execution started: ${queryExecutionId}`);

      // Wait for query to complete
      const execution = await this.waitForQueryExecution(queryExecutionId, timeoutMs);

      if (execution.Status?.State !== QueryExecutionState.SUCCEEDED) {
        const errorMessage = execution.Status?.StateChangeReason || 'Query execution failed';
        throw new Error(`Query execution failed: ${errorMessage}`);
      }

      // Get query results
      const results = await this.getQueryResults(queryExecutionId);

        const executionTime = Date.now() - startTime;
        this.logger.debug(`Query completed in ${executionTime}ms. Rows: ${results.rows.length}`);

        return {
          queryExecutionId,
          rows: results.rows,
          columnInfo: results.columnInfo,
          executionTimeMs: executionTime
        };
      } catch (error: any) {
        lastError = error;
        attempt++;

        // Check if error is retryable (transient errors)
        const isRetryable = this.isRetryableError(error);
        
        if (!isRetryable || attempt > maxRetries) {
          // Non-retryable error or max retries exceeded
          this.logger.error(
            `Athena query execution failed after ${attempt} attempt(s): ${error.message}`,
            error.stack
          );
          throw error;
        }

        // Calculate exponential backoff delay (1s, 2s, 4s, ...)
        const backoffDelay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
        this.logger.warn(
          `Athena query failed (attempt ${attempt}/${maxRetries}), retrying in ${backoffDelay}ms: ${error.message}`
        );
        
        // Wait before retry
        await new Promise(resolve => setTimeout(resolve, backoffDelay));
      }
    }

    // Should not reach here, but handle edge case
    throw lastError || new Error('Query execution failed after all retries');
  }

  /**
   * Determine if an error is retryable (transient)
   * Retryable errors: throttling, service unavailable, network errors
   * Non-retryable: syntax errors, authentication errors, invalid queries
   */
  private isRetryableError(error: any): boolean {
    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code || error.name || '';

    // Retryable error codes
    const retryableCodes = [
      'ThrottlingException',
      'TooManyRequestsException',
      'ServiceUnavailableException',
      'InternalServerError',
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND'
    ];

    // Retryable error messages
    const retryableMessages = [
      'throttl',
      'rate limit',
      'service unavailable',
      'internal server error',
      'network',
      'timeout',
      'temporary'
    ];

    // Check error code
    if (retryableCodes.some(code => errorCode.includes(code))) {
      return true;
    }

    // Check error message
    if (retryableMessages.some(msg => errorMessage.includes(msg))) {
      return true;
    }

    // Non-retryable errors
    const nonRetryableMessages = [
      'syntax error',
      'invalid query',
      'authentication',
      'unauthorized',
      'forbidden',
      'not found',
      'malformed'
    ];

    if (nonRetryableMessages.some(msg => errorMessage.includes(msg))) {
      return false;
    }

    // Default: retry for unknown errors (conservative approach)
    return true;
  }

  /**
   * Wait for query execution to complete
   */
  private async waitForQueryExecution(
    queryExecutionId: string,
    timeoutMs: number
  ): Promise<QueryExecutionStatus> {
    const startTime = Date.now();
    const pollInterval = 1000; // Poll every 1 second

    while (Date.now() - startTime < timeoutMs) {
      const command = new GetQueryExecutionCommand({
        QueryExecutionId: queryExecutionId
      });

      const response = await this.athenaClient.send(command);
      const status = response.QueryExecution?.Status;

      if (!status) {
        throw new Error('Query execution status not found');
      }

      const state = status.State;

      if (state === QueryExecutionState.SUCCEEDED || state === QueryExecutionState.FAILED || state === QueryExecutionState.CANCELLED) {
        return status;
      }

      // Query still running, wait and poll again
      await new Promise(resolve => setTimeout(resolve, pollInterval));
    }

    throw new Error(`Query execution timeout after ${timeoutMs}ms`);
  }

  /**
   * Get query results from Athena
   */
  private async getQueryResults(queryExecutionId: string): Promise<{
    rows: any[];
    columnInfo: Array<{ name: string; type: string }>;
  }> {
    const rows: any[] = [];
    let nextToken: string | undefined;
    let columnInfo: Array<{ name: string; type: string }> = [];

    do {
      const command = new GetQueryResultsCommand({
        QueryExecutionId: queryExecutionId,
        NextToken: nextToken,
        MaxResults: 1000
      });

      const response = await this.athenaClient.send(command);
      const resultSet = response.ResultSet;

      if (!resultSet) {
        throw new Error('Query result set not found');
      }

      // Extract column metadata from first page
      if (!columnInfo.length && resultSet.ResultSetMetadata?.ColumnInfo) {
        columnInfo = resultSet.ResultSetMetadata.ColumnInfo.map(col => ({
          name: col.Name || '',
          type: col.Type || 'string'
        }));
      }

      // Extract rows
      if (resultSet.Rows) {
        // Skip header row (first row)
        const dataRows = resultSet.Rows.slice(1);
        
        for (const row of dataRows) {
          if (row.Data) {
            const rowData: any = {};
            columnInfo.forEach((col, index) => {
              const cell = row.Data?.[index];
              // Parse cell value based on type
              if (cell?.VarCharValue) {
                const value = cell.VarCharValue;
                // Try to parse as number if column type suggests it
                if (col.type === 'double' || col.type === 'bigint' || col.type === 'int') {
                  rowData[col.name] = value === '' ? null : parseFloat(value);
                } else if (col.type === 'boolean') {
                  rowData[col.name] = value === 'true';
                } else {
                  rowData[col.name] = value;
                }
              } else {
                rowData[col.name] = null;
              }
            });
            rows.push(rowData);
          }
        }
      }

      nextToken = response.NextToken;
    } while (nextToken);

    return { rows, columnInfo };
  }

  /**
   * Replace parameter placeholders in SQL query
   * 
   * Note: This is a simple implementation. For production, consider using
   * a proper SQL parameter binding library or Athena's prepared statements.
   * 
   * Security: This method escapes single quotes to prevent SQL injection.
   * However, parameterized queries are preferred when available.
   */
  private replaceQueryParams(query: string, params: QueryParams): string {
    let finalQuery = query;

    // Replace named parameters (e.g., :tenantId) or positional parameters (e.g., ?)
    Object.keys(params).forEach((key, index) => {
      const value = params[key];
      let escapedValue: string;

      if (typeof value === 'string') {
        // Escape single quotes to prevent SQL injection
        escapedValue = `'${value.replace(/'/g, "''")}'`;
      } else if (typeof value === 'number') {
        escapedValue = value.toString();
      } else if (typeof value === 'boolean') {
        escapedValue = value ? 'true' : 'false';
      } else {
        escapedValue = 'NULL';
      }

      // Replace named parameters :key
      finalQuery = finalQuery.replace(new RegExp(`:${key}\\b`, 'g'), escapedValue);
      
      // Replace positional parameters ? (in order)
      // Note: This is a simple implementation. For complex queries, use named parameters.
      const positionalMatches = finalQuery.match(/\?/g);
      if (positionalMatches && index < positionalMatches.length) {
        finalQuery = finalQuery.replace('?', escapedValue);
      }
    });

    return finalQuery;
  }

  /**
   * Format query results for easier consumption
   */
  formatQueryResults(rawResults: any[]): any[] {
    return rawResults.map(row => {
      const formatted: any = {};
      Object.keys(row).forEach(key => {
        // Convert snake_case to camelCase if needed
        const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        formatted[camelKey] = row[key];
      });
      return formatted;
    });
  }

  /**
   * Build date range partition filters for Athena queries
   * 
   * @param startDate Start date (YYYY-MM-DD)
   * @param endDate End date (YYYY-MM-DD)
   * @returns Object with year, month, day filter conditions
   */
  buildDateRangeFilters(startDate?: string, endDate?: string): {
    yearFilter: string;
    monthFilter: string;
    dayFilter: string;
  } {
    if (!startDate || !endDate) {
      // Default to current year/month if not specified
      const now = new Date();
      const currentYear = now.getFullYear();
      const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
      
      return {
        yearFilter: `year = '${currentYear}'`,
        monthFilter: `month = '${currentMonth}'`,
        dayFilter: `day >= '01' AND day <= '31'`
      };
    }

    const start = new Date(startDate);
    const end = new Date(endDate);

    const startYear = start.getFullYear();
    const startMonth = String(start.getMonth() + 1).padStart(2, '0');
    const startDay = String(start.getDate()).padStart(2, '0');

    const endYear = end.getFullYear();
    const endMonth = String(end.getMonth() + 1).padStart(2, '0');
    const endDay = String(end.getDate()).padStart(2, '0');

    // Build year filter
    let yearFilter: string;
    if (startYear === endYear) {
      yearFilter = `year = '${startYear}'`;
    } else {
      yearFilter = `year >= '${startYear}' AND year <= '${endYear}'`;
    }

    // Build month filter
    let monthFilter: string;
    if (startYear === endYear && startMonth === endMonth) {
      monthFilter = `month = '${startMonth}'`;
    } else if (startYear === endYear) {
      monthFilter = `month >= '${startMonth}' AND month <= '${endMonth}'`;
    } else {
      monthFilter = `(year = '${startYear}' AND month >= '${startMonth}') OR (year = '${endYear}' AND month <= '${endMonth}') OR (year > '${startYear}' AND year < '${endYear}')`;
    }

    // Build day filter
    let dayFilter: string;
    if (startYear === endYear && startMonth === endMonth && startDay === endDay) {
      dayFilter = `day = '${startDay}'`;
    } else if (startYear === endYear && startMonth === endMonth) {
      dayFilter = `day >= '${startDay}' AND day <= '${endDay}'`;
    } else {
      dayFilter = `day >= '01' AND day <= '31'`; // Simplified for cross-month queries
    }

    return { yearFilter, monthFilter, dayFilter };
  }

  /**
   * Check if materialized view data exists for a given date range
   * This helps determine whether to query materialized views or raw event tables
   * 
   * @param viewName Materialized view name (e.g., 'principal_dashboard_view')
   * @param dateRange Optional date range to check
   * @returns True if materialized view has data for the date range
   */
  async checkMaterializedViewExists(
    viewName: string,
    dateRange?: { startDate?: string; endDate?: string }
  ): Promise<boolean> {
    try {
      // Query to check if materialized view has any data
      // Use a simple COUNT query with date filters if provided
      let query = `SELECT COUNT(*) as row_count FROM ${viewName}`;
      
      if (dateRange?.startDate || dateRange?.endDate) {
        const filters = this.buildDateRangeFilters(dateRange.startDate, dateRange.endDate);
        query += ` WHERE ${filters.yearFilter} AND ${filters.monthFilter} AND ${filters.dayFilter}`;
      }
      
      query += ' LIMIT 1';

      const result = await this.executeQuery(query, {}, 10000); // Short timeout for existence check
      
      return result.rows.length > 0 && (result.rows[0].row_count || 0) > 0;
    } catch (error: any) {
      // If view doesn't exist or query fails, return false (fallback to raw tables)
      this.logger.warn(`Materialized view ${viewName} check failed: ${error.message}`);
      return false;
    }
  }

  /**
   * Execute query with performance monitoring
   * Logs query execution time and warns if query exceeds threshold
   */
  async executeQueryWithMonitoring(
    sql: string,
    params?: QueryParams,
    timeoutMs: number = 30000,
    performanceThresholdMs: number = 3000
  ): Promise<QueryResult> {
    const startTime = Date.now();
    
    try {
      const result = await this.executeQuery(sql, params, timeoutMs);
      const executionTime = Date.now() - startTime;
      
      if (executionTime > performanceThresholdMs) {
        this.logger.warn(
          `Query exceeded performance threshold: ${executionTime}ms > ${performanceThresholdMs}ms. ` +
          `Consider using materialized views or optimizing query.`
        );
      } else {
        this.logger.debug(`Query executed in ${executionTime}ms`);
      }
      
      return result;
    } catch (error: any) {
      const executionTime = Date.now() - startTime;
      this.logger.error(
        `Query failed after ${executionTime}ms: ${error.message}`
      );
      throw error;
    }
  }
}

