/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Test Data Factory - Centralized test data creation
 */

import { v4 as uuid } from 'uuid';

/**
 * Create a test UUID
 */
export function createTestId(): string {
  return uuid();
}

/**
 * Create a test date string
 */
export function createTestDate(offsetDays: number = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().split('T')[0];
}

/**
 * Create a test timestamp
 */
export function createTestTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Create test pagination parameters
 */
export function createTestPagination(overrides: any = {}): any {
  return {
    limit: 10,
    lastEvaluatedKey: undefined,
    ...overrides
  };
}

