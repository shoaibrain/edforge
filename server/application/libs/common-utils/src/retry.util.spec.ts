import { retryWithBackoff, createRetryableOperation, DEFAULT_RETRY_CONFIG } from './retry.util';

describe('retry.util', () => {
  describe('retryWithBackoff', () => {
    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const result = await retryWithBackoff(operation);
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on retryable errors', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })
        .mockRejectedValueOnce({ name: 'ConditionalCheckFailedException' })
        .mockResolvedValue('success');

      const result = await retryWithBackoff(operation);
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
    });

    it('should not retry on non-retryable errors', async () => {
      const operation = jest.fn().mockRejectedValue({ name: 'ValidationError' });

      await expect(retryWithBackoff(operation)).rejects.toMatchObject({
        name: 'ValidationError'
      });
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should respect maxAttempts', async () => {
      const operation = jest.fn().mockRejectedValue({ name: 'ConditionalCheckFailedException' });

      await expect(retryWithBackoff(operation, { maxAttempts: 2 })).rejects.toMatchObject({
        name: 'ConditionalCheckFailedException'
      });
      expect(operation).toHaveBeenCalledTimes(2);
    });
  });

  describe('createRetryableOperation', () => {
    it('should create a retryable operation wrapper', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      const retryable = createRetryableOperation({ maxAttempts: 2 });
      
      const result = await retryable(operation);
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});

