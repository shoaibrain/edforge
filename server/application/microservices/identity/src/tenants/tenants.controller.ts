/**
 * Tenants Controller for Identity Service
 */

import {
  Controller,
  Get,
  Patch,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { TenantsService } from './tenants.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { UpdateTenantDtoZ, UpdateWorkspaceSettingsDtoZ } from '../common/dto/zod-dtos';
import type { TenantResponseDto, TenantLookupResponseDto, WorkspaceSettingsResponseDto } from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';
import { GlobalRoleGuard } from '../common/guards/global-role.guard';
import { RequireGlobalRole } from '../common/decorators/require-global-role.decorator';

@Controller('tenants')
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  /**
   * Lookup tenant by subdomain (public endpoint)
   * GET /tenants/lookup?subdomain=xxx
   */
  @Get('lookup')
  async lookupBySubdomain(
    @Query('subdomain') subdomain: string
  ): Promise<TenantLookupResponseDto> {
    return this.tenantsService.lookupBySubdomain(subdomain);
  }

  /**
   * Get workspace settings
   * GET /tenants/:tenantId/settings
   */
  @Get(':tenantId/settings')
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async getWorkspaceSettings(
    @Param('tenantId') tenantId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<WorkspaceSettingsResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.tenantsService.getWorkspaceSettings(tenantId, context);
  }

  /**
   * Confirm workspace settings (marks setup as complete)
   * PATCH /tenants/:tenantId/settings/confirm
   */
  @Patch(':tenantId/settings/confirm')
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async confirmWorkspaceSettings(
    @Param('tenantId') tenantId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ confirmed: true; workspaceConfirmedAt: string }> {
    const context = this.buildContext(tenant, req);
    return this.tenantsService.confirmWorkspaceSettings(tenantId, context);
  }

  /**
   * Complete onboarding flow — sets onboardingCompletedAt timestamp.
   * POST /tenants/:tenantId/onboarding/complete
   */
  @Post(':tenantId/onboarding/complete')
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async completeOnboarding(
    @Param('tenantId') tenantId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<{ completed: true; onboardingCompletedAt: string }> {
    const context = this.buildContext(tenant, req);
    return this.tenantsService.completeOnboarding(tenantId, context);
  }

  /**
   * Update workspace settings
   * PATCH /tenants/:tenantId/settings
   */
  @Patch(':tenantId/settings')
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async updateWorkspaceSettings(
    @Param('tenantId') tenantId: string,
    @Body() updateDto: UpdateWorkspaceSettingsDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<WorkspaceSettingsResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.tenantsService.updateWorkspaceSettings(tenantId, updateDto, context);
  }

  /**
   * Get tenant by ID
   * GET /tenants/:tenantId
   */
  @Get(':tenantId')
  @UseGuards(JwtAuthGuard)
  async getTenant(
    @Param('tenantId') tenantId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<TenantResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.tenantsService.getTenant(tenantId, context);
  }

  /**
   * Update tenant
   * PATCH /tenants/:tenantId
   */
  @Patch(':tenantId')
  @UseGuards(JwtAuthGuard)
  async updateTenant(
    @Param('tenantId') tenantId: string,
    @Body() updateDto: UpdateTenantDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<TenantResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.tenantsService.updateTenant(tenantId, updateDto, context);
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
