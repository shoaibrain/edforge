import { InMemoryCacheService } from './in-memory-cache.service';

describe('InMemoryCacheService cleanup timer under the Lambda runtime (C1.2)', () => {
  const before = process.env.EDFORGE_RUNTIME;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(global, 'setInterval');
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    if (before === undefined) delete process.env.EDFORGE_RUNTIME;
    else process.env.EDFORGE_RUNTIME = before;
  });

  it('starts no cleanup interval in the Lambda runtime', () => {
    process.env.EDFORGE_RUNTIME = 'lambda';
    new InMemoryCacheService(10);
    expect(setInterval).not.toHaveBeenCalled();
  });

  it('starts the 5-minute cleanup interval in the http runtime', () => {
    delete process.env.EDFORGE_RUNTIME;
    const cache = new InMemoryCacheService(10);
    expect(setInterval).toHaveBeenCalledTimes(1);
    expect((setInterval as unknown as jest.Mock).mock.calls[0][1]).toBe(5 * 60 * 1000);
    (cache as unknown as { onModuleDestroy?: () => void }).onModuleDestroy?.();
  });
});
