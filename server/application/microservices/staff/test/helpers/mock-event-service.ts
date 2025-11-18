export function createMockEventService() {
  return {
    publishEvent: jest.fn().mockResolvedValue(undefined),
    publishEvents: jest.fn().mockResolvedValue(undefined)
  };
}

