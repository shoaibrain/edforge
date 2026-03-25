/**
 * Identity Client Service for Finance Service
 *
 * Communicates with the Identity service for:
 * - School validation
 * - Permission checks
 * - User role resolution
 * - Student data lookups
 */

import { Injectable, Logger, ForbiddenException } from '@nestjs/common';
import { HttpClientService } from '@app/http-client';
import { RequestContext } from '../entities/base.entity';

const ROLE_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const LINKED_STUDENTS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const BACKOFF_BASE = 200;

interface RoleCacheEntry {
  data: { role: string; staffId?: string } | null;
  cachedAt: number;
}

interface LinkedStudentsCacheEntry {
  studentIds: string[];
  cachedAt: number;
}

@Injectable()
export class IdentityClientService {
  private readonly logger = new Logger(IdentityClientService.name);
  private readonly identityServiceUrl: string;
  private readonly roleCache = new Map<string, RoleCacheEntry>();
  private readonly linkedStudentsCache = new Map<string, LinkedStudentsCacheEntry>();
  private readonly REQUEST_TIMEOUT = 5000;
  private readonly MAX_RETRIES = 2;

  constructor(private readonly httpClient: HttpClientService) {
    this.identityServiceUrl = process.env.IDENTITY_SERVICE_URL || 'http://identity-api.default.sc:3010';
  }

  async validateSchoolExists(schoolId: string, context: RequestContext): Promise<boolean> {
    try {
      await this.httpClient.get(
        `${this.identityServiceUrl}/schools/${schoolId}`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return true;
    } catch (error: any) {
      if (error.response?.status === 404) return false;
      this.logger.warn(`School validation failed for ${schoolId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Get the display name for a school. Returns null if not found.
   * Uses the same endpoint as validateSchoolExists but extracts the name.
   */
  async getSchoolName(schoolId: string, context: RequestContext): Promise<string | null> {
    try {
      const response = await this.httpClient.get<{ name?: string; schoolName?: string }>(
        `${this.identityServiceUrl}/schools/${schoolId}`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return response.data?.name || response.data?.schoolName || null;
    } catch {
      return null;
    }
  }

  async checkPermission(
    userId: string,
    resource: string,
    action: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<{ allowed: boolean; reason?: string }> {
    for (let attempt = 0; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        const response = await Promise.race([
          this.httpClient.post<{ allowed: boolean; reason?: string }>(
            `${this.identityServiceUrl}/users/${userId}/roles/permissions/check`,
            { resource, action, schoolId },
            {},
            { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
          ),
          this.timeoutPromise<never>(this.REQUEST_TIMEOUT),
        ]);
        return response.data;
      } catch (error: any) {
        if (attempt === this.MAX_RETRIES) {
          return { allowed: false, reason: 'Permission check unavailable' };
        }
        await this.sleep(BACKOFF_BASE * Math.pow(2, attempt));
      }
    }
    return { allowed: false };
  }

  async getUserRole(
    userId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<{ role: string; staffId?: string } | null> {
    const cacheKey = `${userId}:${schoolId}`;
    const cached = this.roleCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < ROLE_CACHE_TTL_MS) {
      return cached.data;
    }

    try {
      const response = await this.httpClient.get<{ role: string; userId: string; schoolId: string }>(
        `${this.identityServiceUrl}/users/${userId}/roles/${schoolId}`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      const result = { role: response.data.role };
      this.roleCache.set(cacheKey, { data: result, cachedAt: Date.now() });
      return result;
    } catch (error: any) {
      if (error.response?.status === 404) {
        this.roleCache.set(cacheKey, { data: null, cachedAt: Date.now() });
        return null;
      }
      throw error;
    }
  }

  async getStudentInfo(
    studentId: string,
    context: RequestContext,
  ): Promise<{ studentId: string; firstName: string; lastName: string; gradeLevel: string } | null> {
    try {
      const response = await this.httpClient.get<any>(
        `${process.env.ACADEMICS_SERVICE_URL || 'http://academics-api.default.sc:3010'}/academics/students/${studentId}`,
        { params: { schoolId: context.schoolId } },
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      const d = response.data;
      return {
        studentId: d.studentId,
        firstName: d.firstName,
        lastName: d.lastName,
        gradeLevel: d.currentGradeLevel || d.gradeLevel || '',
      };
    } catch {
      return null;
    }
  }

  /**
   * Get the student IDs linked to a parent/student user at a school.
   * Uses the academics service DataScopeService (via GET /academics/students)
   * which auto-scopes results to the parent's guardianship records.
   * Cache key includes tenantId to prevent cross-tenant leakage.
   */
  async getLinkedStudentIds(
    userId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<string[]> {
    const cacheKey = `${context.tenantId}:${userId}:${schoolId}`;
    const cached = this.linkedStudentsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < LINKED_STUDENTS_CACHE_TTL_MS) {
      return cached.studentIds;
    }

    try {
      const academicsUrl = process.env.ACADEMICS_SERVICE_URL || 'http://academics-api.default.sc:3010';
      const response = await this.httpClient.get<{ items: Array<{ studentId: string }> }>(
        `${academicsUrl}/academics/students`,
        { params: { schoolId, limit: 500 } },
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );

      const studentIds = (response.data?.items ?? []).map(s => s.studentId);
      this.linkedStudentsCache.set(cacheKey, { studentIds, cachedAt: Date.now() });
      return studentIds;
    } catch (error: any) {
      this.logger.warn(`Failed to resolve linked students for user ${userId} at school ${schoolId}: ${error.message}`);
      // Fail-closed: return empty array so caller denies access
      return [];
    }
  }

  /**
   * Enforce that the caller owns the student referenced in the entity.
   * Admin/Principal/Accountant bypass; Parent/Student must have linked student.
   * Throws ForbiddenException if access is denied.
   */
  async enforceStudentOwnership(
    entityStudentId: string,
    schoolId: string,
    context: RequestContext,
  ): Promise<void> {
    // TenantAdmin bypasses all checks
    if (context.role === 'TenantAdmin') return;

    const roleResult = await this.getUserRole(context.userId, schoolId, context);
    const role = roleResult?.role;

    // Admin-level school roles bypass entity-level ownership
    if (role === 'Principal' || role === 'VicePrincipal' || role === 'Accountant') return;

    // Parent/Student must own the student
    if (role === 'Parent' || role === 'Student') {
      const linkedStudentIds = await this.getLinkedStudentIds(context.userId, schoolId, context);
      if (!linkedStudentIds.includes(entityStudentId)) {
        throw new ForbiddenException('Access denied to this resource');
      }
      return;
    }

    // Staff and other roles with billing:view can see all (list-level access is enough)
    // No entity-level restriction for non-parent/student roles that passed PermissionGuard
  }

  /**
   * Get workspace settings for a tenant. Returns the regional settings
   * including default currency, calendar system, locale, etc.
   */
  async getWorkspaceSettings(
    context: RequestContext,
  ): Promise<{ regional?: { defaultCurrency?: string; defaultCalendarSystem?: string } } | null> {
    try {
      const response = await this.httpClient.get<any>(
        `${this.identityServiceUrl}/tenants/${context.tenantId}/workspace-settings`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return response.data;
    } catch {
      return null;
    }
  }

  /**
   * Get school details including gradeRange for grade level validation.
   */
  async getSchoolDetails(
    schoolId: string,
    context: RequestContext,
  ): Promise<{ gradeRange?: { start: string; end: string } } | null> {
    try {
      const response = await this.httpClient.get<any>(
        `${this.identityServiceUrl}/schools/${schoolId}`,
        {},
        { tenantId: context.tenantId, userId: context.userId, jwtToken: context.jwtToken, userRole: context.role },
      );
      return response.data;
    } catch {
      return null;
    }
  }

  private timeoutPromise<T>(ms: number): Promise<T> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
