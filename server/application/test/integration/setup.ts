/**
 * Integration Test Setup
 * 
 * Configuration for integration tests that run against LocalStack services.
 * Tests in this directory require Docker Compose services to be running.
 */

import { DynamoDBClient, CreateTableCommand, DescribeTableCommand } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';
import { EventBridgeClient, CreateEventBusCommand, DescribeEventBusCommand, PutEventsCommand } from '@aws-sdk/client-eventbridge';

// LocalStack endpoints - matches docker-compose.local.yml
export const LOCALSTACK_ENDPOINT = process.env.LOCALSTACK_ENDPOINT || 'http://localhost:4566';
export const DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
export const AWS_REGION = process.env.AWS_REGION || 'us-east-1';

// Test table names
export const IDENTITY_TABLE = 'edforge-identity-test';
export const ACADEMICS_TABLE = 'edforge-academics-test';
export const EVENT_BUS_NAME = 'edforge-test-bus';

// Test tenant
export const TEST_TENANT_ID = 'test-tenant-integration';

/**
 * Create a DynamoDB client pointing to LocalStack/DynamoDB Local
 */
export function createDynamoDBClient(): DynamoDBDocumentClient {
  const client = new DynamoDBClient({
    region: AWS_REGION,
    endpoint: DYNAMODB_ENDPOINT,
    credentials: {
      accessKeyId: 'local',
      secretAccessKey: 'local',
    },
  });
  return DynamoDBDocumentClient.from(client);
}

/**
 * Create an EventBridge client pointing to LocalStack
 */
export function createEventBridgeClient(): EventBridgeClient {
  return new EventBridgeClient({
    region: AWS_REGION,
    endpoint: LOCALSTACK_ENDPOINT,
    credentials: {
      accessKeyId: 'local',
      secretAccessKey: 'local',
    },
  });
}

/**
 * Create test DynamoDB table with standard schema
 */
export async function createTestTable(tableName: string): Promise<void> {
  const client = new DynamoDBClient({
    region: AWS_REGION,
    endpoint: DYNAMODB_ENDPOINT,
    credentials: {
      accessKeyId: 'local',
      secretAccessKey: 'local',
    },
  });

  try {
    // Check if table exists
    await client.send(new DescribeTableCommand({ TableName: tableName }));
    console.log(`Table ${tableName} already exists`);
    return;
  } catch (error: any) {
    if (error.name !== 'ResourceNotFoundException') {
      throw error;
    }
  }

  // Create table
  await client.send(new CreateTableCommand({
    TableName: tableName,
    KeySchema: [
      { AttributeName: 'tenantId', KeyType: 'HASH' },
      { AttributeName: 'entityKey', KeyType: 'RANGE' },
    ],
    AttributeDefinitions: [
      { AttributeName: 'tenantId', AttributeType: 'S' },
      { AttributeName: 'entityKey', AttributeType: 'S' },
      { AttributeName: 'gsi1pk', AttributeType: 'S' },
      { AttributeName: 'gsi1sk', AttributeType: 'S' },
    ],
    GlobalSecondaryIndexes: [
      {
        IndexName: 'GSI1',
        KeySchema: [
          { AttributeName: 'gsi1pk', KeyType: 'HASH' },
          { AttributeName: 'gsi1sk', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
        ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
      },
    ],
    ProvisionedThroughput: { ReadCapacityUnits: 5, WriteCapacityUnits: 5 },
  }));

  // Wait for table to be active
  let active = false;
  while (!active) {
    const result = await client.send(new DescribeTableCommand({ TableName: tableName }));
    active = result.Table?.TableStatus === 'ACTIVE';
    if (!active) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
  }

  console.log(`Table ${tableName} created`);
  client.destroy();
}

/**
 * Create EventBridge bus in LocalStack
 */
export async function createTestEventBus(): Promise<void> {
  const client = createEventBridgeClient();

  try {
    await client.send(new DescribeEventBusCommand({ Name: EVENT_BUS_NAME }));
    console.log(`Event bus ${EVENT_BUS_NAME} already exists`);
    return;
  } catch (error: any) {
    if (error.name !== 'ResourceNotFoundException') {
      throw error;
    }
  }

  await client.send(new CreateEventBusCommand({ Name: EVENT_BUS_NAME }));
  console.log(`Event bus ${EVENT_BUS_NAME} created`);
  client.destroy();
}

/**
 * Seed test data for integration tests
 */
export async function seedTestData(client: DynamoDBDocumentClient, tableName: string): Promise<void> {
  const timestamp = new Date().toISOString();

  // Create test tenant
  await client.send(new PutCommand({
    TableName: tableName,
    Item: {
      tenantId: TEST_TENANT_ID,
      entityKey: 'METADATA',
      entityType: 'TENANT',
      name: 'Integration Test District',
      tier: 'basic',
      status: 'active',
      contactEmail: 'test@integration.edu',
      createdAt: timestamp,
      createdBy: 'system',
      updatedAt: timestamp,
      updatedBy: 'system',
      version: 1,
    },
  }));

  // Create test school
  await client.send(new PutCommand({
    TableName: tableName,
    Item: {
      tenantId: TEST_TENANT_ID,
      entityKey: 'SCHOOL#test-school-001',
      entityType: 'SCHOOL',
      schoolId: 'test-school-001',
      schoolCode: 'INT001',
      name: 'Integration Test School',
      shortName: 'ITS',
      schoolType: 'elementary',
      status: 'active',
      timezone: 'America/New_York',
      locale: 'en-US',
      gsi1pk: `TENANT#${TEST_TENANT_ID}#SCHOOLS`,
      gsi1sk: 'SCHOOL#test-school-001',
      createdAt: timestamp,
      createdBy: 'system',
      updatedAt: timestamp,
      updatedBy: 'system',
      version: 1,
    },
  }));

  // Create test user
  await client.send(new PutCommand({
    TableName: tableName,
    Item: {
      tenantId: TEST_TENANT_ID,
      entityKey: 'USER#test-user-001',
      entityType: 'USER',
      userId: 'test-user-001',
      email: 'testadmin@integration.edu',
      firstName: 'Test',
      lastName: 'Admin',
      globalRole: 'TenantAdmin',
      status: 'active',
      gsi1pk: 'EMAIL#testadmin@integration.edu',
      gsi1sk: `TENANT#${TEST_TENANT_ID}`,
      createdAt: timestamp,
      createdBy: 'system',
      updatedAt: timestamp,
      updatedBy: 'system',
      version: 1,
    },
  }));

  console.log(`Test data seeded for ${tableName}`);
}

/**
 * Clean up test data
 */
export async function cleanupTestData(client: DynamoDBDocumentClient, tableName: string): Promise<void> {
  // In a real implementation, you'd delete all items with TEST_TENANT_ID
  // For integration tests, we typically leave data for inspection
  console.log(`Cleanup for ${tableName} - data retained for inspection`);
}

/**
 * Global test setup - run before all integration tests
 */
export async function globalSetup(): Promise<void> {
  console.log('Setting up integration test environment...');
  
  // Create tables
  await createTestTable(IDENTITY_TABLE);
  await createTestTable(ACADEMICS_TABLE);
  
  // Create event bus
  await createTestEventBus();
  
  // Seed data
  const client = createDynamoDBClient();
  await seedTestData(client, IDENTITY_TABLE);
  await seedTestData(client, ACADEMICS_TABLE);
  
  console.log('Integration test environment ready');
}

/**
 * Global teardown - run after all integration tests
 */
export async function globalTeardown(): Promise<void> {
  console.log('Tearing down integration test environment...');
  // Cleanup is optional - tables persist between test runs for debugging
  console.log('Integration test teardown complete');
}

