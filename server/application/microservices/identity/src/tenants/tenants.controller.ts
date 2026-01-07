/**
 * Tenants Controller for Identity Service
 */

import {
  Controller,
  Get,
  Patch,
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
import { UpdateTenantDto, TenantResponseDto, TenantLookupResponseDto } from '../common/dto/tenant.dto';
import { RequestContext } from '../common/entities';

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
    @Body() updateDto: UpdateTenantDto,
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

