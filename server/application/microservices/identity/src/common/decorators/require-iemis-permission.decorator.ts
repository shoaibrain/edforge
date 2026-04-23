import { SetMetadata } from '@nestjs/common';
import type { IemisPermission } from '@aibrains/shared-types';

export const IEMIS_PERMISSIONS_KEY = 'iemisPermissions';

/**
 * Require one or more IEMIS permissions for an endpoint.
 *
 * In V1, IEMIS permissions are gated by `GlobalRole=TenantAdmin` (MFA
 * enforcement deferred — see Sprint 13 decision). The platform-operator-
 * only `iemis:manage-templates` is checked separately via a dedicated
 * path that can also assert the actor is in the platform-operator pool.
 *
 * @example
 * \@RequireIemisPermission(IemisPermission.VerifyCode)
 * \@UseGuards(JwtAuthGuard, IemisPermissionGuard)
 * async verifySchoolCode() { ... }
 */
export const RequireIemisPermission = (...permissions: IemisPermission[]) =>
  SetMetadata(IEMIS_PERMISSIONS_KEY, permissions);
