/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * CSV Parser Service - Shared library for CSV parsing across all services
 * Phase 5: Advanced Features - Import/Export Functionality
 * 
 * DESIGN RATIONALE:
 * - Reusable across all services (DRY principle)
 * - Consistent CSV parsing and error handling
 * - Lightweight csv-parse library (well-tested)
 * - In-memory parsing for MVP (cost-efficient)
 */

import { Injectable, BadRequestException, Logger } from '@nestjs/common';
// @ts-ignore - csv-parse doesn't have complete TypeScript definitions
import { parse } from 'csv-parse/sync';

export interface CsvParseOptions {
  columns?: boolean | string[];
  skip_empty_lines?: boolean;
  trim?: boolean;
  delimiter?: string;
}

export interface CsvParseResult<T = any> {
  records: T[];
  errors: Array<{ row: number; error: string; data?: any }>;
}

@Injectable()
export class CsvParserService {
  private readonly logger = new Logger(CsvParserService.name);

  /**
   * Parse CSV file buffer to records
   * 
   * @param fileBuffer CSV file buffer
   * @param options Parse options
   * @returns Parsed records and errors
   */
  parse<T = any>(
    fileBuffer: Buffer,
    options: CsvParseOptions = {}
  ): CsvParseResult<T> {
    try {
      const defaultOptions: CsvParseOptions = {
        columns: true, // Use first row as column headers
        skip_empty_lines: true,
        trim: true,
        ...options
      };

      const records = parse(fileBuffer.toString('utf-8'), defaultOptions) as any[] as T[];
      
      this.logger.debug(`Parsed ${records.length} records from CSV file`);

      return {
        records,
        errors: []
      };
    } catch (parseError: any) {
      this.logger.error(`CSV parsing failed: ${parseError.message}`, parseError.stack);
      throw new BadRequestException(`Invalid CSV format: ${parseError.message}`);
    }
  }

  /**
   * Validate CSV records against required fields
   * 
   * @param records Parsed CSV records
   * @param requiredFields Array of required field names
   * @returns Validation errors per row
   */
  validateRequiredFields(
    records: any[],
    requiredFields: string[]
  ): Array<{ row: number; error: string; data?: any }> {
    const errors: Array<{ row: number; error: string; data?: any }> = [];

    records.forEach((record, index) => {
      const rowNumber = index + 2; // +2 because index is 0-based and we skip header row

      for (const field of requiredFields) {
        if (!record[field] || record[field].toString().trim() === '') {
          errors.push({
            row: rowNumber,
            error: `Missing required field: ${field}`,
            data: record
          });
          break; // Only report first missing field per row
        }
      }
    });

    return errors;
  }

  /**
   * Convert records to CSV format
   * 
   * @param records Array of objects to convert to CSV
   * @param headers Optional custom headers (defaults to object keys)
   * @returns CSV string
   */
  toCsv(
    records: any[],
    headers?: string[]
  ): string {
    if (records.length === 0) {
      return '';
    }

    // Determine headers
    const csvHeaders = headers || Object.keys(records[0]);

    // Build CSV rows
    const rows: string[] = [];
    
    // Header row
    rows.push(csvHeaders.map(h => this.escapeCsvField(h)).join(','));

    // Data rows
    records.forEach(record => {
      const row = csvHeaders.map(header => {
        const value = record[header];
        return this.escapeCsvField(value !== undefined && value !== null ? String(value) : '');
      });
      rows.push(row.join(','));
    });

    return rows.join('\n');
  }

  /**
   * Escape CSV field (handles commas, quotes, newlines)
   */
  private escapeCsvField(field: string): string {
    if (field.includes(',') || field.includes('"') || field.includes('\n')) {
      // Escape quotes by doubling them, then wrap in quotes
      return `"${field.replace(/"/g, '""')}"`;
    }
    return field;
  }
}

