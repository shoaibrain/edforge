import { Test, TestingModule } from '@nestjs/testing';
import { RetryStrategyService, RetryableStatusCode, NonRetryableStatusCode } from './retry-strategy.service';

describe('RetryStrategyService', () => {
  let service: RetryStrategyService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [RetryStrategyService]
    }).compile();

    service = module.get<RetryStrategyService>(RetryStrategyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('isRetryable', () => {
    it('should return true for retryable status codes', () => {
      expect(service.isRetryable(RetryableStatusCode.INTERNAL_SERVER_ERROR)).toBe(true);
      expect(service.isRetryable(RetryableStatusCode.BAD_GATEWAY)).toBe(true);
      expect(service.isRetryable(RetryableStatusCode.SERVICE_UNAVAILABLE)).toBe(true);
      expect(service.isRetryable(RetryableStatusCode.GATEWAY_TIMEOUT)).toBe(true);
    });

    it('should return false for non-retryable status codes', () => {
      expect(service.isRetryable(NonRetryableStatusCode.BAD_REQUEST)).toBe(false);
      expect(service.isRetryable(NonRetryableStatusCode.UNAUTHORIZED)).toBe(false);
      expect(service.isRetryable(NonRetryableStatusCode.FORBIDDEN)).toBe(false);
      expect(service.isRetryable(NonRetryableStatusCode.NOT_FOUND)).toBe(false);
    });
  });

  describe('isNonRetryable', () => {
    it('should return true for non-retryable status codes', () => {
      expect(service.isNonRetryable(NonRetryableStatusCode.BAD_REQUEST)).toBe(true);
      expect(service.isNonRetryable(NonRetryableStatusCode.UNAUTHORIZED)).toBe(true);
      expect(service.isNonRetryable(NonRetryableStatusCode.FORBIDDEN)).toBe(true);
      expect(service.isNonRetryable(NonRetryableStatusCode.NOT_FOUND)).toBe(true);
    });

    it('should return false for retryable status codes', () => {
      expect(service.isNonRetryable(RetryableStatusCode.INTERNAL_SERVER_ERROR)).toBe(false);
    });
  });

  describe('calculateDelay', () => {
    it('should calculate exponential backoff delay', () => {
      const delay1 = service.calculateDelay(1);
      const delay2 = service.calculateDelay(2);
      const delay3 = service.calculateDelay(3);

      expect(delay1).toBeGreaterThan(0);
      expect(delay2).toBeGreaterThan(delay1);
      expect(delay3).toBeGreaterThan(delay2);
    });

    it('should respect max delay', () => {
      const delay = service.calculateDelay(10, { maxDelay: 1000 });
      // Account for jitter (up to 30% of calculated delay)
      // Max delay = 1000, max jitter = 300 (30% of 1000), total max = 1300
      expect(delay).toBeLessThanOrEqual(1300);
    });
  });

  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const result = await service.executeWithRetry(operation);
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce({ response: { status: 500 } })
        .mockRejectedValueOnce({ response: { status: 500 } })
        .mockResolvedValue('success');

      const result = await service.executeWithRetry(operation);
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const operation = jest.fn().mockRejectedValue({ response: { status: 400 } });

      await expect(service.executeWithRetry(operation)).rejects.toMatchObject({
        response: { status: 400 }
      });
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should throw after max retries', async () => {
      const operation = jest.fn().mockRejectedValue({ response: { status: 500 } });

      await expect(service.executeWithRetry(operation, { maxRetries: 2 })).rejects.toMatchObject({
        response: { status: 500 }
      });
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });
});

