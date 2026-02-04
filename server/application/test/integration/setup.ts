/**
 * Integration Test Setup
 * 
 * Configures LocalStack endpoints for AWS services during testing
 */

import { DynamoDBClient, CreateTableCommand, DeleteTableCommand, ListTablesCommand } from '@aws-sdk/client-dynamodb';

// LocalStack endpoint (default)
export const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
export const EVENT_BUS_NAME = 'edforge-test-event-bus';
export const TEST_TENANT_ID = 'test-tenant-123';

// Configure AWS SDK to use LocalStack
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';

// DynamoDB table schema for EdForge Identity Service
const IDENTITY_TABLE_SCHEMA = {
  TableName: 'edforge-identity-test',
  KeySchema: [
    { AttributeName: 'tenantId', KeyType: 'HASH' as const },
    { AttributeName: 'entityKey', KeyType: 'RANGE' as const },
  ],
  AttributeDefinitions: [
    { AttributeName: 'tenantId', AttributeType: 'S' as const },
    { AttributeName: 'entityKey', AttributeType: 'S' as const },
    { AttributeName: 'gsi1pk', AttributeType: 'S' as const },
    { AttributeName: 'gsi1sk', AttributeType: 'S' as const },
    { AttributeName: 'gsi2pk', AttributeType: 'S' as const },
    { AttributeName: 'gsi2sk', AttributeType: 'S' as const },
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'GSI1',
      KeySchema: [
        { AttributeName: 'gsi1pk', KeyType: 'HASH' as const },
        { AttributeName: 'gsi1sk', KeyType: 'RANGE' as const },
      ],
      Projection: { ProjectionType: 'ALL' as const },
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
    {
      IndexName: 'GSI2',
      KeySchema: [
        { AttributeName: 'gsi2pk', KeyType: 'HASH' as const },
        { AttributeName: 'gsi2sk', KeyType: 'RANGE' as const },
      ],
      Projection: { ProjectionType: 'ALL' as const },
      ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
    },
  ],
  ProvisionedThroughput: {
    ReadCapacityUnits: 10,
    WriteCapacityUnits: 10,
  },
};

/**
 * Create DynamoDB client for LocalStack
 */
export function createLocalDynamoDBClient(): DynamoDBClient {
  return new DynamoDBClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
  });
}

/**
 * Initialize test database tables
 */
export async function initializeTestDatabase(): Promise<void> {
  const client = createLocalDynamoDBClient();
  
  try {
    await client.send(new CreateTableCommand(IDENTITY_TABLE_SCHEMA));
    console.log('Created test table: edforge-identity-test');
  } catch (error: any) {
    if (error.name === 'ResourceInUseException') {
      console.log('Test table already exists');
    } else {
      throw error;
    }
  }
}

/**
 * Clean up test database
 */
export async function cleanupTestDatabase(): Promise<void> {
  // Tables are ephemeral with LocalStack - no cleanup needed
  console.log('Test cleanup complete');
}

// Jest global setup
beforeAll(async () => {
  console.log('Setting up integration test environment...');
  console.log(`LocalStack endpoint: ${LOCALSTACK_ENDPOINT}`);
  
  // Wait for LocalStack to be ready
  const maxRetries = 10;
  let retries = 0;
  
  while (retries < maxRetries) {
    try {
      await initializeTestDatabase();
      break;
    } catch (error) {
      retries++;
      if (retries === maxRetries) {
        console.error('Failed to connect to LocalStack. Is it running?');
        console.error('Start LocalStack with: localstack start');
        throw error;
      }
      console.log(`Waiting for LocalStack... (attempt ${retries}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }
});

afterAll(async () => {
  await cleanupTestDatabase();
});

// Export for use in tests
export const testConfig = {
  dynamodbEndpoint: LOCALSTACK_ENDPOINT,
  tableName: 'edforge-identity-test',
  region: 'us-east-1',
};

/**
 * Create EventBridge client for LocalStack
 */
export function createEventBridgeClient() {
  const { EventBridgeClient } = require('@aws-sdk/client-eventbridge');
  return new EventBridgeClient({
    endpoint: LOCALSTACK_ENDPOINT,
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'test',
      secretAccessKey: 'test',
    },
  });
}

/**
 * Create test EventBus
 */
export async function createTestEventBus(): Promise<void> {
  const { CreateEventBusCommand } = require('@aws-sdk/client-eventbridge');
  const client = createEventBridgeClient();
  try {
    await client.send(new CreateEventBusCommand({ Name: EVENT_BUS_NAME }));
    console.log(`Created test EventBus: ${EVENT_BUS_NAME}`);
  } catch (error: any) {
    if (error.name !== 'ResourceAlreadyExistsException') {
      console.log('EventBus already exists or error:', error.message);
    }
  }
}

/**
 * Global setup for integration tests
 */
export async function globalSetup(): Promise<void> {
  console.log('Initializing integration test environment...');
  await initializeTestDatabase();
  await createTestEventBus();
}

/**
 * Global teardown for integration tests
 */
export async function globalTeardown(): Promise<void> {
  console.log('Cleaning up integration test environment...');
  await cleanupTestDatabase();
}
