/**
 * Correlation ID Middleware
 * 
 * Generates or propagates correlation IDs for distributed tracing across services.
 * Essential for tracing requests through Identity -> Academics service calls.
 * 
 * Uses AsyncLocalStorage to automatically propagate request context through
 * all async operations within the request lifecycle - no manual parameter passing needed.
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';
import { asyncLocalStorage, LogContext } from './async-context';

// Extend Express Request to include correlation context
declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      tenantId?: string;
      userId?: string;
      requestStartTime: number;
    }
  }
}

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';
export const TENANT_ID_HEADER = 'x-tenant-id';
export const USER_ID_HEADER = 'x-user-id';

@Injectable()
export class CorrelationMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    // Generate or extract correlation ID
    const correlationId = 
      (req.headers[CORRELATION_ID_HEADER] as string) ||
      (req.headers[REQUEST_ID_HEADER] as string) ||
      uuid();

    const requestStartTime = Date.now();

    // Extract tenant and user context from headers (set by API Gateway/Lambda Authorizer)
    const tenantId = req.headers[TENANT_ID_HEADER] as string;
    const userId = req.headers[USER_ID_HEADER] as string;

    // Attach to request object (for backward compatibility)
    req.correlationId = correlationId;
    req.requestStartTime = requestStartTime;
    req.tenantId = tenantId;
    req.userId = userId;

    // Set correlation ID in response headers for client tracing
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    // Create log context for AsyncLocalStorage
    const logContext: LogContext = {
      correlationId,
      tenantId,
      userId,
      requestMethod: req.method,
      requestPath: req.originalUrl || req.url,
      requestStartTime,
    };

    // Run the rest of the request within the AsyncLocalStorage context
    // This ensures all async operations have access to the log context
    asyncLocalStorage.run(logContext, () => {
      next();
    });
  }
}

/**
 * Functional middleware for use with app.use()
 * 
 * This version wraps the next() call in AsyncLocalStorage.run() so that
 * all downstream middleware, guards, interceptors, and handlers have
 * access to the log context automatically.
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  // Generate or extract correlation ID
  const correlationId = 
    (req.headers[CORRELATION_ID_HEADER] as string) ||
    (req.headers[REQUEST_ID_HEADER] as string) ||
    uuid();

  const requestStartTime = Date.now();

  // Extract tenant and user context from headers
  const tenantId = req.headers[TENANT_ID_HEADER] as string;
  const userId = req.headers[USER_ID_HEADER] as string;

  // Attach to request object (for backward compatibility)
  req.correlationId = correlationId;
  req.requestStartTime = requestStartTime;
  req.tenantId = tenantId;
  req.userId = userId;

  // Set correlation ID in response headers
  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  // Create log context for AsyncLocalStorage
  const logContext: LogContext = {
    correlationId,
    tenantId,
    userId,
    requestMethod: req.method,
    requestPath: req.originalUrl || req.url,
    requestStartTime,
  };

  // Run the rest of the request within the AsyncLocalStorage context
  asyncLocalStorage.run(logContext, () => {
    next();
  });
}
