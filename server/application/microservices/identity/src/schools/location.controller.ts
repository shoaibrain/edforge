/**
 * Location Controller - REST endpoints
 *
 * Routes: /schools/:schoolId/locations
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { LocationService } from './location.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  CreateLocationDtoZ,
  UpdateLocationDtoZ,
} from '../common/dto/zod-dtos';
import type {
  LocationResponseDto,
  LocationListResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('schools/:schoolId/locations')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class LocationController {
  constructor(private readonly locationService: LocationService) {}

  /**
   * Create location
   * POST /schools/:schoolId/locations
   */
  @Post()
  @RequirePermission({ resource: 'scheduling', action: 'create', schoolIdParam: 'schoolId' })
  async createLocation(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateLocationDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LocationResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.locationService.createLocation(schoolId, createDto, context);
  }

  /**
   * List locations for school
   * GET /schools/:schoolId/locations
   */
  @Get()
  @RequirePermission({ resource: 'scheduling', action: 'view', schoolIdParam: 'schoolId' })
  async listLocations(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LocationListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.locationService.listLocations(schoolId, context);
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get location by ID
   * GET /schools/:schoolId/locations/:locationId
   */
  @Get(':locationId')
  @RequirePermission({ resource: 'scheduling', action: 'view', schoolIdParam: 'schoolId' })
  async getLocation(
    @Param('schoolId') schoolId: string,
    @Param('locationId') locationId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LocationResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.locationService.getLocation(schoolId, locationId, context);
  }

  /**
   * Update location
   * PATCH /schools/:schoolId/locations/:locationId
   */
  @Patch(':locationId')
  @RequirePermission({ resource: 'scheduling', action: 'edit', schoolIdParam: 'schoolId' })
  async updateLocation(
    @Param('schoolId') schoolId: string,
    @Param('locationId') locationId: string,
    @Body() updateDto: UpdateLocationDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LocationResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.locationService.updateLocation(schoolId, locationId, updateDto, context);
  }

  /**
   * Delete location
   * DELETE /schools/:schoolId/locations/:locationId
   */
  @Delete(':locationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission({ resource: 'scheduling', action: 'delete', schoolIdParam: 'schoolId' })
  async deleteLocation(
    @Param('schoolId') schoolId: string,
    @Param('locationId') locationId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.locationService.deleteLocation(schoolId, locationId, context);
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
