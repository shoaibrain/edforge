/**
 * Education Organizations Controller - Identity Service
 *
 * API routes for SEA, LEA, ESC management and hierarchy assembly.
 */

import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { EducationOrganizationsService } from './education-organizations.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { GlobalRoleGuard } from '../common/guards/global-role.guard';
import { RequireGlobalRole } from '../common/decorators/require-global-role.decorator';
import {
  CreateSeaDtoZ,
  UpdateSeaDtoZ,
  CreateLeaDtoZ,
  UpdateLeaDtoZ,
  CreateEscDtoZ,
  UpdateEscDtoZ,
} from '../common/dto/zod-dtos';
import type {
  SeaResponseDto,
  LeaResponseDto,
  LeaListResponseDto,
  EscResponseDto,
  EscListResponseDto,
  OrganizationHierarchyResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('education-organizations')
@UseGuards(JwtAuthGuard)
export class EducationOrganizationsController {
  constructor(
    private readonly edOrgService: EducationOrganizationsService,
  ) {}

  // ============================================
  // Hierarchy
  // ============================================

  /**
   * Get the full organization hierarchy tree
   * GET /education-organizations/hierarchy
   */
  @Get('hierarchy')
  async getHierarchy(
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<OrganizationHierarchyResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.edOrgService.getHierarchy(context);
  }

  // ============================================
  // SEA (singleton per tenant)
  // ============================================

  /**
   * Get the tenant's State Education Agency
   * GET /education-organizations/sea
   */
  @Get('sea')
  async getSEA(
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SeaResponseDto> {
    const context = this.buildContext(tenant, req);
    const sea = await this.edOrgService.getSEA(context);
    if (!sea) {
      throw new NotFoundException('No State Education Agency configured for this tenant');
    }
    return sea;
  }

  /**
   * Create or update the tenant's SEA (idempotent)
   * PUT /education-organizations/sea
   */
  @Put('sea')
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async createOrUpdateSEA(
    @Body() dto: CreateSeaDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<SeaResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.edOrgService.createOrUpdateSEA(dto, context);
  }

  // ============================================
  // LEA (Local Education Agency)
  // ============================================

  /**
   * List Local Education Agencies
   * GET /education-organizations/leas
   */
  @Get('leas')
  async listLEAs(
    @Query('seaId') seaId: string,
    @Query('escId') escId: string,
    @Query('operationalStatus') operationalStatus: string,
    @Query('search') search: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<LeaListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.edOrgService.listLEAs(
      {
        seaId,
        escId,
        operationalStatus: operationalStatus as any,
        search,
        limit: limit ? parseInt(limit, 10) : 20,
        cursor,
      },
      context,
    );
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Create a Local Education Agency
   * POST /education-organizations/leas
   */
  @Post('leas')
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async createLEA(
    @Body() dto: CreateLeaDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<LeaResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.edOrgService.createLEA(dto, context);
  }

  /**
   * Get a Local Education Agency by ID
   * GET /education-organizations/leas/:leaId
   */
  @Get('leas/:leaId')
  async getLEA(
    @Param('leaId') leaId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<LeaResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.edOrgService.getLEA(leaId, context);
  }

  /**
   * Update a Local Education Agency
   * PATCH /education-organizations/leas/:leaId
   */
  @Patch('leas/:leaId')
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async updateLEA(
    @Param('leaId') leaId: string,
    @Body() dto: UpdateLeaDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<LeaResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.edOrgService.updateLEA(leaId, dto, context);
  }

  /**
   * Soft-delete a Local Education Agency
   * DELETE /education-organizations/leas/:leaId
   */
  @Delete('leas/:leaId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async deleteLEA(
    @Param('leaId') leaId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.edOrgService.deleteLEA(leaId, context);
  }

  // ============================================
  // ESC (Education Service Center)
  // ============================================

  /**
   * List Education Service Centers
   * GET /education-organizations/escs
   */
  @Get('escs')
  async listESCs(
    @Query('seaId') seaId: string,
    @Query('operationalStatus') operationalStatus: string,
    @Query('search') search: string,
    @Query('limit') limit: string,
    @Query('cursor') cursor: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<EscListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.edOrgService.listESCs(
      {
        seaId,
        operationalStatus: operationalStatus as any,
        search,
        limit: limit ? parseInt(limit, 10) : 20,
        cursor,
      },
      context,
    );
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Create an Education Service Center
   * POST /education-organizations/escs
   */
  @Post('escs')
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async createESC(
    @Body() dto: CreateEscDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<EscResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.edOrgService.createESC(dto, context);
  }

  /**
   * Get an Education Service Center by ID
   * GET /education-organizations/escs/:escId
   */
  @Get('escs/:escId')
  async getESC(
    @Param('escId') escId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<EscResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.edOrgService.getESC(escId, context);
  }

  /**
   * Update an Education Service Center
   * PATCH /education-organizations/escs/:escId
   */
  @Patch('escs/:escId')
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async updateESC(
    @Param('escId') escId: string,
    @Body() dto: UpdateEscDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<EscResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.edOrgService.updateESC(escId, dto, context);
  }

  /**
   * Soft-delete an Education Service Center
   * DELETE /education-organizations/escs/:escId
   */
  @Delete('escs/:escId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @UseGuards(JwtAuthGuard, GlobalRoleGuard)
  @RequireGlobalRole('TenantAdmin')
  async deleteESC(
    @Param('escId') escId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.edOrgService.deleteESC(escId, context);
  }

  // ============================================
  // Context Builder
  // ============================================

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
