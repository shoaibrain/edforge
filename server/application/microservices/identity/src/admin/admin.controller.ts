/**
 * Admin Controller - Administrative operations
 */

import {
  Controller,
  Post,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RolesService } from '../roles/roles.service';
import { RequestContext } from '../common/entities';
import { RequireGlobalRole } from '../common/decorators/require-global-role.decorator';
import { GlobalRoleGuard } from '../common/guards/global-role.guard';

@Controller('admin')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private readonly rolesService: RolesService) {}

  /**
   * Cleanup expired role assignments
   * POST /admin/cleanup-expired-roles
   * TenantAdmin only
   */
  @Post('cleanup-expired-roles')
  @HttpCode(HttpStatus.OK)
  @RequireGlobalRole('TenantAdmin')
  @UseGuards(GlobalRoleGuard)
  async cleanupExpiredRoles(
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ deactivatedCount: number; scannedCount: number }> {
    const context: RequestContext = {
      userId: tenant.userId,
      tenantId: tenant.tenantId,
      email: tenant.email,
      globalRole: tenant.globalRole,
      jwtToken: req.headers.authorization?.replace('Bearer ', '') || '',
      username: tenant.username,
    };
    return this.rolesService.cleanupExpiredRoles(context);
  }
}
