/**
 * Create mock tenant credentials for testing
 */
export function createMockTenant() {
  return {
    tenantId: 'test-tenant-123',
    userId: 'test-user-456',
    userRole: 'admin',
    tenantTier: 'premium',
    tenantName: 'Test School',
    email: 'test@example.com',
    userPoolId: 'us-east-1_test',
    appClientId: 'test-client-id'
  };
}

