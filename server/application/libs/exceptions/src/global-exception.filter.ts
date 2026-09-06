/**
 * Global Exception Filter
 * 
 * Catches all exceptions and formats consistent error responses.
 * 
 * IMPORTANT: This filter properly passes Error objects to the logger
 * to preserve original stack traces for debugging.
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

const ENVELOPE_KEYS = new Set([
  'statusCode',
  'errorCode',
  'code',
  'message',
  'errors',
  'details',
  'error',
  'timestamp',
]);

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status: HttpStatus;
    let errorCode: string;
    let code: string | undefined;
    let message: string;
    let details: any;
    let errors: any[] | undefined;
    let domain: Record<string, unknown> = {};
    let originalStack: string | undefined;

    if (exception instanceof BusinessException) {
      // Custom business exception
      status = exception.getStatus();
      errorCode = exception.errorCode;
      message = exception.message;
      details = exception.details;
      originalStack = exception.stack;
    } else if (exception instanceof HttpException) {
      // NestJS HTTP exception
      status = exception.getStatus();
      errorCode = this.getErrorCodeFromStatus(status);
      originalStack = exception.stack;
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else if (typeof exceptionResponse === 'object') {
        const responseObj = exceptionResponse as Record<string, any>;
        message = responseObj.message || exception.message;
        errorCode = responseObj.errorCode || errorCode;
        code = typeof responseObj.code === 'string' ? responseObj.code : undefined;
        details = responseObj.details;
        // Services throw `new ConflictException({ code, message, ...payload })`
        // (finance AGREEMENT_ACTIVE carries agreementId/existingInvoiceId,
        // CONFLICTING_OPEN_INVOICES carries conflicts[]); the payload is
        // forwarded so clients can act on it. `error` is Nest's own label on
        // string-constructed exceptions, not payload.
        domain = Object.fromEntries(
          Object.entries(responseObj).filter(([key]) => !ENVELOPE_KEYS.has(key)),
        );

        // Extract Zod validation errors (nestjs-zod puts them in 'errors')
        if (!details && responseObj.errors) {
          // Top-level errors with array-form paths (for programmatic access)
          errors = Array.isArray(responseObj.errors)
            ? responseObj.errors.map((e: any) => ({
                path: e.path || [],
                message: e.message,
                code: e.code,
              }))
            : responseObj.errors;

          // details.validationErrors with dot-joined paths (for human readability)
          details = {
            validationErrors: Array.isArray(responseObj.errors)
              ? responseObj.errors.map((e: any) => ({
                  path: e.path?.join('.') || '',
                  message: e.message,
                  code: e.code,
                }))
              : responseObj.errors,
          };
        }
      } else {
        message = exception.message;
      }
    } else {
      // Unknown exception - this is a real error we need to investigate
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      errorCode = 'INTERNAL_SERVER_ERROR';
      message = 'An unexpected error occurred';
      
      // Log the ACTUAL error with its ORIGINAL stack trace
      // NestJS Logger.error(message, trace?, context?) - pass stack as trace
      if (exception instanceof Error) {
        this.logger.error(
          exception.message,
          exception.stack,
          `${GlobalExceptionFilter.name}:UnhandledException`
        );
        originalStack = exception.stack;
      } else {
        this.logger.error(
          String(exception),
          undefined,
          `${GlobalExceptionFilter.name}:UnhandledException`
        );
      }
    }

    // Extract request ID from headers or JWT
    const requestId = this.extractRequestId(request);

    // Envelope fields come last so a payload key can never overwrite them.
    const errorResponse: ErrorResponseDto = {
      statusCode: status,
      errorCode,
      ...(code && { code }),
      message,
      ...(errors && { errors }),
      details,
      ...domain,
      timestamp: new Date().toISOString(),
      requestId,
      path: request.url,
    };

    // Log the HTTP error response
    // Format: [METHOD] /path - STATUS CODE: message
    const logMessage = `[${request.method}] ${request.url} - ${status} ${errorCode}: ${message}`;

    // Severity follows the status class (issue #468). A 4xx is a request
    // the service refused on purpose — an operator hitting a guard such as
    // "this agreement already priced an invoice this term" is a designed
    // product outcome with its own dialog, not a failure. Logging those at
    // ERROR with a stack made every error dashboard and alarm on this log
    // group a measure of operator behaviour, and buried real 5xx among
    // them. Only 5xx and unhandled exceptions keep ERROR and the stack;
    // the 4xx stack is the framework's throw site and carries nothing the
    // message does not already say.
    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        logMessage,
        originalStack,
        GlobalExceptionFilter.name
      );
    } else {
      this.logger.warn(
        logMessage,
        GlobalExceptionFilter.name
      );
    }

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

    // Try X-Correlation-ID header
    const correlationIdHeader = request.headers['x-correlation-id'];
    if (correlationIdHeader && typeof correlationIdHeader === 'string') {
      return correlationIdHeader;
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
