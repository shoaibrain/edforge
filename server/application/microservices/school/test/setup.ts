/**
 * Test Setup for School Service
 * 
 * Configures test environment, mocks AWS services, and sets up test utilities.
 */

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.TABLE_NAME = 'test-school-table';
process.env.AWS_REGION = 'us-east-1';
process.env.EVENT_BUS_NAME = 'test-event-bus';

// Mock AWS SDK clients
jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn()
}));

jest.mock('@aws-sdk/lib-dynamodb', () => ({
  DynamoDBDocumentClient: {
    from: jest.fn()
  },
  PutCommand: jest.fn(),
  GetCommand: jest.fn(),
  QueryCommand: jest.fn(),
  UpdateCommand: jest.fn(),
  DeleteCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-eventbridge', () => ({
  EventBridgeClient: jest.fn(),
  PutEventsCommand: jest.fn()
}));

// Increase timeout for integration tests
jest.setTimeout(10000);

