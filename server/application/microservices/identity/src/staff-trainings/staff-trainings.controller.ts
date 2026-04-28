/**
 * StaffTrainings Controller — Identity Service (Sprint B.5)
 *
 * REST endpoints for staff training records. Mounted under
 * `/staff/:staffId/trainings` mirroring the credentials controller pattern.
 *
 * The NGINX rproxy already covers `/staff/*` via prefix-regex
 * (`location ~ ^/staff` — see CLAUDE.md), so no rproxy changes are needed
 * for this controller's routes — only the API Gateway entries
 * (Sprint B.6 — `server/lib/tenant-api-prod.json`).
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
import { StaffTrainingsService } from './staff-trainings.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequestContext, PaginatedResult } from '../common/entities/base.entity';
import type {
  CreateStaffTrainingDto,
  UpdateStaffTrainingDto,
  StaffTrainingResponseDto,
  StaffTrainingFilterDto,
} from '@aibrains/shared-types';

@Controller('staff/:staffId/trainings')
@UseGuards(JwtAuthGuard)
export class StaffTrainingsController {
  constructor(private readonly trainingsService: StaffTrainingsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createTraining(
    @Param('staffId') staffId: string,
    @Body() createDto: CreateStaffTrainingDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<StaffTrainingResponseDto> {
    return this.trainingsService.createTraining(staffId, createDto, this.buildContext(tenant, req));
  }

  @Get(':trainingId')
  async getTraining(
    @Param('staffId') staffId: string,
    @Param('trainingId') trainingId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<StaffTrainingResponseDto> {
    return this.trainingsService.getTraining(staffId, trainingId, this.buildContext(tenant, req));
  }

  @Get()
  async listTrainings(
    @Param('staffId') staffId: string,
    @Query() filter: StaffTrainingFilterDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<PaginatedResult<StaffTrainingResponseDto>> {
    return this.trainingsService.listTrainings(staffId, this.buildContext(tenant, req), filter);
  }

  @Patch(':trainingId')
  async updateTraining(
    @Param('staffId') staffId: string,
    @Param('trainingId') trainingId: string,
    @Body() updateDto: UpdateStaffTrainingDto,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<StaffTrainingResponseDto> {
    return this.trainingsService.updateTraining(
      staffId,
      trainingId,
      updateDto,
      this.buildContext(tenant, req),
    );
  }

  @Delete(':trainingId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteTraining(
    @Param('staffId') staffId: string,
    @Param('trainingId') trainingId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request,
  ): Promise<void> {
    return this.trainingsService.deleteTraining(staffId, trainingId, this.buildContext(tenant, req));
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
