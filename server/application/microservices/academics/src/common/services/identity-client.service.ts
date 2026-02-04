/**
 * Identity Client Service
 * 
 * HTTP client for calling the Identity Service from Academics Service.
 * Uses circuit breaker and retry strategy for resilience.
 */

import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { HttpClientService, RequestContext } from '@app/http-client';

/**
 * School response from Identity Service
 */
export interface SchoolResponse {
  schoolId: string;
  schoolCode: string;
  name: string;
  shortName?: string;
  schoolType: string;
  gradeRange: {
    start: string;
    end: string;
  };
  status: string;
  timezone: string;
  locale: string;
  academicCalendarType: 'semester' | 'quarter' | 'trimester';
  currentAcademicYearId?: string;
}

/**
 * Academic year response from Identity Service
 */
export interface AcademicYearResponse {
  yearId: string;
  schoolId: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  isCurrent: boolean;
}

@Injectable()
export class IdentityClientService {
  private readonly logger = new Logger(IdentityClientService.name);
  private readonly identityServiceUrl: string;

  constructor(private readonly httpClient: HttpClientService) {
    // Use ECS Service Connect DNS name for internal service communication
    this.identityServiceUrl = process.env.IDENTITY_SERVICE_URL || 
      'http://identity-api.default.sc:3010';
    
    this.logger.log(`Identity Client initialized with URL: ${this.identityServiceUrl}`);
  }

  /**
   * Get school by ID
   */
  async getSchool(schoolId: string, context: RequestContext): Promise<SchoolResponse> {
    try {
      const response = await this.httpClient.get<SchoolResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}`,
        {},
        context
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error, 'getSchool', schoolId);
      throw error;
    }
  }

  /**
   * Validate school exists
   */
  async validateSchoolExists(schoolId: string, context: RequestContext): Promise<boolean> {
    try {
      await this.getSchool(schoolId, context);
      return true;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Get current academic year for a school
   */
  async getCurrentAcademicYear(schoolId: string, context: RequestContext): Promise<AcademicYearResponse | null> {
    try {
      const response = await this.httpClient.get<AcademicYearResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/academic-years/current`,
        {},
        context
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getCurrentAcademicYear', schoolId);
      throw error;
    }
  }

  /**
   * Get all academic years for a school
   */
  async getAcademicYears(
    schoolId: string, 
    context: RequestContext
  ): Promise<AcademicYearResponse[]> {
    try {
      const response = await this.httpClient.get<{ items: AcademicYearResponse[] }>(
        `${this.identityServiceUrl}/schools/${schoolId}/academic-years`,
        {},
        context
      );
      return response.data.items;
    } catch (error: any) {
      this.handleError(error, 'getAcademicYears', schoolId);
      throw error;
    }
  }

  /**
   * Handle HTTP errors with proper logging and error transformation
   */
  private handleError(error: any, operation: string, resourceId: string): never {
    // Check for circuit breaker open
    if (error.isCircuitBreakerOpen) {
      this.logger.error(`Circuit breaker OPEN for Identity Service during ${operation}`, {
        operation,
        resourceId
      });
      throw new ServiceUnavailableException(
        'Identity service is temporarily unavailable. Please try again later.'
      );
    }

    // Check for 404 Not Found
    if (error.response?.status === 404) {
      throw new NotFoundException(`Resource not found: ${resourceId}`);
    }

    // Log and rethrow other errors
    this.logger.error(`Error in ${operation}: ${error.message}`, {
      operation,
      resourceId,
      status: error.response?.status,
      error: error.message
    });

    // For 5xx errors, wrap in ServiceUnavailableException
    if (error.response?.status >= 500) {
      throw new ServiceUnavailableException(
        'Identity service encountered an error. Please try again later.'
      );
    }

    throw error;
  }
}

