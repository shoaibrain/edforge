/**
 * Staff Controller - Identity Service
 * 
 * REST API endpoints for staff management.
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
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { StaffService } from './staff.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequestContext } from '../common/entities/base.entity';
import {
  CreateStaffDtoZ,
  UpdateStaffDtoZ,
  AssignStaffToSchoolDtoZ,
  UpdateEmploymentStatusDtoZ,
  StaffFilterDtoZ,
} from '../common/dto/zod-dtos';
import type {
  StaffResponseDto,
  StaffListResponseDto,
} from '@edforge/shared-types';

@Controller('staff')
@UseGuards(JwtAuthGuard)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  // ============================================
  // Create Staff
  // ============================================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createStaff(
    @Body() createDto: CreateStaffDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.createStaff(createDto, context);
  }

  // ============================================
  // List All Staff
  // ============================================

  @Get()
  async listStaff(
    @Query() filter: StaffFilterDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.listStaff(context, filter);
  }

  // ============================================
  // Lookup Staff by Email (User-to-Staff bridge)
  // ============================================

  @Get('by-email')
  async getStaffByEmail(
    @Query('email') email: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    const staff = await this.staffService.getStaffByEmail(email, context);
    if (!staff) {
      throw new NotFoundException(`No staff member found with email: ${email}`);
    }
    return staff;
  }

  // ============================================
  // Search Staff (static route before :staffId)
  // ============================================

  @Get('search/:term')
  async searchStaff(
    @Param('term') term: string,
    @Query('limit') limit: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.searchStaff(term, context, limit ? parseInt(limit, 10) : 20);
  }

  // ============================================
  // Get Staff by ID (parameterized — must be after static routes)
  // ============================================

  @Get(':staffId')
  async getStaff(
    @Param('staffId') staffId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.getStaff(staffId, context);
  }

  // ============================================
  // Update Staff
  // ============================================

  @Patch(':staffId')
  async updateStaff(
    @Param('staffId') staffId: string,
    @Body() updateDto: UpdateStaffDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.updateStaff(staffId, updateDto, context);
  }

  // ============================================
  // Update Employment Status
  // ============================================

  @Patch(':staffId/employment-status')
  async updateEmploymentStatus(
    @Param('staffId') staffId: string,
    @Body() statusDto: UpdateEmploymentStatusDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.updateEmploymentStatus(staffId, statusDto, context);
  }

  // ============================================
  // Assign to School
  // ============================================

  @Post(':staffId/assignments')
  @HttpCode(HttpStatus.CREATED)
  async assignToSchool(
    @Param('staffId') staffId: string,
    @Body() assignmentDto: AssignStaffToSchoolDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.assignToSchool(staffId, assignmentDto, context);
  }

  // ============================================
  // Delete Staff (Soft Delete)
  // ============================================

  @Delete(':staffId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteStaff(
    @Param('staffId') staffId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.staffService.deleteStaff(staffId, context);
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

// ============================================
// School-scoped Staff Controller
// ============================================

@Controller('schools/:schoolId/staff')
@UseGuards(JwtAuthGuard)
export class SchoolStaffController {
  constructor(private readonly staffService: StaffService) {}

  // ============================================
  // Create Staff in School
  // ============================================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createStaff(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateStaffDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffResponseDto> {
    const context = this.buildContext(tenant, req);
    // Override primarySchoolId with path parameter
    const dto = { ...createDto, primarySchoolId: schoolId };
    return this.staffService.createStaff(dto, context);
  }

  // ============================================
  // List Staff in School
  // ============================================

  @Get()
  async listSchoolStaff(
    @Param('schoolId') schoolId: string,
    @Query() filter: StaffFilterDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<StaffListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.staffService.listStaffBySchool(schoolId, context, filter);
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
