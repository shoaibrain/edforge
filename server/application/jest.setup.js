/**
 * Jest Setup for EdForge Microservices
 * 
 * Global test configuration and mocks for AWS SDK clients
 */

// Import reflect-metadata for NestJS dependency injection
require('reflect-metadata');

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test-access-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret-key';
process.env.COGNITO_USER_POOL_ID = 'test-pool-id';
process.env.COGNITO_CLIENT_ID = 'test-client-id';
process.env.TABLE_NAME = 'test-table';
process.env.EVENT_BUS_NAME = 'test-event-bus';
process.env.SKIP_ABAC = 'true';
process.env.LOG_LEVEL = 'error'; // Reduce log noise in tests

// Increase timeout for async tests
jest.setTimeout(10000);

// ============================================================
// Mock DynamoDB Client
// ============================================================
const mockDynamoDBSend = jest.fn();

jest.mock('@aws-sdk/lib-dynamodb', () => {
  const original = jest.requireActual('@aws-sdk/lib-dynamodb');
  return {
    ...original,
    DynamoDBDocumentClient: {
      from: jest.fn(() => ({
        send: mockDynamoDBSend,
      })),
    },
    GetCommand: jest.fn((params) => ({ type: 'GetCommand', params })),
    PutCommand: jest.fn((params) => ({ type: 'PutCommand', params })),
    UpdateCommand: jest.fn((params) => ({ type: 'UpdateCommand', params })),
    DeleteCommand: jest.fn((params) => ({ type: 'DeleteCommand', params })),
    QueryCommand: jest.fn((params) => ({ type: 'QueryCommand', params })),
    ScanCommand: jest.fn((params) => ({ type: 'ScanCommand', params })),
    TransactWriteCommand: jest.fn((params) => ({ type: 'TransactWriteCommand', params })),
    BatchGetCommand: jest.fn((params) => ({ type: 'BatchGetCommand', params })),
    BatchWriteCommand: jest.fn((params) => ({ type: 'BatchWriteCommand', params })),
  };
});

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: mockDynamoDBSend,
  })),
}));

// ============================================================
// Mock Cognito Client
// ============================================================
const mockCognitoSend = jest.fn();

jest.mock('@aws-sdk/client-cognito-identity-provider', () => ({
  CognitoIdentityProviderClient: jest.fn().mockImplementation(() => ({
    send: mockCognitoSend,
  })),
  AdminCreateUserCommand: jest.fn((params) => ({ type: 'AdminCreateUserCommand', params })),
  AdminGetUserCommand: jest.fn((params) => ({ type: 'AdminGetUserCommand', params })),
  AdminUpdateUserAttributesCommand: jest.fn((params) => ({ type: 'AdminUpdateUserAttributesCommand', params })),
  AdminDisableUserCommand: jest.fn((params) => ({ type: 'AdminDisableUserCommand', params })),
  AdminEnableUserCommand: jest.fn((params) => ({ type: 'AdminEnableUserCommand', params })),
  AdminDeleteUserCommand: jest.fn((params) => ({ type: 'AdminDeleteUserCommand', params })),
  AdminAddUserToGroupCommand: jest.fn((params) => ({ type: 'AdminAddUserToGroupCommand', params })),
  AdminSetUserPasswordCommand: jest.fn((params) => ({ type: 'AdminSetUserPasswordCommand', params })),
  CreateGroupCommand: jest.fn((params) => ({ type: 'CreateGroupCommand', params })),
  GetGroupCommand: jest.fn((params) => ({ type: 'GetGroupCommand', params })),
  ListUsersInGroupCommand: jest.fn((params) => ({ type: 'ListUsersInGroupCommand', params })),
  InitiateAuthCommand: jest.fn((params) => ({ type: 'InitiateAuthCommand', params })),
  RespondToAuthChallengeCommand: jest.fn((params) => ({ type: 'RespondToAuthChallengeCommand', params })),
  GlobalSignOutCommand: jest.fn((params) => ({ type: 'GlobalSignOutCommand', params })),
}));

// ============================================================
// Mock EventBridge Client
// ============================================================
const mockEventBridgeSend = jest.fn().mockResolvedValue({
  FailedEntryCount: 0,
  Entries: [{ EventId: 'test-event-id-' + Date.now() }],
});

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn().mockImplementation(() => ({
    send: mockEventBridgeSend,
  })),
  PutEventsCommand: jest.fn((params) => ({ type: 'PutEventsCommand', params })),
}));

// ============================================================
// Mock STS Client
// ============================================================
const mockSTSSend = jest.fn().mockResolvedValue({
  Credentials: {
    AccessKeyId: 'test-access-key',
    SecretAccessKey: 'test-secret-key',
    SessionToken: 'test-session-token',
    Expiration: new Date(Date.now() + 3600000),
  },
});

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({
    send: mockSTSSend,
  })),
  AssumeRoleCommand: jest.fn((params) => ({ type: 'AssumeRoleCommand', params })),
}));

// ============================================================
// Global Test Utilities
// ============================================================

// Export mock functions for test access
global.__mocks__ = {
  dynamodb: mockDynamoDBSend,
  cognito: mockCognitoSend,
  eventbridge: mockEventBridgeSend,
  sts: mockSTSSend,
};

// Reset all mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  mockDynamoDBSend.mockReset();
  mockCognitoSend.mockReset();
  mockEventBridgeSend.mockReset();
  mockSTSSend.mockReset();
  
  // Restore default EventBridge behavior
  mockEventBridgeSend.mockResolvedValue({
    FailedEntryCount: 0,
    Entries: [{ EventId: 'test-event-id-' + Date.now() }],
  });
  
  // Restore default STS behavior
  mockSTSSend.mockResolvedValue({
    Credentials: {
      AccessKeyId: 'test-access-key',
      SecretAccessKey: 'test-secret-key',
      SessionToken: 'test-session-token',
      Expiration: new Date(Date.now() + 3600000),
    },
  });
});

// ============================================================
// Test Helpers
// ============================================================

/**
 * Create a mock request context for testing
 */
global.createMockRequestContext = (overrides = {}) => ({
  tenantId: 'test-tenant-001',
  userId: 'test-user-001',
  userEmail: 'test@example.com',
  userRole: 'TenantAdmin',
  requestId: `req-${Date.now()}`,
  correlationId: `corr-${Date.now()}`,
  timestamp: new Date().toISOString(),
  ...overrides,
});

/**
 * Create mock DynamoDB response for GetCommand
 */
global.mockDynamoDBGet = (item) => {
  mockDynamoDBSend.mockResolvedValueOnce({ Item: item });
};

/**
 * Create mock DynamoDB response for Query
 */
global.mockDynamoDBQuery = (items, lastEvaluatedKey) => {
  mockDynamoDBSend.mockResolvedValueOnce({
    Items: items,
    Count: items.length,
    LastEvaluatedKey: lastEvaluatedKey,
  });
};

/**
 * Create mock DynamoDB response for Put/Update/Delete
 */
global.mockDynamoDBMutate = () => {
  mockDynamoDBSend.mockResolvedValueOnce({});
};

/**
 * Mock Cognito create user response
 */
global.mockCognitoCreateUser = (username, email) => {
  mockCognitoSend.mockResolvedValueOnce({
    User: {
      Username: username,
      UserStatus: 'CONFIRMED',
      Attributes: [
        { Name: 'email', Value: email },
        { Name: 'email_verified', Value: 'true' },
      ],
    },
  });
};

// Suppress console.log during tests (uncomment for debugging)
// global.console = {
//   ...console,
//   log: jest.fn(),
//   debug: jest.fn(),
//   info: jest.fn(),
// };
