import { HttpException, HttpStatus } from '@nestjs/common';
import { BaseErrorCode } from './error-codes.enum';

// Re-export BaseErrorCode for convenience
export { BaseErrorCode } from './error-codes.enum';

/**
 * Base Domain Exception
 * 
 * Abstract base class for all domain exceptions.
 * Provides consistent error response format and stack trace handling.
 */
export abstract class BaseDomainException extends HttpException {
  public readonly errorCode: string;
  public readonly details?: any;
  public readonly timestamp: string;

  constructor(
    errorCode: string | BaseErrorCode,
    message: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: any
  ) {
    const errorCodeString = typeof errorCode === 'string' ? errorCode : String(errorCode);
    const response = {
      errorCode: errorCodeString,
      message,
      details,
      timestamp: new Date().toISOString()
    };

    super(response, statusCode);
    
    this.errorCode = errorCodeString;
    this.details = details;
    this.timestamp = response.timestamp;
    
    // Preserve stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  /**
   * Get error response in standard format
   */
  getErrorResponse(): {
    errorCode: string;
    message: string;
    details?: any;
    timestamp: string;
    statusCode: number;
  } {
    return {
      errorCode: this.errorCode,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp,
      statusCode: this.getStatus()
    };
  }
}

