/**
 * Dashboard Controller
 *
 * Provides financial dashboard endpoints for admin users.
 */

import { Controller, Get, Param, UseGuards, Req } from '@nestjs/common';
import { Request } from 'express';
import { DashboardService, DashboardSummary } from './dashboard.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, RequirePermission } from '@app/auth';
import { PermissionGuard } from '../common/guards/permission.guard';
import { buildRequestContext } from '../common/entities/base.entity';

@Controller('finance/schools/:schoolId/dashboard')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('summary')
  @UseGuards(PermissionGuard)
  @RequirePermission({ resource: 'billing', action: 'view', schoolIdParam: 'schoolId' })
  async getSummary(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: any,
    @Req() req: Request,
  ): Promise<DashboardSummary> {
    const context = buildRequestContext(tenant, req, schoolId);
    return this.dashboardService.getSummary(schoolId, context);
  }
}
