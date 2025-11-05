/**
 * EdForge EMIS - Common API Type Definitions
 * 
 * Shared types for API requests, responses, and error handling
 */

/**
 * Standard API Error Response
 * Matches backend error format from academic/school services
 * 
 * Backend validation errors may include:
 * - message: Summary message
 * - errors: Array of specific validation error messages
 */
export interface ApiError {
  errorCode: string;
  message: string;
  details?: Record<string, any>;
  timestamp?: string;
  errors?: string[]; // Array of validation error messages (from BadRequestException)
}

/**
 * Common error codes from backend services
 */
export enum ErrorCode {
  // Classroom errors
  CLASSROOM_1001 = 'CLASSROOM_1001', // Classroom not found
  CLASSROOM_1002 = 'CLASSROOM_1002', // Invalid classroom data
  CLASSROOM_1003 = 'CLASSROOM_1003', // Classroom creation failed
  CLASSROOM_1004 = 'CLASSROOM_1004', // Classroom code already exists
  
  // Enrollment errors
  ENROLLMENT_2001 = 'ENROLLMENT_2001', // Student already enrolled
  ENROLLMENT_2002 = 'ENROLLMENT_2002', // Classroom at capacity
  ENROLLMENT_2003 = 'ENROLLMENT_2003', // Enrollment not found
  
  // Assignment errors
  ASSIGNMENT_3001 = 'ASSIGNMENT_3001', // Assignment not found
  ASSIGNMENT_3002 = 'ASSIGNMENT_3002', // Invalid assignment data
  
  // Grade errors
  GRADE_4001 = 'GRADE_4001', // Grade not found
  GRADE_4002 = 'GRADE_4002', // Invalid grade value
  
  // Attendance errors
  ATTENDANCE_5001 = 'ATTENDANCE_5001', // Attendance record not found
  ATTENDANCE_5002 = 'ATTENDANCE_5002', // Invalid attendance data
  
  // School errors
  SCHOOL_6001 = 'SCHOOL_6001', // School not found
  SCHOOL_6002 = 'SCHOOL_6002', // Invalid school data
  SCHOOL_6003 = 'SCHOOL_6003', // School code already exists
  
  // Academic Year errors
  ACADEMIC_YEAR_7001 = 'ACADEMIC_YEAR_7001', // Academic year not found
  ACADEMIC_YEAR_7002 = 'ACADEMIC_YEAR_7002', // Invalid academic year data
  ACADEMIC_YEAR_7003 = 'ACADEMIC_YEAR_7003', // Academic year already exists
  
  // Department errors
  DEPARTMENT_8001 = 'DEPARTMENT_8001', // Department not found
  DEPARTMENT_8002 = 'DEPARTMENT_8002', // Department code already exists
  
  // User errors
  USER_9001 = 'USER_9001', // User not found
  USER_9002 = 'USER_9002', // Invalid user data
  USER_9003 = 'USER_9003', // User email already exists
  
  // Generic errors
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  SERVER_ERROR = 'SERVER_ERROR',
}

/**
 * Standard API Response wrapper
 */
export interface ApiResponse<T = any> {
  data?: T;
  error?: ApiError;
  meta?: {
    total?: number;
    page?: number;
    limit?: number;
    totalPages?: number;
  };
}

/**
 * Pagination parameters
 */
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Filter parameters
 */
export interface FilterParams {
  [key: string]: string | number | boolean | string[] | undefined;
}

/**
 * Query parameters combining pagination and filters
 */
export interface QueryParams extends PaginationParams, FilterParams {}

/**
 * HTTP Status codes
 */
export enum HttpStatus {
  OK = 200,
  CREATED = 201,
  NO_CONTENT = 204,
  BAD_REQUEST = 400,
  UNAUTHORIZED = 401,
  FORBIDDEN = 403,
  NOT_FOUND = 404,
  CONFLICT = 409,
  VALIDATION_ERROR = 422,
  SERVER_ERROR = 500,
}

/**
 * Custom error class for API errors
 */
export class ApiException extends Error {
  constructor(
    public errorCode: string,
    public message: string,
    public statusCode: number = 500,
    public details?: Record<string, any>
  ) {
    super(message);
    this.name = 'ApiException';
  }

  static fromApiError(error: ApiError, statusCode: number = 500): ApiException {
    return new ApiException(error.errorCode, error.message, statusCode, error.details);
  }
}

