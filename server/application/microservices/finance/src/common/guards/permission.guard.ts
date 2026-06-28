/**
 * Permission Guard for Finance Service
 *
 * Enforces resource-level RBAC/ABAC permissions on finance endpoints.
 * Same pattern as academics service permission guard.
 *
 * ## SH.1 — School-existence hardening (2026-06-28)
 *
 * Validated finding (workflow `wf_4b82df7e-2c1`, 2026-06-28 prod):
 * `identityClient.checkPermission` confirms the operator has the
 * resource:action on **some** school in their tenant — it does NOT
 * confirm that the URL's `schoolId` is a real school in this tenant.
 * Without a follow-up existence check, all 10 school-scoped finance
 * routes silently accept any UUID-shaped `schoolId` and return zero-row
 * (or partially-populated) 200 payloads instead of 404 — a within-tenant
 * information-disclosure vector (plan §5c, SH.1).
 *
 * Mitigation: after `checkPermission` succeeds and before returning
 * `true`, probe the URL's `schoolId` via `identityClient.schoolExists` and
 * throw `NotFoundException` when identity reports the school is missing.
 *
 * TenantAdmin runs the existence check too — the contract being defended
 * here is "the URL must reference a real school," which is independent of
 * the operator's role.
 *
 * Per-request memoization is via a Map keyed on `tenantId:schoolId` with
 * a short TTL so a single request that bounces through multiple guarded
 * controller methods doesn't repeatedly call identity for the same school.
 *
 * ## SH.1 review fix-up (PR #338 reviewer P1)
 *
 * The first SH.1 cut used `getSchoolName`, which swallows ALL identity
 * errors as `null`. That made a network/5xx blip indistinguishable from a
 * confirmed 404, and the guard's cache (`exists: !!name`) would poison
 * the cache for the next 60s — every subsequent request for the school
 * would 404 even after identity recovered.
 *
 * Fix: use `identityClient.schoolExists` which returns a definitive
 * boolean ONLY on identity-confirmed answers (200 or 404) and **throws**
 * on transport-class failures (network, 5xx, timeout). The guard then:
 *   - caches the boolean when `schoolExists` returns (cacheable answer)
 *   - throws 404 for the current request but DOES NOT cache when
 *     `schoolExists` throws (so the next request re-hits identity)
 */

import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  BadRequestException,
  NotFoundException,
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

interface SchoolExistsCacheEntry {
  exists: boolean;
  cachedAt: number;
}

const PERMISSION_CACHE_TTL_MS = parseInt(process.env.PERMISSION_CACHE_TTL_MS || '300000', 10);
const PERMISSION_CACHE_MAX_SIZE = 10_000;
/**
 * SH.1 — short TTL on school-existence cache. 60s balances "don't hammer
 * identity for the same school across N back-to-back requests" against
 * "catch a school deletion within a minute." Bounded with an LRU eviction
 * to cap memory regardless of tenant cardinality.
 */
const SCHOOL_EXISTS_CACHE_TTL_MS = parseInt(process.env.SCHOOL_EXISTS_CACHE_TTL_MS || '60000', 10);
const SCHOOL_EXISTS_CACHE_MAX_SIZE = 10_000;
/**
 * SH.1 — UUID-shape gate. The school-existence check is only meaningful
 * when the URL param could plausibly be a real schoolId. Non-UUID inputs
 * fall through unchanged; downstream validators (DTO Zod) already reject
 * them with the usual 400.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);
  private readonly auditLogger = new AuditLoggerService('finance-service');
  private readonly permissionCache = new Map<string, PermissionCacheEntry>();
  private readonly schoolExistsCache = new Map<string, SchoolExistsCacheEntry>();

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

    const schoolIdParam = permission.schoolIdParam || 'schoolId';
    const schoolId =
      request.params?.[schoolIdParam] ||
      request.query?.[schoolIdParam] ||
      request.body?.[schoolIdParam];

    // TenantAdmin bypasses the RBAC/ABAC check but NOT the school-existence
    // check below. The existence check is a separate contract: "the URL must
    // reference a real school in this tenant." That's true regardless of
    // role; the SH.1 finding showed TenantAdmin tokens were the exact vector
    // for the cross-school information-disclosure probe.
    const isTenantAdmin = user.globalRole === 'TenantAdmin';

    if (!schoolId) {
      if (isTenantAdmin) return true;
      this.auditLogger.logPermissionDenied(
        { tenantId: user.tenantId, userId: user.userId },
        permission.resource,
        permission.action,
        undefined,
        `${request.method} ${request.path}`,
      );
      throw new BadRequestException('Missing required parameter: schoolId');
    }

    const httpContext = {
      tenantId: user.tenantId,
      userId: user.userId,
      email: user.email || '',
      role: user.globalRole,
      jwtToken: request.headers?.authorization?.replace('Bearer ', '') || '',
    };

    if (!isTenantAdmin) {
      // Check permission cache
      const cacheKey = `${user.userId}:${schoolId}:${permission.resource}:${permission.action}`;
      const cached = this.permissionCache.get(cacheKey);
      if (cached && Date.now() - cached.cachedAt < PERMISSION_CACHE_TTL_MS) {
        this.permissionCache.delete(cacheKey);
        this.permissionCache.set(cacheKey, cached);
        if (!cached.allowed) {
          throw new ForbiddenException(`Permission denied: ${permission.resource}:${permission.action}`);
        }
        await this.assertSchoolExists(schoolId, httpContext);
        return true;
      }

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
    }

    await this.assertSchoolExists(schoolId, httpContext);
    return true;
  }

  /**
   * SH.1 — Validate that `schoolId` resolves to a real school in the tenant.
   *
   * - Skip entirely when `schoolId` is not UUID-shaped — non-UUID inputs are
   *   downstream-validator concerns (Zod DTOs return 400) and shouldn't
   *   round-trip to identity.
   * - 60s in-process memoization to absorb back-to-back requests for the
   *   same school. Cache key includes `tenantId` to keep tenants isolated.
   * - Uses `identityClient.schoolExists` (NOT `getSchoolName`), which
   *   discriminates between identity-confirmed answers (200/404) and
   *   transport failures (5xx/network/timeout). Confirmed answers are
   *   cacheable; transport failures fail-closed for THIS request but
   *   intentionally bypass the cache so the next request can recover
   *   when identity does. See JSDoc header for the PR #338 P1 reviewer
   *   finding this fix-up addresses.
   */
  private async assertSchoolExists(
    schoolId: string,
    httpContext: { tenantId: string; userId: string; email: string; role: string; jwtToken: string },
  ): Promise<void> {
    if (!UUID_PATTERN.test(schoolId)) return;

    const cacheKey = `${httpContext.tenantId}:${schoolId}`;
    const cached = this.schoolExistsCache.get(cacheKey);
    if (cached && Date.now() - cached.cachedAt < SCHOOL_EXISTS_CACHE_TTL_MS) {
      this.schoolExistsCache.delete(cacheKey);
      this.schoolExistsCache.set(cacheKey, cached);
      if (!cached.exists) {
        throw new NotFoundException(`School ${schoolId} not found`);
      }
      return;
    }

    let exists: boolean;
    try {
      exists = await this.identityClient.schoolExists(schoolId, httpContext);
    } catch (err) {
      // Transport-class failure (5xx, network, timeout). Fail closed for
      // THIS request, but do NOT cache — a 60s "missing" cache entry
      // would turn a transient identity blip into a minute-long spurious
      // 404 for every subsequent request against this school. The next
      // request re-hits identity and recovers immediately once identity
      // is back.
      this.logger.warn(
        `SH.1 school-exists check: identity transport error for schoolId=${schoolId} tenantId=${httpContext.tenantId}: ${
          err instanceof Error ? err.message : String(err)
        } — failing this request closed (404), NOT caching`,
      );
      throw new NotFoundException(`School ${schoolId} not found`);
    }

    // Identity gave a definitive answer (200 or 404) — safe to cache.
    this.cacheSchoolExistsDecision(cacheKey, exists);

    if (!exists) {
      throw new NotFoundException(`School ${schoolId} not found`);
    }
  }

  private cachePermissionDecision(key: string, allowed: boolean): void {
    if (this.permissionCache.size >= PERMISSION_CACHE_MAX_SIZE) {
      const firstKey = this.permissionCache.keys().next().value;
      if (firstKey) this.permissionCache.delete(firstKey);
    }
    this.permissionCache.set(key, { allowed, cachedAt: Date.now() });
  }

  private cacheSchoolExistsDecision(key: string, exists: boolean): void {
    if (this.schoolExistsCache.size >= SCHOOL_EXISTS_CACHE_MAX_SIZE) {
      const firstKey = this.schoolExistsCache.keys().next().value;
      if (firstKey) this.schoolExistsCache.delete(firstKey);
    }
    this.schoolExistsCache.set(key, { exists, cachedAt: Date.now() });
  }
}
