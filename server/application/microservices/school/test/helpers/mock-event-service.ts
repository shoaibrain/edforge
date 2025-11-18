/**
 * Create a mock event service for testing
 */
export function createMockEventService() {
  return {
    publishEvent: jest.fn().mockResolvedValue(undefined),
    publishEvents: jest.fn().mockResolvedValue(undefined)
  };
}

