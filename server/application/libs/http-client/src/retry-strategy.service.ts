import { Injectable, Logger } from '@nestjs/common';

export enum RetryableStatusCode {
  INTERNAL_SERVER_ERROR = 500,
  BAD_GATEWAY = 502,
  SERVICE_UNAVAILABLE = 503,
  GATEWAY_TIMEOUT = 504
}

export enum NonRetryableStatusCode {
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404
}

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // milliseconds
  maxDelay: number; // milliseconds
  backoffMultiplier: number;
}

export const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 4000, // 4 seconds
  backoffMultiplier: 2
};

@Injectable()
export class RetryStrategyService {
  private readonly logger = new Logger(RetryStrategyService.name);

  /**
   * Check if a status code is retryable
   */
  isRetryable(statusCode: number): boolean {
    return Object.values(RetryableStatusCode).includes(statusCode as RetryableStatusCode);
  }

  /**
   * Check if a status code is non-retryable
   */
  isNonRetryable(statusCode: number): boolean {
    return Object.values(NonRetryableStatusCode).includes(statusCode as NonRetryableStatusCode);
  }

  /**
   * Calculate delay for retry attempt using exponential backoff
   */
  calculateDelay(attempt: number, config: Partial<RetryConfig> = {}): number {
    const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    const baseDelay = finalConfig.baseDelay * Math.pow(finalConfig.backoffMultiplier, attempt - 1);
    const cappedDelay = Math.min(baseDelay, finalConfig.maxDelay);
    // Add jitter (30% of delay) to prevent thundering herd
    const jitter = Math.random() * 0.3 * cappedDelay;
    return Math.floor(cappedDelay + jitter);
  }

  /**
   * Execute an operation with retry logic
   */
  async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    onRetry?: (attempt: number, error: any) => void
  ): Promise<T> {
    const finalConfig = { ...DEFAULT_RETRY_CONFIG, ...config };
    let lastError: any;

    for (let attempt = 1; attempt <= finalConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error: any) {
        lastError = error;

        // Check if error is retryable
        const statusCode = error?.response?.status || error?.statusCode;
        if (statusCode && this.isNonRetryable(statusCode)) {
          this.logger.warn(`Non-retryable error (${statusCode}), aborting retries`, {
            statusCode,
            attempt,
            error: error.message
          });
          throw error;
        }

        // If last attempt, throw error
        if (attempt === finalConfig.maxRetries) {
          this.logger.error(`Operation failed after ${attempt} attempts`, {
            attempts: attempt,
            error: error.message,
            statusCode
          });
          throw error;
        }

        // Calculate delay and wait
        const delay = this.calculateDelay(attempt, finalConfig);
        this.logger.warn(`Retrying operation after ${delay}ms (attempt ${attempt}/${finalConfig.maxRetries})`, {
          attempt,
          maxRetries: finalConfig.maxRetries,
          delay,
          error: error.message,
          statusCode
        });

        if (onRetry) {
          onRetry(attempt, error);
        }

        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    // This should never be reached, but TypeScript needs it
    throw lastError;
  }
}

