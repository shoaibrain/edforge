/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Mock Request Context - Standard request context mocks for testing
 */

import type { RequestContext } from '@edforge/shared-types';

/**
 * Create a mock request context for testing
 */
export function createMockRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 'test-tenant-123',
    userId: 'test-user-123',
    jwtToken: 'mock-jwt-token',
    ...overrides
  };
}

/**
 * Create a mock Express request with tenant context
 */
export function createMockRequest(overrides: any = {}): any {
  return {
    user: {
      userId: 'test-user-123',
      tenantId: 'test-tenant-123',
      email: 'test@example.com',
      roles: ['admin']
    },
    headers: {
      authorization: 'Bearer mock-jwt-token'
    },
    ...overrides
  };
}

