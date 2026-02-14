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

/**
 * Staff response from Identity Service
 */
export interface StaffResponse {
  staffId: string;
  staffUniqueId?: string;
  firstName: string;
  lastSurname: string;
  email: string;
  role: string;
  employmentStatus: string;
  primarySchoolId?: string;
  department?: string;
  title?: string;
  schoolAssignments?: Array<{
    schoolId: string;
    isPrimary: boolean;
    role?: string;
  }>;
}

/**
 * Paginated staff list response from Identity Service
 */
export interface StaffListResponse {
  items: StaffResponse[];
  lastEvaluatedKey?: string;
  hasMore: boolean;
}

/**
 * Academic session response from Identity Service
 */
export interface AcademicSessionResponse {
  academicSessionId: string;
  schoolId: string;
  sessionName: string;
  beginDate: string;
  endDate: string;
}

/**
 * Class period response from Identity Service
 */
export interface ClassPeriodResponse {
  periodId: string;
  schoolId: string;
  classPeriodName: string;
  startTime: string;
  endTime: string;
}

/**
 * Location response from Identity Service
 */
export interface LocationResponse {
  locationId: string;
  schoolId: string;
  roomNumber: string;
  locationType: string;
}

/**
 * Calendar date response from Identity Service
 */
export interface CalendarDateResponse {
  calendarDateId: string;
  schoolId: string;
  date: string;
  calendarEventType: string; // 'instructional' | 'holiday' | 'teacher_workday' | etc.
  description?: string;
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
   * Get staff member by ID
   */
  async getStaff(staffId: string, context: RequestContext): Promise<StaffResponse> {
    try {
      const response = await this.httpClient.get<StaffResponse>(
        `${this.identityServiceUrl}/staff/${staffId}`,
        {},
        context
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error, 'getStaff', staffId);
    }
  }

  /**
   * Get staff member by email (User-to-Staff bridge)
   */
  async getStaffByEmail(email: string, context: RequestContext): Promise<StaffResponse | null> {
    try {
      const response = await this.httpClient.get<StaffResponse>(
        `${this.identityServiceUrl}/staff/by-email`,
        { params: { email } },
        context
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getStaffByEmail', email);
    }
  }

  /**
   * Get all staff for a school
   */
  async getSchoolStaff(
    schoolId: string,
    context: RequestContext,
    filters?: { role?: string; limit?: number },
  ): Promise<StaffListResponse> {
    try {
      const params: Record<string, any> = {};
      if (filters?.role) params.role = filters.role;
      if (filters?.limit) params.limit = filters.limit;

      const response = await this.httpClient.get<StaffListResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/staff`,
        { params },
        context
      );
      return response.data;
    } catch (error: any) {
      this.handleError(error, 'getSchoolStaff', schoolId);
    }
  }

  /**
   * Validate staff member exists
   */
  async validateStaffExists(staffId: string, context: RequestContext): Promise<boolean> {
    try {
      await this.getStaff(staffId, context);
      return true;
    } catch (error: any) {
      if (error.response?.status === 404 || error instanceof NotFoundException) {
        return false;
      }
      throw error;
    }
  }

  // ============================================
  // Master Schedule (Sprint 3)
  // ============================================

  /**
   * Get academic session by ID
   */
  async getAcademicSession(
    schoolId: string,
    sessionId: string,
    context: RequestContext,
  ): Promise<AcademicSessionResponse | null> {
    try {
      const response = await this.httpClient.get<AcademicSessionResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/academic-sessions/${sessionId}`,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getAcademicSession', sessionId);
    }
  }

  /**
   * Get class period by ID
   */
  async getClassPeriod(
    schoolId: string,
    periodId: string,
    context: RequestContext,
  ): Promise<ClassPeriodResponse | null> {
    try {
      const response = await this.httpClient.get<ClassPeriodResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/class-periods/${periodId}`,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getClassPeriod', periodId);
    }
  }

  /**
   * Get location by ID
   */
  async getLocation(
    schoolId: string,
    locationId: string,
    context: RequestContext,
  ): Promise<LocationResponse | null> {
    try {
      const response = await this.httpClient.get<LocationResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/locations/${locationId}`,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getLocation', locationId);
    }
  }

  // ============================================
  // Calendar (Sprint 5)
  // ============================================

  /**
   * Get calendar date info for a school on a specific date
   * Returns null if calendar date is not configured (graceful degradation)
   */
  async getCalendarDate(
    schoolId: string,
    date: string,
    context: RequestContext,
  ): Promise<CalendarDateResponse | null> {
    try {
      const response = await this.httpClient.get<CalendarDateResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/calendar-dates/${date}`,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getCalendarDate', `${schoolId}/${date}`);
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

