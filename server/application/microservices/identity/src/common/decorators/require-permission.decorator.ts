import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';

export interface RequiredPermission {
  resource: string;
  action: string;
  /** Route param name containing the schoolId (default: 'schoolId') */
  schoolIdParam?: string;
  /** If true, verify DynamoDB globalRole for TenantAdmin bypass (catches recently-demoted admins). Default: false */
  verifyDynamoRole?: boolean;
}

/**
 * Decorator to require a specific resource permission for an endpoint.
 * Use with PermissionGuard. TenantAdmin bypasses this check.
 *
 * @example
 * @RequirePermission({ resource: 'students', action: 'view', schoolIdParam: 'schoolId' })
 * @UseGuards(JwtAuthGuard, PermissionGuard)
 * async getStudents() { ... }
 */
export const RequirePermission = (permission: RequiredPermission) =>
  SetMetadata(PERMISSION_KEY, permission);
