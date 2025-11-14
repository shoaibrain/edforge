/*
 * Copyright EdForge.net, Inc. or its affiliates. All Rights Reserved.
 * 
 * Parent Controller
 */

import { Controller, Get, Post, Put, Body, Param, UseGuards, Req, Query } from '@nestjs/common';
import { ParentService } from './parent.service';
import { CreateParentDto, UpdateParentDto } from './dto/parent.dto';
import { TenantCredentials } from '@app/auth/auth.decorator';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { RequestContext } from '../common/entities/base.entity';
import { ValidationService } from '../common/services/validation.service';

@Controller('parents')
@UseGuards(JwtAuthGuard)
export class ParentController {
  constructor(
    private readonly parentService: ParentService,
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
  async createParent(
    @Body() createParentDto: CreateParentDto,
    @Req() req: any,
    @TenantCredentials() tenant: any
  ) {
    // Validate input before processing
    await this.validationService.validateParentCreation(tenant.tenantId, createParentDto);
    
    const context = this.getRequestContext(req, tenant);
    return this.parentService.createParent(tenant.tenantId, createParentDto, context);
  }

  @Get(':parentId')
  async getParent(
    @Param('parentId') parentId: string,
    @TenantCredentials() tenant: any
  ) {
    return this.parentService.getParent(tenant.tenantId, parentId);
  }

  @Get('students/:studentId')
  async getParentsByStudent(
    @Param('studentId') studentId: string,
    @TenantCredentials() tenant: any
  ) {
    return this.parentService.getParentsByStudent(tenant.tenantId, studentId);
  }
}

