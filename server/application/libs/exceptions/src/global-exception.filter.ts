/**
 * Global Exception Filter
 * 
 * Catches all exceptions and formats consistent error responses.
 */

import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ErrorResponseDto } from './error-response.dto';
import { BusinessException } from './exceptions';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: HttpStatus;
    let errorCode: string;
    let message: string;
    let details: any;

    if (exception instanceof BusinessException) {
      // Custom business exception
      status = exception.getStatus();
      errorCode = exception.errorCode;
      message = exception.message;
      details = exception.details;
    } else if (exception instanceof HttpException) {
      // NestJS HTTP exception
      status = exception.getStatus();
      errorCode = this.getErrorCodeFromStatus(status);
      const exceptionResponse = exception.getResponse();
      
      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as any;
        message = responseObj.message || exception.message;
        errorCode = responseObj.errorCode || errorCode;
        details = responseObj.details;
      } else {
        message = exception.message;
      }
    } else {
      // Unknown exception
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      errorCode = 'INTERNAL_SERVER_ERROR';
      message = 'An unexpected error occurred';
      
      // Log full error details
      this.logger.error('Unhandled exception:', {
        error: exception instanceof Error ? exception.message : String(exception),
        stack: exception instanceof Error ? exception.stack : undefined,
        path: request.url,
        method: request.method,
      });
    }

    // Extract request ID from headers or JWT
    const requestId = this.extractRequestId(request);

    const errorResponse: ErrorResponseDto = {
      statusCode: status,
      errorCode,
      message,
      details,
      timestamp: new Date().toISOString(),
      requestId,
      path: request.url,
    };

    // Log error
    this.logger.error(
      `[${request.method}] ${request.url} - ${status} ${errorCode}: ${message}`,
      {
        errorCode,
        status,
        path: request.url,
        method: request.method,
        requestId,
        details,
      }
    );

    response.status(status).json(errorResponse);
  }

  /**
   * Extract request ID from request headers or JWT token
   */
  private extractRequestId(request: Request): string | undefined {
    // Try X-Request-ID header first
    const requestIdHeader = request.headers['x-request-id'];
    if (requestIdHeader && typeof requestIdHeader === 'string') {
      return requestIdHeader;
    }

    // Try to extract from JWT token
    const authHeader = request.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const payload = JSON.parse(
          Buffer.from(token.split('.')[1], 'base64').toString()
        );
        return payload.requestId || payload.jti;
      } catch {
        // Ignore parsing errors
      }
    }

    return undefined;
  }

  /**
   * Map HTTP status code to error code
   */
  private getErrorCodeFromStatus(status: HttpStatus): string {
    const statusCodeMap: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'BAD_REQUEST',
      [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
      [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.METHOD_NOT_ALLOWED]: 'METHOD_NOT_ALLOWED',
      [HttpStatus.CONFLICT]: 'CONFLICT',
      [HttpStatus.UNPROCESSABLE_ENTITY]: 'UNPROCESSABLE_ENTITY',
      [HttpStatus.TOO_MANY_REQUESTS]: 'TOO_MANY_REQUESTS',
      [HttpStatus.INTERNAL_SERVER_ERROR]: 'INTERNAL_SERVER_ERROR',
      [HttpStatus.BAD_GATEWAY]: 'BAD_GATEWAY',
      [HttpStatus.SERVICE_UNAVAILABLE]: 'SERVICE_UNAVAILABLE',
      [HttpStatus.GATEWAY_TIMEOUT]: 'GATEWAY_TIMEOUT',
    };

    return statusCodeMap[status] || 'UNKNOWN_ERROR';
  }
}

