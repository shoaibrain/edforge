/**
 * Leave Controller - Identity Service
 * 
 * REST API endpoints for staff leave management.
 */

import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Request } from 'express';
import { LeaveService } from './leave.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequestContext } from '../common/entities/base.entity';
import type {
  CreateLeaveRequestDto,
  LeaveRequestResponseDto,
  LeaveFilterDto,
  ApproveLeaveDto,
  RejectLeaveDto,
  CancelLeaveDto,
  LeaveListResponseDto,
} from '@edforge/shared-types';

@Controller('staff/:staffId/leave')
@UseGuards(JwtAuthGuard)
export class LeaveController {
  constructor(private readonly leaveService: LeaveService) {}

  // ============================================
  // Create Leave Request
  // ============================================

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createLeaveRequest(
    @Param('staffId') staffId: string,
    @Body() createDto: CreateLeaveRequestDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LeaveRequestResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.leaveService.createLeaveRequest(staffId, createDto, context);
  }

  // ============================================
  // Get Leave Request
  // ============================================

  @Get(':leaveId')
  async getLeaveRequest(
    @Param('staffId') staffId: string,
    @Param('leaveId') leaveId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LeaveRequestResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.leaveService.getLeaveRequest(staffId, leaveId, context);
  }

  // ============================================
  // List Leave Requests
  // ============================================

  @Get()
  async listLeaveRequests(
    @Param('staffId') staffId: string,
    @Query() filter: LeaveFilterDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LeaveListResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.leaveService.listLeaveRequests(staffId, context, filter);
  }

  // ============================================
  // Approve Leave Request
  // ============================================

  @Patch(':leaveId/approve')
  async approveLeaveRequest(
    @Param('staffId') staffId: string,
    @Param('leaveId') leaveId: string,
    @Body() approveDto: ApproveLeaveDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LeaveRequestResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.leaveService.approveLeaveRequest(staffId, leaveId, approveDto, context);
  }

  // ============================================
  // Reject Leave Request
  // ============================================

  @Patch(':leaveId/reject')
  async rejectLeaveRequest(
    @Param('staffId') staffId: string,
    @Param('leaveId') leaveId: string,
    @Body() rejectDto: RejectLeaveDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LeaveRequestResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.leaveService.rejectLeaveRequest(staffId, leaveId, rejectDto, context);
  }

  // ============================================
  // Cancel Leave Request
  // ============================================

  @Patch(':leaveId/cancel')
  async cancelLeaveRequest(
    @Param('staffId') staffId: string,
    @Param('leaveId') leaveId: string,
    @Body() cancelDto: CancelLeaveDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<LeaveRequestResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.leaveService.cancelLeaveRequest(staffId, leaveId, cancelDto.cancellationReason, context);
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
