/**
 * Structured JSON Logger Service
 * 
 * Provides CloudWatch-compatible structured JSON logging for all microservices.
 * Supports request correlation IDs for distributed tracing.
 */

import { Injectable, LoggerService, LogLevel } from '@nestjs/common';

/**
 * Request context for logging - defined locally to avoid external dependencies
 * This keeps the logger lib self-contained and avoids Docker build issues
 */
export interface RequestContext {
  userId: string;
  jwtToken: string;
  tenantId: string;
  userName?: string;
  userRole?: string;
}

export interface LogMetadata {
  [key: string]: any;
}

export interface StructuredLogEntry {
  timestamp: string;
  level: string;
  service: string;
  context?: string;
  message: string;
  requestId?: string;
  tenantId?: string;
  userId?: string;
  metadata?: LogMetadata;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

@Injectable()
export class StructuredLogger implements LoggerService {
  private readonly serviceName: string;
  private readonly isDevelopment: boolean;

  constructor(serviceName?: string) {
    this.serviceName = serviceName || process.env.SERVICE_NAME || 'edforge-service';
    this.isDevelopment = process.env.NODE_ENV !== 'production';
  }

  /**
   * Log a message with structured JSON output
   */
  private logMessage(
    level: string,
    message: string,
    context?: string,
    metadata?: LogMetadata,
    error?: Error
  ): void {
    const logEntry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
    };

    if (context) {
      logEntry.context = context;
    }

    // Extract request context from metadata if available
    if (metadata?.requestId) {
      logEntry.requestId = metadata.requestId;
    }
    if (metadata?.tenantId) {
      logEntry.tenantId = metadata.tenantId;
    }
    if (metadata?.userId) {
      logEntry.userId = metadata.userId;
    }

    // Add error details if present
    if (error) {
      logEntry.error = {
        name: error.name,
        message: error.message,
        stack: error.stack,
      };
    }

    // Add remaining metadata
    if (metadata) {
      const { requestId, tenantId, userId, ...restMetadata } = metadata;
      if (Object.keys(restMetadata).length > 0) {
        logEntry.metadata = restMetadata;
      }
    }

    // Output based on environment
    if (this.isDevelopment) {
      // Human-readable format for local development
      const prefix = `[${logEntry.timestamp}] [${level.toUpperCase()}] [${this.serviceName}]`;
      const contextStr = context ? `[${context}]` : '';
      const messageStr = `${prefix} ${contextStr} ${message}`;
      
      if (error) {
        console.error(messageStr, error);
      } else if (metadata && Object.keys(metadata).length > 0) {
        console.log(messageStr, metadata);
      } else {
        console.log(messageStr);
      }
    } else {
      // Structured JSON for production (CloudWatch)
      console.log(JSON.stringify(logEntry));
    }
  }

  /**
   * Log with request context
   */
  logWithContext(
    level: string,
    message: string,
    context: RequestContext,
    metadata?: LogMetadata
  ): void {
    const enrichedMetadata: LogMetadata = {
      ...metadata,
      requestId: context.jwtToken ? this.extractRequestId(context.jwtToken) : undefined,
      tenantId: context.tenantId,
      userId: context.userId,
    };

    this.logMessage(level, message, undefined, enrichedMetadata);
  }

  /**
   * Extract request ID from JWT token (if available)
   */
  private extractRequestId(jwtToken: string): string | undefined {
    try {
      // JWT tokens have format: header.payload.signature
      const payload = jwtToken.split('.')[1];
      if (payload) {
        const decoded = JSON.parse(Buffer.from(payload, 'base64').toString());
        return decoded.requestId || decoded.jti || undefined;
      }
    } catch {
      // Ignore parsing errors
    }
    return undefined;
  }

  /**
   * Log error level
   */
  error(message: any, trace?: string, context?: string): void {
    const error = message instanceof Error ? message : new Error(String(message));
    this.logMessage('error', error.message, context, { trace }, error);
  }

  /**
   * Log error with request context
   */
  errorWithContext(
    message: string,
    context: RequestContext,
    error?: Error,
    metadata?: LogMetadata
  ): void {
    const enrichedMetadata: LogMetadata = {
      ...metadata,
      requestId: context.jwtToken ? this.extractRequestId(context.jwtToken) : undefined,
      tenantId: context.tenantId,
      userId: context.userId,
    };

    const err = error || new Error(message);
    this.logMessage('error', message, undefined, enrichedMetadata, err);
  }

  /**
   * Log warn level
   */
  warn(message: any, context?: string): void {
    this.logMessage('warn', String(message), context);
  }

  /**
   * Log warn with request context
   */
  warnWithContext(
    message: string,
    context: RequestContext,
    metadata?: LogMetadata
  ): void {
    const enrichedMetadata: LogMetadata = {
      ...metadata,
      requestId: context.jwtToken ? this.extractRequestId(context.jwtToken) : undefined,
      tenantId: context.tenantId,
      userId: context.userId,
    };

    this.logMessage('warn', message, undefined, enrichedMetadata);
  }

  /**
   * Log info level
   */
  log(message: any, context?: string): void {
    this.logMessage('info', String(message), context);
  }

  /**
   * Log info with request context (shorthand for logWithContext with 'info' level)
   */
  infoWithContext(
    message: string,
    context: RequestContext,
    metadata?: LogMetadata
  ): void {
    const enrichedMetadata: LogMetadata = {
      ...metadata,
      requestId: context.jwtToken ? this.extractRequestId(context.jwtToken) : undefined,
      tenantId: context.tenantId,
      userId: context.userId,
    };

    this.logMessage('info', message, undefined, enrichedMetadata);
  }

  /**
   * Log debug level
   */
  debug(message: any, context?: string): void {
    if (this.isDevelopment || process.env.LOG_LEVEL === 'debug') {
      this.logMessage('debug', String(message), context);
    }
  }

  /**
   * Log debug with request context
   */
  debugWithContext(
    message: string,
    context: RequestContext,
    metadata?: LogMetadata
  ): void {
    if (this.isDevelopment || process.env.LOG_LEVEL === 'debug') {
      const enrichedMetadata: LogMetadata = {
        ...metadata,
        requestId: context.jwtToken ? this.extractRequestId(context.jwtToken) : undefined,
        tenantId: context.tenantId,
        userId: context.userId,
      };

      this.logMessage('debug', message, undefined, enrichedMetadata);
    }
  }

  /**
   * Log verbose level
   */
  verbose(message: any, context?: string): void {
    if (this.isDevelopment || process.env.LOG_LEVEL === 'verbose') {
      this.logMessage('verbose', String(message), context);
    }
  }

  /**
   * Set log levels (NestJS LoggerService interface)
   */
  setLogLevels(levels: LogLevel[]): void {
    // Not implemented - log levels controlled by environment variables
  }
}

