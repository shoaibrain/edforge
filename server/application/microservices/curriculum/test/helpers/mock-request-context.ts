export function createMockRequestContext(overrides: any = {}) {
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

