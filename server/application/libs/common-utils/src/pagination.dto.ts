/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Pagination DTOs - Shared utilities for paginated responses
 * Phase 5: Performance Optimizations
 */

import { IsOptional, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

/**
 * Pagination Query Parameters
 */
export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20; // Default to 20 items per page

  @IsOptional()
  lastEvaluatedKey?: string; // DynamoDB pagination token (base64 encoded)
}

/**
 * Paginated Response Metadata
 */
export interface PaginationMetadata {
  limit: number;
  lastEvaluatedKey?: string;
  hasMore: boolean;
  itemCount: number;
}

/**
 * Standard Paginated Response
 */
export interface PaginatedResponse<T> {
  items: T[];
  pagination: PaginationMetadata;
}

