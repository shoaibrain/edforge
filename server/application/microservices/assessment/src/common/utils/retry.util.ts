/**
 * Retry utility with exponential backoff
 * Handles optimistic locking failures and transient errors
 * 
 * Usage:
 * const result = await retryWithBackoff(
 *   async () => updateOperation(),
 *   { maxAttempts: 3, baseDelay: 100 },
 *   logger
 * );
 */

export interface RetryConfig {
  maxAttempts: number;
  baseDelay: number;        // milliseconds
  maxDelay: number;         // milliseconds
  backoffMultiplier: number;
  retryableErrors: string[];
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelay: 100,
  maxDelay: 2000,
  backoffMultiplier: 2,
  retryableErrors: [
    'ConditionalCheckFailedException',
    'CONCURRENT_MODIFICATION',
    'ProvisionedThroughputExceededException'
  ]
};

/**
 * Execute operation with exponential backoff retry
 * 
 * @param operation - Async function to execute
 * @param config - Retry configuration (optional)
 * @param logger - Logger instance (optional)
 * @returns Promise with operation result
 * @throws Last error if all retry attempts fail
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  config: Partial<RetryConfig> = {},
  logger?: any
): Promise<T> {
  const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
  let lastError: any;
  
  for (let attempt = 1; attempt <= finalConfig.maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      // Check if error is retryable
      const isRetryable = finalConfig.retryableErrors.some(
        errType => error.name === errType || 
                   error.errorCode?.includes(errType) ||
                   error.message?.includes(errType)
      );
      
      // If not retryable or last attempt, throw immediately
      if (!isRetryable || attempt === finalConfig.maxAttempts) {
        if (logger && attempt > 1) {
          logger.error(`Operation failed after ${attempt} attempts`, {
            error: error.message,
            errorCode: error.errorCode,
            attempts: attempt
          });
        }
        throw error;
      }
      
      // Calculate exponential backoff with jitter
      const baseDelay = finalConfig.baseDelay * Math.pow(finalConfig.backoffMultiplier, attempt - 1);
      const cappedDelay = Math.min(baseDelay, finalConfig.maxDelay);
      const jitter = Math.random() * 0.3 * cappedDelay; // 30% jitter to prevent thundering herd
      const totalDelay = Math.floor(cappedDelay + jitter);
      
      if (logger) {
        logger.warn(`Retrying operation after ${totalDelay}ms (attempt ${attempt}/${finalConfig.maxAttempts})`, {
          error: error.message,
          errorCode: error.errorCode,
          attempt,
          delay: totalDelay
        });
      }
      
      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, totalDelay));
    }
  }
  
  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Create a retryable operation wrapper
 * Useful for wrapping multiple operations with same retry config
 */
export function createRetryableOperation<T>(
  config: Partial<RetryConfig> = {},
  logger?: any
) {
  return (operation: () => Promise<T>): Promise<T> => {
    return retryWithBackoff(operation, config, logger);
  };
}

