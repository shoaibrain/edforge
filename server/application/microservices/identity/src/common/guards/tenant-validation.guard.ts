/**
 * Tenant Validation Guard
 * 
 * Defense-in-depth: Ensures tenant context is present and valid
 * before any protected operation executes.
 * 
 * ARCHITECTURE NOTE: Application-level tenant isolation
 * - All DynamoDB queries use tenantId from JWT context as partition key
 * - GSI queries include tenant filtering in the key or sort key
 * - This guard adds an additional validation layer
 */

import { 
  Injectable, 
  CanActivate, 
  ExecutionContext, 
  ForbiddenException,
  Logger,
} from '@nestjs/common';

@Injectable()
export class TenantValidationGuard implements CanActivate {
  private readonly logger = new Logger(TenantValidationGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    // Validate tenant context exists
    if (!user?.tenantId) {
      this.logger.warn('Access attempt without tenant context', {
        path: request.path,
        method: request.method,
        ip: request.ip,
      });
      throw new ForbiddenException('Tenant context required');
    }

    // Log successful tenant validation (audit trail)
    this.logger.debug('Tenant validated', {
      tenantId: user.tenantId,
      userId: user.userId,
      path: request.path,
      method: request.method,
    });

    return true;
  }
}

/**
 * Tenant context assertion utility
 * Use in services for additional validation when processing retrieved data
 */
export function assertTenantContext(
  contextTenantId: string,
  resourceTenantId: string,
  resourceType: string,
  resourceId: string
): void {
  if (contextTenantId !== resourceTenantId) {
    const logger = new Logger('TenantAssertion');
    logger.error('Cross-tenant access attempt detected', {
      contextTenantId,
      resourceTenantId,
      resourceType,
      resourceId,
    });
    throw new ForbiddenException('Access denied: Resource belongs to different tenant');
  }
}

