/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Mock Tenant - Tenant credential mocks for testing
 */

/**
 * Create a mock tenant credential object
 */
export function createMockTenant(overrides: any = {}): any {
  return {
    tenantId: 'test-tenant-123',
    tenantName: 'Test School District',
    ...overrides
  };
}

