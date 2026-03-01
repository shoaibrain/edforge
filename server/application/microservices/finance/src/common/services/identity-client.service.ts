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
const BACKOFF_BASE = 200;

interface RoleCacheEntry {
  data: { role: string; staffId?: string } | null;
  cachedAt: number;
}

@Injectable()
export class IdentityClientService {
  private readonly logger = new Logger(IdentityClientService.name);
  private readonly identityServiceUrl: string;
  private readonly roleCache = new Map<string, RoleCacheEntry>();
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

  private timeoutPromise<T>(ms: number): Promise<T> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
