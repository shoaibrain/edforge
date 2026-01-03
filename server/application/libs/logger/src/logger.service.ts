/**
 * Structured JSON Logger Service
 * 
 * Provides CloudWatch-compatible structured JSON logging for all microservices.
 * Supports automatic request context from AsyncLocalStorage for distributed tracing.
 * 
 * Key features:
 * - Preserves original error stack traces (never creates new Error objects)
 * - Auto-enriches logs with correlationId, tenantId, userId from AsyncLocalStorage
 * - CloudWatch-compatible JSON output in production
 * - Human-readable format in development
 */

import { Injectable, LoggerService, LogLevel } from '@nestjs/common';
import { getLogContext, LogContext } from './async-context';

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
  correlationId?: string;
  tenantId?: string;
  userId?: string;
  requestMethod?: string;
  requestPath?: string;
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
   * Automatically enriches logs with context from AsyncLocalStorage
   */
  private logMessage(
    level: string,
    message: string,
    context?: string,
    metadata?: LogMetadata,
    error?: Error | { name: string; message: string; stack?: string }
  ): void {
    // Get request context from AsyncLocalStorage (if available)
    const asyncContext = getLogContext();

    const logEntry: StructuredLogEntry = {
      timestamp: new Date().toISOString(),
      level,
      service: this.serviceName,
      message,
    };

    if (context) {
      logEntry.context = context;
    }

    // Auto-inject from AsyncLocalStorage (highest priority)
    if (asyncContext) {
      logEntry.correlationId = asyncContext.correlationId;
      logEntry.tenantId = asyncContext.tenantId;
      logEntry.userId = asyncContext.userId;
      logEntry.requestMethod = asyncContext.requestMethod;
      logEntry.requestPath = asyncContext.requestPath;
    }

    // Override with explicit metadata if provided
    if (metadata?.correlationId) {
      logEntry.correlationId = metadata.correlationId;
    }
    if (metadata?.tenantId) {
      logEntry.tenantId = metadata.tenantId;
    }
    if (metadata?.userId) {
      logEntry.userId = metadata.userId;
    }

    // Add error details if present - PRESERVE ORIGINAL STACK TRACE
    if (error) {
      logEntry.error = {
        name: error.name || 'Error',
        message: error.message,
        stack: error.stack,
      };
    }

    // Add remaining metadata (excluding fields we already extracted)
    if (metadata) {
      const { correlationId, tenantId, userId, requestId, ...restMetadata } = metadata;
      if (Object.keys(restMetadata).length > 0) {
        logEntry.metadata = restMetadata;
      }
    }

    // Output based on environment
    if (this.isDevelopment) {
      // Human-readable format for local development
      const prefix = `[${logEntry.timestamp}] [${level.toUpperCase()}] [${this.serviceName}]`;
      const contextStr = context ? `[${context}]` : '';
      const correlationStr = logEntry.correlationId ? `[${logEntry.correlationId}]` : '';
      const tenantStr = logEntry.tenantId ? `[tenant:${logEntry.tenantId}]` : '';
      const messageStr = `${prefix} ${contextStr}${correlationStr}${tenantStr} ${message}`;
      
      if (error) {
        console.error(messageStr);
        if (error.stack) {
          console.error(error.stack);
        }
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
   * Log with request context (manual context passing - legacy support)
   */
  logWithContext(
    level: string,
    message: string,
    context: RequestContext,
    metadata?: LogMetadata
  ): void {
    const enrichedMetadata: LogMetadata = {
      ...metadata,
      correlationId: context.jwtToken ? this.extractRequestId(context.jwtToken) : undefined,
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
   * 
   * IMPORTANT: This method NEVER creates new Error objects.
   * It preserves the original stack trace from:
   * 1. Error objects passed as message
   * 2. Stack trace strings passed as trace parameter
   * 
   * This ensures CloudWatch logs show the actual error origin,
   * not the logger itself.
   */
  error(message: any, trace?: string, context?: string): void {
    let errorObj: { name: string; message: string; stack?: string } | undefined;
    let errorMessage: string;

    if (message instanceof Error) {
      // Preserve the original Error object and its stack trace
      errorObj = {
        name: message.name,
        message: message.message,
        stack: message.stack,
      };
      errorMessage = message.message;
    } else {
      // Message is a string - use trace parameter if provided
      errorMessage = String(message);
      
      if (trace && typeof trace === 'string') {
        // Use the provided trace as the stack trace
        errorObj = {
          name: 'Error',
          message: errorMessage,
          stack: trace,
        };
      }
      // If no trace provided, don't create a fake Error - just log the message
    }

    this.logMessage('error', errorMessage, context, undefined, errorObj);
  }

  /**
   * Log error with request context (legacy support)
   */
  errorWithContext(
    message: string,
    context: RequestContext,
    error?: Error,
    metadata?: LogMetadata
  ): void {
    const enrichedMetadata: LogMetadata = {
      ...metadata,
      correlationId: context.jwtToken ? this.extractRequestId(context.jwtToken) : undefined,
      tenantId: context.tenantId,
      userId: context.userId,
    };

    // Preserve the original error if provided
    const errorObj = error ? {
      name: error.name,
      message: error.message,
      stack: error.stack,
    } : undefined;

    this.logMessage('error', message, undefined, enrichedMetadata, errorObj);
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
      correlationId: context.jwtToken ? this.extractRequestId(context.jwtToken) : undefined,
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
      correlationId: context.jwtToken ? this.extractRequestId(context.jwtToken) : undefined,
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
        correlationId: context.jwtToken ? this.extractRequestId(context.jwtToken) : undefined,
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
