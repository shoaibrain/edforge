import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  UnauthorizedException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  IemisPermission,
  PLATFORM_OPERATOR_IEMIS_PERMISSIONS,
  TENANT_ADMIN_IEMIS_PERMISSIONS,
} from '@aibrains/shared-types';
import { IEMIS_PERMISSIONS_KEY } from '../decorators/require-iemis-permission.decorator';

/**
 * Guard that enforces `@RequireIemisPermission(...)` metadata.
 *
 * In V1 the mapping is:
 *   - `GlobalRole=TenantAdmin` → granted every `TENANT_ADMIN_IEMIS_PERMISSIONS`
 *   - Platform-operator users (`globalRole='PlatformOperator'` — separate
 *     pool, see Sprint 13) → granted `PLATFORM_OPERATOR_IEMIS_PERMISSIONS`
 *   - Everyone else → 403
 *
 * Every denial logs at WARN with the actor, required permissions, and
 * actor's role. The `IemisAuditLogger` (S1.9) emits a `code.verify.denied`
 * event where applicable, so audit-log consumers can review denied
 * attempts.
 *
 * MUST run AFTER `JwtAuthGuard` in the controller's guard chain so
 * `request.user` is populated.
 */
@Injectable()
export class IemisPermissionGuard implements CanActivate {
  private readonly logger = new Logger(IemisPermissionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<IemisPermission[] | undefined>(
        IEMIS_PERMISSIONS_KEY,
        [context.getHandler(), context.getClass()],
      );

    // No decorator present = no restriction (guard is a no-op).
    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.globalRole) {
      throw new UnauthorizedException('Authentication required for IEMIS endpoint');
    }

    // Resolve the permissions this user holds, by role.
    const held = this.permissionsForRole(user.globalRole);

    // Every required permission must be granted.
    const missing = required.filter((p) => !held.includes(p));
    if (missing.length > 0) {
      this.logger.warn(
        `IEMIS access denied: userId=${user.userId} role=${user.globalRole} missing=[${missing.join(',')}]`,
      );
      throw new ForbiddenException(
        `Missing IEMIS permission(s): ${missing.join(', ')}`,
      );
    }

    return true;
  }

  private permissionsForRole(role: string): readonly IemisPermission[] {
    if (role === 'TenantAdmin') return TENANT_ADMIN_IEMIS_PERMISSIONS;
    if (role === 'PlatformOperator') return PLATFORM_OPERATOR_IEMIS_PERMISSIONS;
    return [];
  }
}
