/**
 * School Users Controller - List users at a school via GSI3
 */

import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  Req,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { UsersService } from '../users/users.service';
import { RolesService } from '../roles/roles.service';
import { RequestContext } from '../common/entities';
import type { UserResponseDto } from '@aibrains/shared-types';

@Controller('schools')
@UseGuards(JwtAuthGuard)
export class SchoolUsersController {
  constructor(
    private readonly usersService: UsersService,
    private readonly rolesService: RolesService,
  ) {}

  /**
   * Get users at a school
   * GET /schools/:schoolId/users?role=Teacher&limit=50&cursor=...
   *
   * Authorization: TenantAdmin OR Principal/VicePrincipal at the school.
   */
  @Get(':schoolId/users')
  async getSchoolUsers(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
    @Query('role') role?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ): Promise<{
    schoolId: string;
    users: UserResponseDto[];
    lastEvaluatedKey?: string;
    hasMore: boolean;
  }> {
    const context = this.buildContext(tenant, req);

    // Authorization: TenantAdmin bypasses
    if (context.globalRole !== 'TenantAdmin') {
      // Check if caller has Principal or VicePrincipal role at this school
      try {
        const callerRole = await this.rolesService.getRole(context.userId, schoolId, context);
        if (callerRole.role !== 'Principal' && callerRole.role !== 'VicePrincipal') {
          throw new ForbiddenException('Requires TenantAdmin, Principal, or VicePrincipal at this school');
        }
      } catch (error) {
        if (error instanceof ForbiddenException) throw error;
        throw new ForbiddenException('Requires TenantAdmin, Principal, or VicePrincipal at this school');
      }
    }

    const parsedLimit = limit ? parseInt(limit, 10) : 50;

    const result = await this.usersService.searchUsers(
      context,
      { schoolId, role },
      parsedLimit,
      cursor
    );

    return {
      schoolId,
      users: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  private buildContext(tenant: TenantContext, req: Request): RequestContext {
    return {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
  }
}
