/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Staff Controller
 */

import { Controller, Get, Post, Put, Body, Param, UseGuards, Req, Query } from '@nestjs/common';
import { StaffService } from './staff.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { RequestContext } from '../common/entities/base.entity';
import { ValidationService } from '../common/services/validation.service';

@Controller('staff')
@UseGuards(JwtAuthGuard)
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly validationService: ValidationService
  ) {}

  private getRequestContext(@Req() req: any, @TenantCredentials() tenant: any): RequestContext {
    return {
      tenantId: tenant.tenantId,
      userId: tenant.userId || req.user?.sub || 'system',
      userRole: tenant.role || req.user?.role || 'user',
      userName: tenant.userName || req.user?.name,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      sessionId: req.sessionID
    };
  }

  @Post()
  async createStaff(
    @Body() createStaffDto: CreateStaffDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    // Validate input before processing
    await this.validationService.validateStaffCreation(tenant.tenantId, createStaffDto);
    
    const context = this.getRequestContext(req, tenant);
    return this.staffService.createStaff(tenant.tenantId, createStaffDto, context);
  }

  @Get(':staffId')
  async getStaff(
    @Param('staffId') staffId: string,
    @TenantCredentials() tenant: any
  ) {
    return this.staffService.getStaff(tenant.tenantId, staffId);
  }

  @Get()
  async listStaff(
    @Query('schoolId') schoolId?: string,
    @Query('departmentId') departmentId?: string,
    @TenantCredentials() tenant?: any
  ) {
    if (departmentId) {
      return this.staffService.listStaffByDepartment(tenant.tenantId, departmentId);
    } else if (schoolId) {
      return this.staffService.listStaffBySchool(tenant.tenantId, schoolId);
    }
    return [];
  }
}

