/**
 * Integration Test Setup
 * 
 * Sets up test environment for integration tests with real DynamoDB
 */

// Set environment for integration tests
process.env.NODE_ENV = 'test';
process.env.DYNAMODB_ENDPOINT = process.env.DYNAMODB_ENDPOINT || 'http://localhost:8000';
process.env.TABLE_NAME = 'test-school-table';
process.env.AWS_REGION = 'us-east-1';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';
process.env.EVENT_BUS_NAME = 'test-event-bus';

// Increase timeout for integration tests
jest.setTimeout(30000);

