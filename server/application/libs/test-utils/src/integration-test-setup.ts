/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Integration Test Setup - Configuration for integration tests
 */

/**
 * Setup test environment variables
 */
export function setupTestEnvironment(): void {
  process.env.NODE_ENV = 'test';
  process.env.AWS_REGION = 'us-east-1';
  process.env.TABLE_NAME = 'test-table';
  process.env.EVENT_BUS_NAME = 'test-event-bus';
  process.env.ATHENA_WORKGROUP = 'test-workgroup';
  process.env.ATHENA_DATABASE = 'test_database';
  process.env.ATHENA_RESULTS_BUCKET = 'test-results-bucket';
  process.env.DATA_LAKE_BUCKET_NAME = 'test-data-lake';
}

/**
 * Cleanup test environment
 */
export function cleanupTestEnvironment(): void {
  // Remove test-specific environment variables if needed
  delete process.env.TABLE_NAME;
}

