import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { GlobalRole } from '@app/auth';
import { GLOBAL_ROLES_KEY } from '../decorators/require-global-role.decorator';

/**
 * Guard that checks the user's globalRole against roles specified
 * by @RequireGlobalRole(). If no metadata is set, the guard passes.
 */
@Injectable()
export class GlobalRoleGuard implements CanActivate {
  private readonly logger = new Logger(GlobalRoleGuard.name);

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<GlobalRole[] | undefined>(
      GLOBAL_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No decorator = no restriction
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.globalRole) {
      throw new ForbiddenException('Authentication required');
    }

    if (!requiredRoles.includes(user.globalRole)) {
      this.logger.warn(
        `Access denied: user ${user.userId} has role ${user.globalRole}, ` +
        `required: ${requiredRoles.join(', ')}`,
      );
      throw new ForbiddenException(
        `Requires one of: ${requiredRoles.join(', ')}`,
      );
    }

    return true;
  }
}
