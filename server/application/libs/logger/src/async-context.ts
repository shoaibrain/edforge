/**
 * Async Context Store for Request-Scoped Logging
 * 
 * Uses Node.js AsyncLocalStorage to automatically propagate request context
 * through async operations without manual parameter passing.
 * 
 * This is the industry-standard approach for distributed tracing and
 * multi-tenant logging in Node.js applications.
 */

import { AsyncLocalStorage } from 'async_hooks';

/**
 * Context data stored for each request
 */
export interface LogContext {
  /** Unique ID for tracing request across services */
  correlationId: string;
  /** Tenant identifier for multi-tenant isolation */
  tenantId?: string;
  /** Current user ID from JWT */
  userId?: string;
  /** HTTP method (GET, POST, etc.) */
  requestMethod?: string;
  /** Request path/URL */
  requestPath?: string;
  /** Request start time for duration calculation */
  requestStartTime?: number;
}

/**
 * AsyncLocalStorage instance for request context
 * This provides automatic context propagation through async operations
 */
export const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

/**
 * Get the current request context from AsyncLocalStorage
 * Returns undefined if called outside of a request context
 */
export function getLogContext(): LogContext | undefined {
  return asyncLocalStorage.getStore();
}

/**
 * Run a function within a specific log context
 * Used by middleware to set up the context for the request lifecycle
 */
export function runWithLogContext<T>(context: LogContext, fn: () => T): T {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Update the current log context (if one exists)
 * Useful for adding user info after authentication
 */
export function updateLogContext(updates: Partial<LogContext>): void {
  const current = asyncLocalStorage.getStore();
  if (current) {
    Object.assign(current, updates);
  }
}

