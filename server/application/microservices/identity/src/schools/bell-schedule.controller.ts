/**
 * Bell Schedule Controller - REST endpoints
 *
 * Routes: /schools/:schoolId/bell-schedules
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
import { BellScheduleService } from './bell-schedule.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateBellScheduleDtoZ,
  UpdateBellScheduleDtoZ,
} from '../common/dto/zod-dtos';
import type {
  BellScheduleResponseDto,
  BellScheduleListResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('schools/:schoolId/bell-schedules')
@UseGuards(JwtAuthGuard)
export class BellScheduleController {
  constructor(private readonly bellScheduleService: BellScheduleService) {}

  /**
   * Create bell schedule
   * POST /schools/:schoolId/bell-schedules
   */
  @Post()
  async createBellSchedule(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateBellScheduleDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<BellScheduleResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.bellScheduleService.createBellSchedule(schoolId, createDto, context);
  }

  /**
   * List bell schedules for school
   * GET /schools/:schoolId/bell-schedules
   */
  @Get()
  async listBellSchedules(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<BellScheduleListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.bellScheduleService.listBellSchedules(schoolId, context);
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get bell schedule by ID
   * GET /schools/:schoolId/bell-schedules/:bellScheduleId
   */
  @Get(':bellScheduleId')
  async getBellSchedule(
    @Param('schoolId') schoolId: string,
    @Param('bellScheduleId') bellScheduleId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<BellScheduleResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.bellScheduleService.getBellSchedule(schoolId, bellScheduleId, context);
  }

  /**
   * Update bell schedule
   * PATCH /schools/:schoolId/bell-schedules/:bellScheduleId
   */
  @Patch(':bellScheduleId')
  async updateBellSchedule(
    @Param('schoolId') schoolId: string,
    @Param('bellScheduleId') bellScheduleId: string,
    @Body() updateDto: UpdateBellScheduleDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<BellScheduleResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.bellScheduleService.updateBellSchedule(
      schoolId,
      bellScheduleId,
      updateDto,
      context,
    );
  }

  /**
   * Delete bell schedule
   * DELETE /schools/:schoolId/bell-schedules/:bellScheduleId
   */
  @Delete(':bellScheduleId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteBellSchedule(
    @Param('schoolId') schoolId: string,
    @Param('bellScheduleId') bellScheduleId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.bellScheduleService.deleteBellSchedule(schoolId, bellScheduleId, context);
  }

  /**
   * Set bell schedule as default
   * POST /schools/:schoolId/bell-schedules/:bellScheduleId/set-default
   */
  @Post(':bellScheduleId/set-default')
  async setDefaultSchedule(
    @Param('schoolId') schoolId: string,
    @Param('bellScheduleId') bellScheduleId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<BellScheduleResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.bellScheduleService.setDefaultSchedule(schoolId, bellScheduleId, context);
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
