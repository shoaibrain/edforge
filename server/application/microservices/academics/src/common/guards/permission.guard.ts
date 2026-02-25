/**
 * Permission Guard for Academics Service
 *
 * Enforces resource-level RBAC/ABAC permissions on academics endpoints.
 * Uses the identity service's permission check endpoint via HTTP (ECS Service Connect).
 *
 * Flow:
 * 1. Read @RequirePermission metadata from the handler
 * 2. Extract schoolId from route params / query / body
 * 3. TenantAdmin → bypass (no HTTP call)
 * 4. All others → call identity service checkPermission endpoint
 * 5. Denied → 403 with structured error
 *
 * Multi-role note: A user has ONE role per school. The identity service's
 * checkPermission resolves the user's role at the target school and evaluates
 * permissions including any per-user overrides (deny-wins logic).
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  PERMISSION_KEY,
  RequiredPermission,
} from '@app/auth/decorators/require-permission.decorator';
import { IdentityClientService } from '../services/identity-client.service';
import { AuditLoggerService } from '@app/logger';

/** Permission decision cache entry */
interface PermissionCacheEntry {
  allowed: boolean;
  cachedAt: number;
}

const PERMISSION_CACHE_TTL_MS = parseInt(process.env.PERMISSION_CACHE_TTL_MS || '300000', 10); // 5 min default
const PERMISSION_CACHE_MAX_SIZE = 10_000;

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);
  private readonly auditLogger = new AuditLoggerService('academics-service');

  /** In-memory LRU permission decision cache */
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

    // No decorator = no restriction
    if (!permission) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    // TenantAdmin bypasses all permission checks
    if (user.globalRole === 'TenantAdmin') {
      return true;
    }

    // Extract schoolId from route params, query, or body (priority order)
    const schoolIdParam = permission.schoolIdParam || 'schoolId';
    const schoolId =
      request.params?.[schoolIdParam] ||
      request.query?.[schoolIdParam] ||
      request.body?.[schoolIdParam];

    if (!schoolId) {
      this.logger.warn(
        `Permission check failed: no schoolId found for ${permission.resource}:${permission.action} ` +
        `(looked in params.${schoolIdParam}, query.${schoolIdParam}, body.${schoolIdParam})`,
        { userId: user.userId, path: request.path, method: request.method },
      );

      this.auditLogger.logPermissionDenied(
        { tenantId: user.tenantId, userId: user.userId },
        permission.resource,
        permission.action,
        undefined,
        `${request.method} ${request.path}`,
      );

      throw new ForbiddenException('School context required for this operation');
    }

    // Check permission cache first
    const cacheKey = `${user.userId}:${schoolId}:${permission.resource}:${permission.action}`;
    const cached = this.permissionCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < PERMISSION_CACHE_TTL_MS) {
      // Move to end for LRU behavior (Map preserves insertion order)
      this.permissionCache.delete(cacheKey);
      this.permissionCache.set(cacheKey, cached);
      if (!cached.allowed) {
        throw new ForbiddenException(
          `Permission denied: ${permission.resource}:${permission.action}`,
        );
      }
      return true;
    }

    // Build HTTP request context for identity service call
    const httpContext = {
      tenantId: user.tenantId,
      userId: user.userId,
      jwtToken: request.headers?.authorization?.replace('Bearer ', '') || '',
      userRole: user.globalRole,
    };

    const result = await this.identityClient.checkPermission(
      user.userId,
      permission.resource,
      permission.action,
      schoolId,
      httpContext,
    );

    // Cache the decision
    this.cachePermissionDecision(cacheKey, result.allowed);

    if (!result.allowed) {
      this.logger.warn(
        `Permission denied: ${user.userId} for ${permission.resource}:${permission.action} ` +
        `at school ${schoolId} — ${result.reason}`,
      );

      // Structured audit log for compliance and alerting
      this.auditLogger.logPermissionDenied(
        { tenantId: user.tenantId, userId: user.userId, userEmail: user.email },
        permission.resource,
        permission.action,
        schoolId,
        `${request.method} ${request.path}`,
      );

      throw new ForbiddenException(
        `Permission denied: ${permission.resource}:${permission.action}`,
      );
    }

    return true;
  }

  /** Cache a permission decision with LRU eviction */
  private cachePermissionDecision(key: string, allowed: boolean): void {
    // Evict oldest entries if at capacity
    if (this.permissionCache.size >= PERMISSION_CACHE_MAX_SIZE) {
      const firstKey = this.permissionCache.keys().next().value;
      if (firstKey) this.permissionCache.delete(firstKey);
    }
    this.permissionCache.set(key, { allowed, cachedAt: Date.now() });
  }
}
