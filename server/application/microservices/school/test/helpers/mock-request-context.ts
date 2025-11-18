import { RequestContext } from '../../src/schools/entities/school.entity.enhanced';

/**
 * Create a mock RequestContext for testing
 */
export function createMockRequestContext(overrides: Partial<RequestContext> = {}): RequestContext {
  return {
    tenantId: 'test-tenant-123',
    userId: 'test-user-456',
    userRole: 'admin',
    userName: 'Test User',
    jwtToken: 'mock-jwt-token',
    ipAddress: '127.0.0.1',
    userAgent: 'jest-test',
    sessionId: 'test-session-789',
    ...overrides
  };
}

