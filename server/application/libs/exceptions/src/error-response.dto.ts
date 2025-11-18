/**
 * Standardized Error Response DTO
 * 
 * Consistent error response format across all microservices.
 */

export interface ErrorResponseDto {
  statusCode: number;
  errorCode: string;
  message: string;
  details?: {
    [key: string]: any;
  };
  timestamp: string;
  requestId?: string;
  path?: string;
}

