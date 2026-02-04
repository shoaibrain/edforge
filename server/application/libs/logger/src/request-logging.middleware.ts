/**
 * Request Logging Middleware
 * 
 * Logs all incoming HTTP requests and outgoing responses with:
 * - Correlation ID for distributed tracing
 * - Tenant context for multi-tenant debugging
 * - Request duration for performance monitoring
 * - Sanitized request/response data (no sensitive fields)
 */

import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

// Fields to exclude from logging (security)
const SENSITIVE_HEADERS = ['authorization', 'cookie', 'x-api-key'];
const SENSITIVE_BODY_FIELDS = ['password', 'token', 'secret', 'ssn', 'creditCard'];

@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, correlationId, tenantId, userId } = req;
    const requestStartTime = req.requestStartTime || Date.now();

    // Log incoming request
    const requestLog = {
      type: 'request',
      correlationId,
      tenantId,
      userId,
      method,
      url: originalUrl,
      userAgent: req.headers['user-agent'],
      contentType: req.headers['content-type'],
      contentLength: req.headers['content-length'],
    };

    // Log request (debug level to avoid noise in production)
    if (process.env.NODE_ENV !== 'production' || process.env.LOG_REQUESTS === 'true') {
      this.logger.debug(`→ ${method} ${originalUrl}`, requestLog);
    }

    // Capture response
    const originalSend = res.send.bind(res);
    res.send = (body: any): Response => {
      const duration = Date.now() - requestStartTime;
      const { statusCode } = res;

      // Log response
      const responseLog = {
        type: 'response',
        correlationId,
        tenantId,
        userId,
        method,
        url: originalUrl,
        statusCode,
        duration: `${duration}ms`,
        contentLength: res.get('content-length'),
      };

      // Determine log level based on status code
      if (statusCode >= 500) {
        this.logger.error(`← ${method} ${originalUrl} ${statusCode} (${duration}ms)`, responseLog);
      } else if (statusCode >= 400) {
        this.logger.warn(`← ${method} ${originalUrl} ${statusCode} (${duration}ms)`, responseLog);
      } else if (process.env.NODE_ENV !== 'production' || process.env.LOG_REQUESTS === 'true') {
        this.logger.debug(`← ${method} ${originalUrl} ${statusCode} (${duration}ms)`, responseLog);
      }

      return originalSend(body);
    };

    next();
  }
}

/**
 * Sanitize headers by removing sensitive values
 */
function sanitizeHeaders(headers: Record<string, any>): Record<string, any> {
  const sanitized = { ...headers };
  for (const key of SENSITIVE_HEADERS) {
    if (sanitized[key]) {
      sanitized[key] = '[REDACTED]';
    }
  }
  return sanitized;
}

/**
 * Sanitize body by removing sensitive fields
 */
function sanitizeBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sanitized = { ...body };
  for (const key of Object.keys(sanitized)) {
    if (SENSITIVE_BODY_FIELDS.some(field => key.toLowerCase().includes(field.toLowerCase()))) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof sanitized[key] === 'object') {
      sanitized[key] = sanitizeBody(sanitized[key]);
    }
  }
  return sanitized;
}

