/**
 * Custom Exception Classes
 * 
 * Provides standardized exception handling with error codes and detailed messages.
 */

import { HttpException, HttpStatus } from '@nestjs/common';

export interface ErrorDetails {
  [key: string]: any;
}

/**
 * Base Business Exception
 */
export class BusinessException extends HttpException {
  constructor(
    message: string,
    statusCode: HttpStatus = HttpStatus.BAD_REQUEST,
    public readonly errorCode: string,
    public readonly details?: ErrorDetails
  ) {
    super(
      {
        statusCode,
        errorCode,
        message,
        details,
        timestamp: new Date().toISOString(),
      },
      statusCode
    );
    this.name = 'BusinessException';
  }
}

/**
 * Validation Exception - Input validation errors
 */
export class ValidationException extends BusinessException {
  constructor(
    message: string,
    public readonly validationErrors: string[],
    details?: ErrorDetails
  ) {
    super(
      message,
      HttpStatus.BAD_REQUEST,
      'VALIDATION_ERROR',
      {
        ...details,
        validationErrors,
      }
    );
    this.name = 'ValidationException';
  }
}

/**
 * Not Found Exception - Resource not found
 */
export class NotFoundException extends BusinessException {
  constructor(
    resourceType: string,
    resourceId: string,
    details?: ErrorDetails
  ) {
    super(
      `${resourceType} with ID '${resourceId}' not found`,
      HttpStatus.NOT_FOUND,
      'RESOURCE_NOT_FOUND',
      {
        ...details,
        resourceType,
        resourceId,
      }
    );
    this.name = 'NotFoundException';
  }
}

/**
 * Conflict Exception - Resource conflicts (409)
 */
export class ConflictException extends BusinessException {
  constructor(
    message: string,
    public readonly conflictingResource?: string,
    details?: ErrorDetails
  ) {
    super(
      message,
      HttpStatus.CONFLICT,
      'RESOURCE_CONFLICT',
      {
        ...details,
        conflictingResource,
      }
    );
    this.name = 'ConflictException';
  }
}

/**
 * Forbidden Exception - Authorization failures
 */
export class ForbiddenException extends BusinessException {
  constructor(
    message: string = 'Access forbidden',
    public readonly requiredPermission?: string,
    details?: ErrorDetails
  ) {
    super(
      message,
      HttpStatus.FORBIDDEN,
      'ACCESS_FORBIDDEN',
      {
        ...details,
        requiredPermission,
      }
    );
    this.name = 'ForbiddenException';
  }
}

/**
 * Unauthorized Exception - Authentication failures
 */
export class UnauthorizedException extends BusinessException {
  constructor(
    message: string = 'Unauthorized',
    details?: ErrorDetails
  ) {
    super(
      message,
      HttpStatus.UNAUTHORIZED,
      'UNAUTHORIZED',
      details
    );
    this.name = 'UnauthorizedException';
  }
}

/**
 * Internal Server Error Exception
 */
export class InternalServerErrorException extends BusinessException {
  constructor(
    message: string = 'Internal server error',
    details?: ErrorDetails
  ) {
    super(
      message,
      HttpStatus.INTERNAL_SERVER_ERROR,
      'INTERNAL_SERVER_ERROR',
      details
    );
    this.name = 'InternalServerErrorException';
  }
}

