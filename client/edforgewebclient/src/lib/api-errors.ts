/**
 * EdForge EMIS - API Error Handling Utilities
 * 
 * Standardized error handling for API responses
 */

import { ApiError, ApiException, ErrorCode, HttpStatus } from '@/types/api';
import axios, { AxiosError } from 'axios';

/**
 * Transform axios error to ApiException
 */
export function handleApiError(error: unknown): ApiException {
  if (axios.isAxiosError(error)) {
    const axiosError = error as AxiosError<ApiError>;
    
    // Log detailed error information for debugging
    if (process.env.NODE_ENV === 'development') {
      console.error('[API Error Handler] Axios error details:', {
        message: axiosError.message,
        code: axiosError.code,
        response: axiosError.response ? {
          status: axiosError.response.status,
          statusText: axiosError.response.statusText,
          data: axiosError.response.data,
          headers: axiosError.response.headers
        } : null,
        request: axiosError.request ? {
          url: axiosError.config?.url,
          method: axiosError.config?.method,
          baseURL: axiosError.config?.baseURL,
          headers: axiosError.config?.headers
        } : null,
        isNetworkError: !axiosError.response && axiosError.request,
        isTimeoutError: axiosError.code === 'ECONNABORTED' || axiosError.message.includes('timeout')
      });
    }
    
    // Check if response has structured error
    if (axiosError.response?.data) {
      const apiError = axiosError.response.data as ApiError;
      
      // If it's already an ApiError format
      if (apiError.errorCode && apiError.message) {
        return ApiException.fromApiError(
          apiError,
          axiosError.response.status || HttpStatus.SERVER_ERROR
        );
      }
    }
    
    // Handle network errors (no response received)
    if (!axiosError.response && axiosError.request) {
      return new ApiException(
        ErrorCode.SERVER_ERROR,
        'Network Error: Unable to connect to the API server. Please check your network connection and API Gateway configuration.',
        HttpStatus.SERVER_ERROR,
        {
          originalError: axiosError.message,
          code: axiosError.code,
          isNetworkError: true,
          url: axiosError.config?.url,
          baseURL: axiosError.config?.baseURL
        }
      );
    }
    
    // Transform HTTP status to error code
    const statusCode = axiosError.response?.status || HttpStatus.SERVER_ERROR;
    const errorCode = getErrorCodeFromStatus(statusCode);
    // Use detailed error message extraction
    const message = extractDetailedErrorMessage(axiosError);
    
    return new ApiException(
      errorCode,
      message,
      statusCode,
      axiosError.response?.data as any
    );
  }
  
  // Non-axios error
  if (error instanceof Error) {
    return new ApiException(
      ErrorCode.SERVER_ERROR,
      error.message,
      HttpStatus.SERVER_ERROR
    );
  }
  
  // Unknown error
  return new ApiException(
    ErrorCode.SERVER_ERROR,
    'An unexpected error occurred',
    HttpStatus.SERVER_ERROR
  );
}

/**
 * Map HTTP status code to ErrorCode
 */
function getErrorCodeFromStatus(statusCode: number): string {
  switch (statusCode) {
    case HttpStatus.UNAUTHORIZED:
      return ErrorCode.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ErrorCode.NOT_FOUND;
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.VALIDATION_ERROR:
      return ErrorCode.VALIDATION_ERROR;
    case HttpStatus.CONFLICT:
      return ErrorCode.VALIDATION_ERROR; // Use validation error for conflicts
    default:
      return ErrorCode.SERVER_ERROR;
  }
}

/**
 * Check if error is a specific error code
 */
export function isErrorCode(error: unknown, errorCode: string): boolean {
  if (error instanceof ApiException) {
    return error.errorCode === errorCode;
  }
  return false;
}

/**
 * Check if error is a network error
 */
export function isNetworkError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return !error.response && error.request;
  }
  return false;
}

/**
 * Check if error is a timeout error
 */
export function isTimeoutError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    return error.code === 'ECONNABORTED' || error.message.includes('timeout');
  }
  return false;
}

/**
 * Error response data structure from various sources
 * Handles NestJS BadRequestException with errors array format:
 * { message: "...", errors: ["error1", "error2", ...] }
 */
type ErrorResponseObject = {
  message?: string | string[];
  error?: string;
  errorCode?: string;
  msg?: string;
  errors?: string[]; // Array of validation error messages
  [key: string]: unknown;
};

type ErrorResponseData = string | ErrorResponseObject;

/**
 * Extract detailed error message from various error response formats
 * Handles NestJS validation errors, plain strings, arrays, and structured errors
 * 
 * Priority order:
 * 1. If errors array exists, use it (most specific)
 * 2. If message + errors exist, combine them
 * 3. If message exists (string or array), use it
 * 4. Fallback to other error formats
 */
function extractDetailedErrorMessage(axiosError: AxiosError): string {
  const responseData = axiosError.response?.data as ErrorResponseData | undefined;
  
  if (!responseData) {
    return axiosError.message || 'An unexpected error occurred';
  }
  
  // Case 1: Response data is a string (e.g., "Date overlap detected: ...")
  if (typeof responseData === 'string') {
    return responseData;
  }
  
  // Case 2: Check for errors array (highest priority - most specific validation errors)
  // Backend format: { message: "Academic year validation failed", errors: ["error1", "error2"] }
  if (responseData.errors && Array.isArray(responseData.errors) && responseData.errors.length > 0) {
    const errorsList = responseData.errors.join('. ');
    
    // If there's also a message, combine them for context
    if (responseData.message && typeof responseData.message === 'string') {
      return `${responseData.message}: ${errorsList}`;
    }
    
    // Just return the errors list if no message
    return errorsList;
  }
  
  // Case 3: NestJS format - response.data.message (string)
  if (responseData.message && typeof responseData.message === 'string') {
    return responseData.message;
  }
  
  // Case 4: NestJS validation format - response.data.message (array of constraint messages)
  if (responseData.message && Array.isArray(responseData.message)) {
    return responseData.message.join('. ');
  }
  
  // Case 5: NestJS error format - response.data.error
  if (responseData.error && typeof responseData.error === 'string') {
    // If there's also a message, combine them
    if (responseData.message) {
      const message = Array.isArray(responseData.message) 
        ? responseData.message.join('. ')
        : typeof responseData.message === 'string' 
          ? responseData.message 
          : '';
      return `${responseData.error}: ${message}`;
    }
    return responseData.error;
  }
  
  // Case 6: Structured ApiError format
  if (typeof responseData === 'object' && responseData.errorCode) {
    const message = responseData.message;
    if (typeof message === 'string') {
      return message;
    }
    if (message !== undefined && Array.isArray(message)) {
      return (message as string[]).join('. ');
    }
  }
  
  // Case 7: Fallback to any message-like property
  if (responseData.msg) {
    return responseData.msg;
  }
  
  // Case 8: Return generic error message
  return axiosError.message || 'An unexpected error occurred';
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyMessage(error: unknown): string {
  if (error instanceof ApiException) {
    // Return the API message if available
    return error.message;
  }
  
  if (axios.isAxiosError(error)) {
    if (isNetworkError(error)) {
      return 'Network error. Please check your connection and try again.';
    }
    if (isTimeoutError(error)) {
      return 'Request timed out. Please try again.';
    }
    // Use the detailed extraction function
    return extractDetailedErrorMessage(error);
  }
  
  if (error instanceof Error) {
    return error.message;
  }
  
  return 'An unexpected error occurred. Please try again.';
}

