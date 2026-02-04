import { SetMetadata } from '@nestjs/common';
import type { GlobalRole } from '@app/auth';

export const GLOBAL_ROLES_KEY = 'globalRoles';

/**
 * Decorator to require specific global roles for an endpoint.
 * Use with GlobalRoleGuard.
 *
 * @example
 * @RequireGlobalRole('TenantAdmin')
 * @UseGuards(JwtAuthGuard, GlobalRoleGuard)
 * async createUser() { ... }
 */
export const RequireGlobalRole = (...roles: GlobalRole[]) =>
  SetMetadata(GLOBAL_ROLES_KEY, roles);
