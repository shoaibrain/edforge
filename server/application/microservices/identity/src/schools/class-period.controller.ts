/**
 * Class Period Controller - REST endpoints
 *
 * Routes: /schools/:schoolId/class-periods
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
import { ClassPeriodService } from './class-period.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import {
  CreateClassPeriodDtoZ,
  UpdateClassPeriodDtoZ,
} from '../common/dto/zod-dtos';
import type {
  ClassPeriodResponseDto,
  ClassPeriodListResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('schools/:schoolId/class-periods')
@UseGuards(JwtAuthGuard)
export class ClassPeriodController {
  constructor(private readonly classPeriodService: ClassPeriodService) {}

  /**
   * Create class period
   * POST /schools/:schoolId/class-periods
   */
  @Post()
  async createClassPeriod(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateClassPeriodDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<ClassPeriodResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.classPeriodService.createClassPeriod(schoolId, createDto, context);
  }

  /**
   * List class periods for school
   * GET /schools/:schoolId/class-periods
   */
  @Get()
  async listClassPeriods(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<ClassPeriodListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.classPeriodService.listClassPeriods(schoolId, context);
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get class period by ID
   * GET /schools/:schoolId/class-periods/:periodId
   */
  @Get(':periodId')
  async getClassPeriod(
    @Param('schoolId') schoolId: string,
    @Param('periodId') periodId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<ClassPeriodResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.classPeriodService.getClassPeriod(schoolId, periodId, context);
  }

  /**
   * Update class period
   * PATCH /schools/:schoolId/class-periods/:periodId
   */
  @Patch(':periodId')
  async updateClassPeriod(
    @Param('schoolId') schoolId: string,
    @Param('periodId') periodId: string,
    @Body() updateDto: UpdateClassPeriodDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<ClassPeriodResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.classPeriodService.updateClassPeriod(schoolId, periodId, updateDto, context);
  }

  /**
   * Delete class period
   * DELETE /schools/:schoolId/class-periods/:periodId
   */
  @Delete(':periodId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteClassPeriod(
    @Param('schoolId') schoolId: string,
    @Param('periodId') periodId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.classPeriodService.deleteClassPeriod(schoolId, periodId, context);
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
