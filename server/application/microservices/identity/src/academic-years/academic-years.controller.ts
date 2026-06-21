/**
 * Academic Years Controller - Academic year management endpoints
 */

import {
  Controller,
  Get,
  Post,
  Put,
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
import { AcademicYearsService } from './academic-years.service';
import { JwtAuthGuard } from '@app/auth/jwt-auth.guard';
import { TenantCredentials, TenantContext } from '@app/auth';
import { RequirePermission } from '../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../common/guards/permission.guard';
import {
  CreateAcademicYearDtoZ,
  UpdateAcademicYearDtoZ,
  UpdateAcademicYearStatusDtoZ,
  CreateGradingPeriodDtoZ,
  UpdateGradingPeriodDtoZ,
  CreateHolidayDtoZ,
} from '../common/dto/zod-dtos';
import type {
  AcademicYearResponseDto,
  AcademicYearListResponseDto,
  GradingPeriodResponseDto,
  GradingPeriodListResponseDto,
  HolidayResponseDto,
  HolidayListResponseDto,
} from '@aibrains/shared-types';
import { RequestContext } from '../common/entities';

@Controller('schools/:schoolId/academic-years')
@UseGuards(JwtAuthGuard, PermissionGuard)
export class AcademicYearsController {
  constructor(private readonly academicYearsService: AcademicYearsService) {}

  // ============================================
  // Academic Year Endpoints
  // ============================================

  /**
   * Create academic year
   * POST /schools/:schoolId/academic-years
   */
  @Post()
  @RequirePermission({ resource: 'scheduling', action: 'create', schoolIdParam: 'schoolId' })
  async createAcademicYear(
    @Param('schoolId') schoolId: string,
    @Body() createDto: CreateAcademicYearDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.createAcademicYear(schoolId, createDto, context);
  }

  /**
   * List academic years
   * GET /schools/:schoolId/academic-years
   */
  @Get()
  @RequirePermission({ resource: 'scheduling', action: 'view', schoolIdParam: 'schoolId' })
  async listAcademicYears(
    @Param('schoolId') schoolId: string,
    @Query('limit') limit: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.academicYearsService.listAcademicYears(
      schoolId,
      context,
      limit ? parseInt(limit, 10) : 20
    );
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Get current academic year
   * GET /schools/:schoolId/academic-years/current
   */
  @Get('current')
  @RequirePermission({ resource: 'scheduling', action: 'view', schoolIdParam: 'schoolId' })
  async getCurrentAcademicYear(
    @Param('schoolId') schoolId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.getCurrentAcademicYear(schoolId, context);
  }


  /**
   * Set academic year as current
   * PUT /schools/:schoolId/academic-years/:yearId/set-current
   */
  @Put(':yearId/set-current')
  @RequirePermission({ resource: 'scheduling', action: 'edit', schoolIdParam: 'schoolId' })
  async setCurrentAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.setCurrentAcademicYear(schoolId, yearId, context);
  }

  /**
   * Update academic year status
   * PUT /schools/:schoolId/academic-years/:yearId/status
   */
  @Put(':yearId/status')
  @RequirePermission({ resource: 'scheduling', action: 'edit', schoolIdParam: 'schoolId' })
  async updateAcademicYearStatus(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() updateDto: UpdateAcademicYearStatusDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.updateAcademicYearStatus(schoolId, yearId, updateDto, context);
  }

  /**
   * Get academic year by ID
   * GET /schools/:schoolId/academic-years/:yearId
   */
  @Get(':yearId')
  @RequirePermission({ resource: 'scheduling', action: 'view', schoolIdParam: 'schoolId' })
  async getAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.getAcademicYear(schoolId, yearId, context);
  }

  /**
   * Update academic year
   * PUT /schools/:schoolId/academic-years/:yearId
   */
  @Put(':yearId')
  @RequirePermission({ resource: 'scheduling', action: 'edit', schoolIdParam: 'schoolId' })
  async updateAcademicYear(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() updateDto: UpdateAcademicYearDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<AcademicYearResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.updateAcademicYear(schoolId, yearId, updateDto, context);
  }

  // ============================================
  // Grading Period Endpoints
  // ============================================

  /**
   * Create grading period
   * POST /schools/:schoolId/academic-years/:yearId/grading-periods
   */
  @Post(':yearId/grading-periods')
  @RequirePermission({ resource: 'scheduling', action: 'create', schoolIdParam: 'schoolId' })
  async createGradingPeriod(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() createDto: CreateGradingPeriodDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<GradingPeriodResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.createGradingPeriod(schoolId, yearId, createDto, context);
  }

  /**
   * List grading periods
   * GET /schools/:schoolId/academic-years/:yearId/grading-periods
   */
  @Get(':yearId/grading-periods')
  @RequirePermission({ resource: 'scheduling', action: 'view', schoolIdParam: 'schoolId' })
  async listGradingPeriods(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<GradingPeriodListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.academicYearsService.listGradingPeriods(schoolId, yearId, context);
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Update grading period
   * PUT /schools/:schoolId/academic-years/:yearId/grading-periods/:termId
   */
  @Put(':yearId/grading-periods/:termId')
  @RequirePermission({ resource: 'scheduling', action: 'edit', schoolIdParam: 'schoolId' })
  async updateGradingPeriod(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('termId') termId: string,
    @Body() updateDto: UpdateGradingPeriodDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<GradingPeriodResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.updateGradingPeriod(schoolId, yearId, termId, updateDto, context);
  }

  // ============================================
  // Holiday Endpoints
  // ============================================

  /**
   * Create holiday
   * POST /schools/:schoolId/academic-years/:yearId/holidays
   */
  @Post(':yearId/holidays')
  @RequirePermission({ resource: 'scheduling', action: 'create', schoolIdParam: 'schoolId' })
  async createHoliday(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Body() createDto: CreateHolidayDtoZ,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<HolidayResponseDto> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.createHoliday(schoolId, yearId, createDto, context);
  }

  /**
   * List holidays
   * GET /schools/:schoolId/academic-years/:yearId/holidays
   */
  @Get(':yearId/holidays')
  @RequirePermission({ resource: 'scheduling', action: 'view', schoolIdParam: 'schoolId' })
  async listHolidays(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<HolidayListResponseDto> {
    const context = this.buildContext(tenant, req);
    const result = await this.academicYearsService.listHolidays(schoolId, yearId, context);
    return {
      items: result.items,
      lastEvaluatedKey: result.lastEvaluatedKey,
      hasMore: result.hasMore,
    };
  }

  /**
   * Delete holiday
   * DELETE /schools/:schoolId/academic-years/:yearId/holidays/:holidayId
   */
  @Delete(':yearId/holidays/:holidayId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission({ resource: 'scheduling', action: 'delete', schoolIdParam: 'schoolId' })
  async deleteHoliday(
    @Param('schoolId') schoolId: string,
    @Param('yearId') yearId: string,
    @Param('holidayId') holidayId: string,
    @TenantCredentials() tenant: TenantContext,
    @Req() req: Request
  ): Promise<void> {
    const context = this.buildContext(tenant, req);
    return this.academicYearsService.deleteHoliday(schoolId, yearId, holidayId, context);
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
