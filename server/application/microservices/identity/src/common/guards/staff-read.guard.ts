import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { DynamoDBClientService } from '../services/dynamodb-client.service';
import { RoleAssignment } from '../entities/role-assignment.entity';
import { SchoolRole } from '../entities/base.entity';

/**
 * Staff-read authorization.
 *
 * Staff HR records — the staff directory, credentials, leave, trainings,
 * employment history, and assignments — must not be readable by portal
 * accounts. Without this guard any authenticated tenant user (including a
 * Parent or Student) can read a teacher's leave or employment history.
 *
 * Allow: TenantAdmin, or any caller holding at least one staff-type school role
 * (Principal/VicePrincipal/Teacher/Accountant/Staff/Counselor/Nurse) at any
 * school. Deny: callers whose only active roles are Parent and/or Student.
 *
 * Self-enforcing — applied via `@UseGuards(JwtAuthGuard, StaffReadGuard)` with
 * no companion decorator (it is a uniform read gate, not a per-resource
 * permission). The authz-coverage audit lists it in SELF_ENFORCING_AUTHZ_GUARDS.
 */
const STAFF_ROLES: ReadonlySet<SchoolRole> = new Set<SchoolRole>([
  'Principal',
  'VicePrincipal',
  'Teacher',
  'Accountant',
  'Staff',
  'Counselor',
  'Nurse',
]);

@Injectable()
export class StaffReadGuard implements CanActivate {
  private readonly logger = new Logger(StaffReadGuard.name);

  constructor(private readonly dynamoDBClient: DynamoDBClientService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user?.userId) {
      throw new ForbiddenException('Authentication required');
    }

    if (user.globalRole === 'TenantAdmin') {
      return true;
    }

    const jwtToken = (request.headers?.authorization || '').replace(/^Bearer\s+/i, '');
    const client = await this.dynamoDBClient.getClient(user.tenantId, jwtToken);

    const result = await this.dynamoDBClient.query<RoleAssignment>(
      client,
      user.tenantId,
      `USER#${user.userId}#ROLE#`,
      'isActive = :isActive',
      { ':isActive': true },
    );

    const now = new Date();
    const hasStaffRole = result.items.some((r) => {
      if (r.expiresAt && new Date(r.expiresAt) <= now) {
        return false;
      }
      const roles = r.roles && r.roles.length > 0 ? r.roles : [r.role];
      return roles.some((role) => STAFF_ROLES.has(role));
    });

    if (!hasStaffRole) {
      this.logger.warn(
        `Staff-read denied: user ${user.userId} holds no staff-type role`,
      );
      throw new ForbiddenException('Requires a staff role to read staff records');
    }

    return true;
  }
}
