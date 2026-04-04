/**
 * Permission Guard for Finance Service
 *
 * Enforces resource-level RBAC/ABAC permissions on finance endpoints.
 * Same pattern as academics service permission guard.
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSION_KEY,
  RequiredPermission,
} from '@app/auth/decorators/require-permission.decorator';
import { IdentityClientService } from '../services/identity-client.service';
import { AuditLoggerService } from '@app/logger';

interface PermissionCacheEntry {
  allowed: boolean;
  cachedAt: number;
}

const PERMISSION_CACHE_TTL_MS = parseInt(process.env.PERMISSION_CACHE_TTL_MS || '300000', 10);
const PERMISSION_CACHE_MAX_SIZE = 10_000;

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);
  private readonly auditLogger = new AuditLoggerService('finance-service');
  private readonly permissionCache = new Map<string, PermissionCacheEntry>();

  constructor(
    private readonly reflector: Reflector,
    private readonly identityClient: IdentityClientService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<RequiredPermission | undefined>(
      PERMISSION_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!permission) return true;

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) throw new ForbiddenException('Authentication required');

    // TenantAdmin bypasses all permission checks
    if (user.globalRole === 'TenantAdmin') return true;

    const schoolIdParam = permission.schoolIdParam || 'schoolId';
    const schoolId =
      request.params?.[schoolIdParam] ||
      request.query?.[schoolIdParam] ||
      request.body?.[schoolIdParam];

    if (!schoolId) {
      this.auditLogger.logPermissionDenied(
        { tenantId: user.tenantId, userId: user.userId },
        permission.resource,
        permission.action,
        undefined,
        `${request.method} ${request.path}`,
      );
      throw new BadRequestException('Missing required parameter: schoolId');
    }

    // Check permission cache
    const cacheKey = `${user.userId}:${schoolId}:${permission.resource}:${permission.action}`;
    const cached = this.permissionCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < PERMISSION_CACHE_TTL_MS) {
      this.permissionCache.delete(cacheKey);
      this.permissionCache.set(cacheKey, cached);
      if (!cached.allowed) {
        throw new ForbiddenException(`Permission denied: ${permission.resource}:${permission.action}`);
      }
      return true;
    }

    const httpContext = {
      tenantId: user.tenantId,
      userId: user.userId,
      email: user.email || '',
      role: user.globalRole,
      jwtToken: request.headers?.authorization?.replace('Bearer ', '') || '',
    };

    const result = await this.identityClient.checkPermission(
      user.userId,
      permission.resource,
      permission.action,
      schoolId,
      httpContext,
    );

    this.cachePermissionDecision(cacheKey, result.allowed);

    if (!result.allowed) {
      this.auditLogger.logPermissionDenied(
        { tenantId: user.tenantId, userId: user.userId, userEmail: user.email },
        permission.resource,
        permission.action,
        schoolId,
        `${request.method} ${request.path}`,
      );
      throw new ForbiddenException(`Permission denied: ${permission.resource}:${permission.action}`);
    }

    return true;
  }

  private cachePermissionDecision(key: string, allowed: boolean): void {
    if (this.permissionCache.size >= PERMISSION_CACHE_MAX_SIZE) {
      const firstKey = this.permissionCache.keys().next().value;
      if (firstKey) this.permissionCache.delete(firstKey);
    }
    this.permissionCache.set(key, { allowed, cachedAt: Date.now() });
  }
}
