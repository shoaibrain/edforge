/**
 * Standardized Error Response DTO
 * 
 * Consistent error response format across all microservices.
 */

/**
 * Standard error response format for all API errors
 * 
 * @example
 * {
 *   "statusCode": 404,
 *   "errorCode": "NOT_FOUND",
 *   "message": "User not found",
 *   "timestamp": "2026-01-04T00:00:00.000Z",
 *   "path": "/users/123",
 *   "correlationId": "abc-123-def"
 * }
 */
export class ErrorResponseDto {
  statusCode: number;
  errorCode: string;
  message: string;
  errors?: any[];
  details?: Record<string, unknown>;
  timestamp: string;
  requestId?: string;
  path?: string;
  correlationId?: string;
}

/**
 * Validation error details for 400 Bad Request responses
 */
export class ValidationErrorDetail {
  field: string;
  constraint: string;
  message: string;
}

/**
 * Pagination metadata for list responses
 */
export class PaginationMeta {
  count: number;
  cursor?: string;
  hasMore: boolean;
}

/**
 * Standard success response wrapper
 */
export class SuccessResponseDto<T> {
  data: T;
  pagination?: PaginationMeta;
  meta?: Record<string, unknown>;
}
