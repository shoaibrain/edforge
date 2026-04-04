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
  isInstructionalDay: boolean;
  isHoliday: boolean;
  isWeekend: boolean;
  dayOfWeek: string;
  calendarEvents?: Array<{
    description?: string;
    isAllDay?: boolean;
    eventType: string;
  }>;
}

/**
 * Parent account response from Identity Service
 */
export interface ParentAccountResponse {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  schoolId: string;
  studentId: string;
  schoolRole: 'Parent';
  status: string;
}

/**
 * Student account response from Identity Service
 */
export interface StudentAccountResponse {
  userId: string;
  email: string;
  firstName: string;
  lastName: string;
  schoolId: string;
  studentId: string;
  schoolRole: 'Student';
  status: string;
}

/** Cache entry for user role lookups */
interface RoleCacheEntry {
  data: { role: string; staffId?: string } | null;
  cachedAt: number;
}

const ROLE_CACHE_TTL_MS = 3 * 60 * 1000; // 3 minutes (reduced from 10 to limit staleness on role changes)

@Injectable()
export class IdentityClientService {
  private readonly logger = new Logger(IdentityClientService.name);
  private readonly identityServiceUrl: string;
  /** In-memory cache for user role lookups (avoids repeated Identity Service calls) */
  private readonly roleCache = new Map<string, RoleCacheEntry>();

  // Timeout and retry configuration for permission checks
  private readonly REQUEST_TIMEOUT = 5000; // 5 seconds
  private readonly MAX_RETRIES = 2;
  private readonly BACKOFF_BASE = 100; // ms

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
    const start = Date.now();
    this.logger.debug(`getSchool: schoolId=${schoolId}`);
    try {
      const response = await this.httpClient.get<SchoolResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}`,
        {},
        context
      );
      this.logger.debug(`getSchool: schoolId=${schoolId} status=200 ${Date.now() - start}ms`);
      return response.data;
    } catch (error: any) {
      this.logger.debug(`getSchool: schoolId=${schoolId} status=${error.response?.status || 'ERR'} ${Date.now() - start}ms`);
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
    const start = Date.now();
    this.logger.debug(`getCurrentAcademicYear: schoolId=${schoolId}`);
    try {
      const response = await this.httpClient.get<AcademicYearResponse>(
        `${this.identityServiceUrl}/schools/${schoolId}/academic-years/current`,
        {},
        context
      );
      this.logger.debug(`getCurrentAcademicYear: schoolId=${schoolId} yearId=${response.data?.yearId} ${Date.now() - start}ms`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        this.logger.debug(`getCurrentAcademicYear: schoolId=${schoolId} not found (404) ${Date.now() - start}ms`);
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
  // RBAC Permission Check
  // ============================================

  /**
   * Check if a user has permission for a specific resource:action at a school.
   * Calls the identity service's permission check endpoint.
   *
   * Fail-closed: if the identity service is unavailable, access is denied.
   *
   * @returns { allowed: boolean, reason?: string }
   */
  async checkPermission(
    userId: string,
    resource: string,
    action: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<{ allowed: boolean; reason?: string }> {
    const start = Date.now();
    this.logger.debug(`checkPermission: userId=${userId} ${resource}:${action} schoolId=${schoolId}`);
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await Promise.race([
          this.httpClient.post<{ allowed: boolean; reason?: string }>(
            `${this.identityServiceUrl}/users/${userId}/roles/permissions/check`,
            { resource, action, schoolId },
            {},
            context,
          ),
          this.timeoutPromise<never>(this.REQUEST_TIMEOUT),
        ]);
        this.logger.debug(
          `checkPermission: userId=${userId} ${resource}:${action} allowed=${response.data.allowed} attempt=${attempt} ${Date.now() - start}ms`,
        );
        return response.data;
      } catch (error: any) {
        if (attempt === this.MAX_RETRIES) {
          this.logger.error(
            `checkPermission FAILED after ${this.MAX_RETRIES + 1} attempts for ${userId}: ${resource}:${action} at ${schoolId} ${Date.now() - start}ms`,
            { error: error.message, status: error.response?.status },
          );
          return { allowed: false, reason: 'Permission check unavailable — access denied (fail-closed)' };
        }
        this.logger.debug(`checkPermission: retry attempt=${attempt + 1} for ${userId} ${resource}:${action}`);
        await this.sleep(this.BACKOFF_BASE * Math.pow(2, attempt));
      }
    }
    return { allowed: false, reason: 'Permission check unavailable' };
  }

  /**
   * Get a user's role at a specific school.
   * Used by DataScopeService to determine row-level access.
   *
   * @returns Role info with optional staffId, or null if no role found
   */
  async getUserRole(
    userId: string,
    schoolId: string,
    context: RequestContext,
    email?: string,
  ): Promise<{ role: string; staffId?: string } | null> {
    // Check cache first (avoids repeated Identity Service + staff email lookups)
    const cacheKey = `${userId}:${schoolId}`;
    const cached = this.roleCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < ROLE_CACHE_TTL_MS) {
      this.logger.debug(`getUserRole: userId=${userId} schoolId=${schoolId} cache=HIT role=${cached.data?.role || 'null'}`);
      return cached.data;
    }

    const start = Date.now();
    this.logger.debug(`getUserRole: userId=${userId} schoolId=${schoolId} cache=MISS`);

    // Step 1: Fetch role from identity service
    let role: string;
    try {
      const response = await this.httpClient.get<{
        role: string;
        userId: string;
        schoolId: string;
        departmentId?: string;
      }>(
        `${this.identityServiceUrl}/users/${userId}/roles/${schoolId}`,
        {},
        context,
      );
      role = response.data.role;
      this.logger.debug(`getUserRole: userId=${userId} schoolId=${schoolId} role=${role} ${Date.now() - start}ms`);
    } catch (error: any) {
      if (error.response?.status === 404) {
        this.logger.debug(`getUserRole: userId=${userId} schoolId=${schoolId} no role (404) ${Date.now() - start}ms`);
        this.roleCache.set(cacheKey, { data: null, cachedAt: Date.now() });
        return null;
      }
      this.logger.error(`getUserRole HTTP failed for ${userId} at ${schoolId}: ${error.message} ${Date.now() - start}ms`);
      throw error;
    }

    // Step 2: For Teachers, resolve staffId via email lookup
    // If this fails, we still have the role — staffId stays undefined
    // DataScopeService will assign empty scope for Teacher without staffId
    let staffId: string | undefined;
    if (role === 'Teacher' && email) {
      try {
        const staff = await this.getStaffByEmail(email, context);
        staffId = staff?.staffId;
      } catch (error: any) {
        this.logger.warn(`Staff lookup failed for Teacher ${userId} (${email}): ${error.message}`);
        // staffId stays undefined → DataScopeService returns empty Teacher scope
      }
      if (!staffId) {
        this.logger.warn(`Teacher ${userId} has no staffId for email ${email}`);
      }
    }

    const result = { role, staffId };
    this.roleCache.set(cacheKey, { data: result, cachedAt: Date.now() });
    return result;
  }

  /**
   * Invalidate cached role for a specific user at a school.
   * Called when a user's role changes (e.g., SchoolRoleChanged event).
   */
  invalidateRoleCache(userId: string, schoolId: string): void {
    const key = `${userId}:${schoolId}`;
    this.roleCache.delete(key);
    this.logger.debug(`Role cache invalidated for ${key}`);
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
  // School Configuration
  // ============================================

  /**
   * Get school configuration (hours, days, period duration)
   */
  async getSchoolConfiguration(
    schoolId: string,
    context: RequestContext,
  ): Promise<{ startTime?: string; endTime?: string; schoolDays?: number[]; periodDuration?: number } | null> {
    try {
      const response = await this.httpClient.get<any>(
        `${this.identityServiceUrl}/schools/${schoolId}/configuration`,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      this.handleError(error, 'getSchoolConfiguration', schoolId);
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

  // ============================================
  // Portal Account Provisioning
  // ============================================

  /**
   * Create a parent portal account in the Identity service.
   * Creates Cognito user + DynamoDB record + 'Parent' SchoolRole.
   *
   * @returns The created parent account, or null if the user already exists (409)
   */
  async createParentAccount(
    dto: {
      email: string;
      firstName: string;
      lastName: string;
      phone?: string;
      schoolId: string;
      studentId: string;
      guardianId?: string;
    },
    context: RequestContext,
  ): Promise<ParentAccountResponse | null> {
    try {
      const response = await this.httpClient.post<ParentAccountResponse>(
        `${this.identityServiceUrl}/users/parent-accounts`,
        dto,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 409) {
        this.logger.log(`Parent account already exists for ${dto.email} — skipping`);
        return null;
      }
      this.logger.error(
        `Failed to create parent account for ${dto.email}: ${error.message}`,
        { status: error.response?.status },
      );
      throw error;
    }
  }

  /**
   * Create a student portal account in the Identity service.
   * Creates Cognito user + DynamoDB record + 'Student' SchoolRole.
   *
   * @returns The created student account, or null if the user already exists (409)
   */
  async createStudentAccount(
    dto: {
      email: string;
      firstName: string;
      lastName: string;
      schoolId: string;
      studentId: string;
    },
    context: RequestContext,
  ): Promise<StudentAccountResponse | null> {
    try {
      const response = await this.httpClient.post<StudentAccountResponse>(
        `${this.identityServiceUrl}/users/student-accounts`,
        dto,
        {},
        context,
      );
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 409) {
        this.logger.log(`Student account already exists for ${dto.email} — skipping`);
        return null;
      }
      this.logger.error(
        `Failed to create student account for ${dto.email}: ${error.message}`,
        { status: error.response?.status },
      );
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

    // Network errors (DNS failure, connection refused, timeout) — no HTTP response
    if (!error.response) {
      throw new ServiceUnavailableException(
        'Identity service is unreachable. Please try again later.'
      );
    }

    throw error;
  }

  /** Returns a promise that rejects after the given timeout */
  private timeoutPromise<T>(ms: number): Promise<T> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Request timed out after ${ms}ms`)), ms),
    );
  }

  /** Sleep for the given duration */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

