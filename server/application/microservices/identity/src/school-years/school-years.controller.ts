/**
 * School Years Controller - Tenant-level school year endpoints
 * 
 * Provides endpoints for the frontend Shell context to load school year data.
 * This is an aggregation layer over the school-specific academic years.
 */

import {
  Controller,
  Get,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { Request } from 'express';
import { SchoolYearsService } from './school-years.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequestContext } from '../common/entities';
import type {
  SchoolYearListResponseDto,
  SchoolYearResponseDto,
  CurrentSchoolYearResponseDto,
  CurrentSchoolYearsResponseDto,
} from '@edforge/shared-types';

@Controller('school-years')
@UseGuards(JwtAuthGuard)
export class SchoolYearsController {
  constructor(private readonly schoolYearsService: SchoolYearsService) {}

  /**
   * List all school years for tenant
   * GET /school-years?tenantId=
   * 
   * Returns all academic years across all schools for the tenant.
   * Used by frontend Shell context for initial data loading.
   */
  @Get()
  async listSchoolYears(
    @Query('tenantId') tenantId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SchoolYearListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.schoolYearsService.listSchoolYears(context, tenantId || tenant.tenantId);
  }

  /**
   * Get current school year
   * GET /school-years/current?tenantId=&defaultSchoolId=
   * 
   * Returns the current academic year for the tenant.
   * If defaultSchoolId is provided, returns that school's current year.
   */
  @Get('current')
  async getCurrentSchoolYear(
    @Query('tenantId') tenantId: string,
    @Query('defaultSchoolId') defaultSchoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CurrentSchoolYearResponseDto> {
    const context = this.buildContext(tenant, req);
    const currentYear = await this.schoolYearsService.getCurrentSchoolYear(
      context,
      tenantId || tenant.tenantId,
      defaultSchoolId
    );
    return { data: currentYear };
  }

  /**
   * Get all current school years across schools
   * GET /school-years/current-all?tenantId=
   * 
   * Returns current academic years for all schools in the tenant.
   */
  @Get('current-all')
  async getAllCurrentSchoolYears(
    @Query('tenantId') tenantId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<CurrentSchoolYearsResponseDto> {
    const context = this.buildContext(tenant, req);
    const currentYears = await this.schoolYearsService.getAllCurrentSchoolYears(
      context,
      tenantId || tenant.tenantId
    );
    return { data: currentYears };
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
