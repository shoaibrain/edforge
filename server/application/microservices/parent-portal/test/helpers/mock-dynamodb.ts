export function createMockDynamoDBClient() {
  const mockClient = { send: jest.fn() };
  return {
    client: mockClient as any,
    mockSend: mockClient.send
  };
}

