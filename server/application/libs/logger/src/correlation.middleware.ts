/**
 * Correlation ID Middleware
 * 
 * Generates or propagates correlation IDs for distributed tracing across services.
 * Essential for tracing requests through Identity -> Academics service calls.
 */

import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { v4 as uuid } from 'uuid';

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

    // Attach to request object
    req.correlationId = correlationId;
    req.requestStartTime = Date.now();

    // Extract tenant and user context from headers (set by API Gateway/Lambda Authorizer)
    req.tenantId = req.headers[TENANT_ID_HEADER] as string;
    req.userId = req.headers[USER_ID_HEADER] as string;

    // Set correlation ID in response headers for client tracing
    res.setHeader(CORRELATION_ID_HEADER, correlationId);

    next();
  }
}

/**
 * Functional middleware for use with app.use()
 */
export function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = 
    (req.headers[CORRELATION_ID_HEADER] as string) ||
    (req.headers[REQUEST_ID_HEADER] as string) ||
    uuid();

  req.correlationId = correlationId;
  req.requestStartTime = Date.now();
  req.tenantId = req.headers[TENANT_ID_HEADER] as string;
  req.userId = req.headers[USER_ID_HEADER] as string;

  res.setHeader(CORRELATION_ID_HEADER, correlationId);

  next();
}

