import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

/**
 * Create a mock DynamoDB client for testing
 */
export function createMockDynamoDBClient() {
  const mockClient = {
    send: jest.fn()
  };

  return {
    client: mockClient as unknown as DynamoDBDocumentClient,
    mockSend: mockClient.send
  };
}

