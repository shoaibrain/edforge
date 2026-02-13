/**
 * Schools Controller for Identity Service
 */

import {
  Controller,
  Get,
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
} from '@nestjs/common';
import { Request } from 'express';
import { SchoolsService } from './schools.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateSchoolDtoZ,
  UpdateSchoolDtoZ,
  CreateDepartmentDtoZ,
  UpdateDepartmentDtoZ,
  UpdateSchoolConfigDtoZ,
} from '../common/dto/zod-dtos';
import type {
  SchoolResponseDto,
  SchoolListResponseDto,
  DepartmentResponseDto,
  DepartmentListResponseDto,
  SchoolConfigResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('schools')
@UseGuards(JwtAuthGuard)
export class SchoolsController {
  constructor(private readonly schoolsService: SchoolsService) {}

  /**
   * Create a new school
   * POST /schools
   */
  @Post()
  async createSchool(
    @Body() createDto: CreateSchoolDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SchoolResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.schoolsService.createSchool(createDto, context);
  }

  /**
   * List all schools
   * GET /schools
   * Supports optional ?leaId= filter to list schools under a specific LEA
   */
  @Get()
  async listSchools(
    @Query('limit') limit: string,
    @Query('leaId') leaId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SchoolListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.schoolsService.listSchools(
      context,
      limit ? parseInt(limit, 10) : 50,
      leaId || undefined
    );
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  // ============================================
  // Configuration Endpoints (MUST be before generic :schoolId routes)
  // NestJS evaluates routes in definition order
  // ============================================

  /**
   * Get school configuration
   * GET /schools/:schoolId/configuration
   */
  @Get(':schoolId/configuration')
  async getConfiguration(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SchoolConfigResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.schoolsService.getConfiguration(schoolId, context);
  }

  /**
   * Update school configuration
   * Patch /schools/:schoolId/configuration
   */
  @Patch(':schoolId/configuration')
  async updateConfiguration(
    @Param('schoolId') schoolId: string,
    @Body() updateDto: UpdateSchoolConfigDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SchoolConfigResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.schoolsService.updateConfiguration(schoolId, updateDto, context);
  }

  // ============================================
  // Department Endpoints (MUST be before generic :schoolId routes)
  // ============================================

  /**
   * Get department by ID
   * GET /schools/:schoolId/departments/:departmentId
   * NOTE: Must be before :schoolId/departments to match correctly
   */
  @Get(':schoolId/departments/:departmentId')
  async getDepartment(
    @Param('schoolId') schoolId: string,
    @Param('departmentId') departmentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<DepartmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.schoolsService.getDepartment(schoolId, departmentId, context);
  }

  /**
   * List departments
   * GET /schools/:schoolId/departments
   */
  @Get(':schoolId/departments')
  async listDepartments(
    @Param('schoolId') schoolId: string,
    @Query('limit') limit: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<DepartmentListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.schoolsService.listDepartments(
      schoolId,
      context,
      limit ? parseInt(limit, 10) : 50
    );
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Create department
   * POST /schools/:schoolId/departments
   */
  @Post(':schoolId/departments')
  async createDepartment(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateDepartmentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<DepartmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.schoolsService.createDepartment(schoolId, createDto, context);
  }

  /**
   * Update department
   * PATCH /schools/:schoolId/departments/:departmentId
   */
  @Patch(':schoolId/departments/:departmentId')
  async updateDepartment(
    @Param('schoolId') schoolId: string,
    @Param('departmentId') departmentId: string,
    @Body() updateDto: UpdateDepartmentDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<DepartmentResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.schoolsService.updateDepartment(schoolId, departmentId, updateDto, context);
  }

  /**
   * Delete department
   * DELETE /schools/:schoolId/departments/:departmentId
   */
  @Delete(':schoolId/departments/:departmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteDepartment(
    @Param('schoolId') schoolId: string,
    @Param('departmentId') departmentId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.schoolsService.deleteDepartment(schoolId, departmentId, context);
  }

  // ============================================
  // Generic School CRUD (MUST be after specific nested routes)
  // ============================================

  /**
   * Get school by ID
   * GET /schools/:schoolId
   */
  @Get(':schoolId')
  async getSchool(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SchoolResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.schoolsService.getSchool(schoolId, context);
  }

  /**
   * Update school
   * PATCH /schools/:schoolId
   */
  @Patch(':schoolId')
  async updateSchool(
    @Param('schoolId') schoolId: string,
    @Body() updateDto: UpdateSchoolDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<SchoolResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.schoolsService.updateSchool(schoolId, updateDto, context);
  }

  /**
   * Delete school
   * DELETE /schools/:schoolId
   */
  @Delete(':schoolId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSchool(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.schoolsService.deleteSchool(schoolId, context);
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
