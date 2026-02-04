import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesService } from '../../roles/roles.service';
import { DynamoDBClientService } from '../services/dynamodb-client.service';
import {
  PERMISSION_KEY,
  RequiredPermission,
} from '../decorators/require-permission.decorator';

/**
 * Guard that checks resource-level permissions via RolesService.checkPermission().
 * TenantAdmin bypasses all permission checks.
 * Requires @RequirePermission() decorator on the handler.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  private readonly logger = new Logger(PermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly rolesService: RolesService,
    private readonly dynamoDBClient: DynamoDBClientService,
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

    // TenantAdmin bypasses permission checks
    if (user.globalRole === 'TenantAdmin') {
      // For sensitive operations, verify DynamoDB globalRole matches JWT
      // This catches recently-demoted admins whose JWT hasn't expired yet
      if (permission.verifyDynamoRole) {
        const systemClient = this.dynamoDBClient.getSystemClient();
        const dbUser = await this.dynamoDBClient.getItem<{ globalRole: string }>(
          systemClient,
          user.tenantId,
          `USER#${user.userId}`
        );
        if (!dbUser || dbUser.globalRole !== 'TenantAdmin') {
          throw new ForbiddenException('Role has been changed. Please re-authenticate.');
        }
      }
      return true;
    }

    // Extract schoolId from route params, query, or body
    const schoolIdParam = permission.schoolIdParam || 'schoolId';
    const schoolId =
      request.params?.[schoolIdParam] ||
      request.query?.[schoolIdParam] ||
      request.body?.[schoolIdParam];

    if (!schoolId) {
      throw new ForbiddenException('School context required for this operation');
    }

    const result = await this.rolesService.checkPermission(
      {
        resource: permission.resource,
        action: permission.action as any,
        schoolId,
      },
      {
        tenantId: user.tenantId,
        userId: user.userId,
        globalRole: user.globalRole,
        email: user.email,
        jwtToken: request.headers?.authorization?.replace('Bearer ', '') || '',
      },
    );

    if (!result.allowed) {
      this.logger.warn(
        `Permission denied: user ${user.userId} for ${permission.resource}:${permission.action} ` +
        `at school ${schoolId} — ${result.reason}`,
      );
      throw new ForbiddenException(result.reason || 'Permission denied');
    }

    return true;
  }
}
