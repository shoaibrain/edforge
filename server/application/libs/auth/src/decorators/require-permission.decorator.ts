/**
 * Shared @RequirePermission decorator for resource-level access control.
 *
 * Used by PermissionGuard in any microservice to enforce RBAC/ABAC permissions.
 * The guard extracts the metadata and checks the user's role at the target school.
 *
 * Multi-role note: A user has ONE role per school (key: USER#{userId}#ROLE#{schoolId}).
 * If a user needs both VP and Teacher capabilities at a school, assign the higher-seniority
 * role (VP) which encompasses the lower role's permissions.
 */

import { SetMetadata } from '@nestjs/common';

export const PERMISSION_KEY = 'requiredPermission';

export interface RequiredPermission {
  /** Resource to check (e.g., 'students', 'grades', 'attendance') */
  resource: string;
  /** Action to check (e.g., 'view', 'create', 'edit', 'delete') */
  action: string;
  /** Route/query/body param name containing the schoolId (default: 'schoolId') */
  schoolIdParam?: string;
  /** If true, verify DynamoDB globalRole for TenantAdmin bypass (catches recently-demoted admins) */
  verifyDynamoRole?: boolean;
}

/**
 * Decorator to require a specific resource permission for an endpoint.
 * Use with PermissionGuard. TenantAdmin bypasses this check.
 *
 * @example
 * @RequirePermission({ resource: 'grades', action: 'view' })
 * @UseGuards(JwtAuthGuard, PermissionGuard)
 * async getGrades() { ... }
 *
 * @example
 * // When schoolId is in a different param name
 * @RequirePermission({ resource: 'enrollment', action: 'edit', schoolIdParam: 'schoolId' })
 */
export const RequirePermission = (permission: RequiredPermission) =>
  SetMetadata(PERMISSION_KEY, permission);
